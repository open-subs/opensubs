#!/usr/bin/env python3
"""Fail a desktop build whose binary uses instructions an ordinary x86-64 CPU lacks.

    python scripts/check-isa.py target/release/opensubs-desktop.exe --map target/opensubs-desktop.map
    python scripts/check-isa.py usr/bin/opensubs-desktop          # Linux, from the .deb or AppImage
    python scripts/check-isa.py ... --report isa-check.md         # also write a Markdown report

Why: v1.0.3-rc.13 died with an illegal instruction (0xc000001d) on every CPU
without AVX-512, because ggml (inside whisper.cpp) had been compiled for the
build runner's own CPU. The release workflow pins ggml's instruction set; this
script checks the result in the finished binary rather than in the build
configuration, for Windows (PE) and Linux (ELF) alike.

How: every function in the binary's code is decoded with iced-x86 and each
instruction's CPUID features are collected. A function may use features above
the x86-64-v3 baseline (AVX2, FMA, F16C, BMI1/2, ...) only if it belongs to a
library that checks the CPU at run time before running such code: CTranslate2
and ruy (ct2rs), and aws-lc. Anything else using AVX-512, AVX-VNNI, AMX, or any
other feature beyond the baseline fails, and the failure names the library,
the function and the instructions.

Which library a function belongs to:
- Windows: the MSVC linker map (--map), which names the library and object of
  every address. apps/desktop/src-tauri/build.rs writes one when the release
  workflow sets OPENSUBS_LINKER_MAP.
- Linux: the ELF symbol table, read by name (the namespaces and prefixes each
  library's symbols carry).
- Neither (an exe from an older release): the source paths and markers each
  function references, carried forward to the functions after it. That is an
  approximation and the output says so.
"""
import argparse
import bisect
import collections
import re
import struct
import sys

try:
    from iced_x86 import Code, CpuidFeature, Decoder
except ImportError:
    sys.exit("needs iced-x86: pip install iced-x86==1.21.0")

FEATURE = {v: k for k, v in CpuidFeature.__dict__.items() if isinstance(v, int) and not k.startswith("_")}

# Allowed anywhere: x86-64-v3 (which includes MMX and SSE2 by definition),
# plus what every AVX2 CPU has alongside it, and CET's ENDBR64, which older
# CPUs execute as a NOP.
BASELINE = {
    "X64", "INTEL8086", "INTEL8086_ONLY", "INTEL186", "INTEL286", "INTEL386", "INTEL486",
    "FPU", "FPU287", "FPU387", "MMX", "CMOV", "CX8", "CMPXCHG16B", "MULTIBYTENOP", "PAUSE",
    "CPUID", "TSC", "RDTSCP", "CLFSH", "FXSR", "XSAVE", "SYSCALL",
    "SSE", "SSE2", "SSE3", "SSSE3", "SSE4_1", "SSE4_2", "POPCNT",
    "AVX", "AVX2", "FMA", "F16C", "BMI1", "BMI2", "LZCNT", "MOVBE",
    "AES", "PCLMULQDQ", "RDRAND", "PREFETCHW", "CET_IBT",
}

# Libraries that choose their instruction set at run time (CPUID checks).
RUNTIME_DISPATCHED = re.compile(r"ct2rs|ctranslate2|ruy|cpu_features|aws[-_]lc", re.I)


class Binary:
    """Code ranges, bytes by virtual address, and where read-only data lives."""

    def __init__(self, path):
        self.path = path
        self.b = open(path, "rb").read()
        self.symbols = None  # ELF: sorted [(addr, name)]
        if self.b[:4] == b"\x7fELF":
            self._elf()
        elif self.b[:2] == b"MZ":
            self._pe()
        else:
            sys.exit(f"{path}: neither PE nor ELF")

    # ---- PE -------------------------------------------------------------
    def _pe(self):
        b = self.b
        self.kind = "PE"
        pe = struct.unpack_from("<I", b, 0x3C)[0]
        nsec = struct.unpack_from("<H", b, pe + 6)[0]
        optsz = struct.unpack_from("<H", b, pe + 20)[0]
        self.base = struct.unpack_from("<Q", b, pe + 24 + 24)[0]
        off = pe + 24 + optsz
        self.sections = []  # (name, va, size, file_off)
        for _ in range(nsec):
            name = b[off:off + 8].rstrip(b"\0").decode()
            vsz, va, rsz, rptr = struct.unpack_from("<IIII", b, off + 8)
            self.sections.append((name, va, min(vsz, rsz), rptr))
            off += 40
        sec = {s[0]: s for s in self.sections}
        _, pva, psz, pptr = sec[".pdata"]
        fns = set()
        for i in range(0, psz - psz % 12, 12):
            beg, end, _ = struct.unpack_from("<III", b, pptr + i)
            if beg:
                fns.add((beg, end))
        _, tva, tsz, _ = sec[".text"]
        self.ranges = with_gaps(sorted(fns), tva, tva + tsz)
        _, rva, rsz, _ = sec.get(".rdata", ("", 0, 0, 0))
        self.rodata = (rva, rva + rsz)

    # ---- ELF ------------------------------------------------------------
    def _elf(self):
        b = self.b
        self.kind = "ELF"
        self.base = 0
        if b[4] != 2 or b[5] != 1:
            sys.exit("only 64-bit little-endian ELF is supported")
        shoff, = struct.unpack_from("<Q", b, 0x28)
        shentsize, shnum, shstrndx = struct.unpack_from("<HHH", b, 0x3A)
        raw = []
        for i in range(shnum):
            o = shoff + i * shentsize
            name, typ, flags, addr, off, size, link, info, align, entsize = struct.unpack_from("<IIQQQQIIQQ", b, o)
            raw.append((name, typ, flags, addr, off, size, link, entsize))
        strtab = raw[shstrndx]

        def secname(n):
            o = strtab[4] + n
            return b[o:b.index(b"\0", o)].decode()

        self.sections = []
        exec_secs = []
        for name, typ, flags, addr, off, size, link, entsize in raw:
            n = secname(name)
            if typ != 8 and addr:  # not NOBITS
                self.sections.append((n, addr, size, off))
            if flags & 0x4 and typ == 1:  # SHF_EXECINSTR, PROGBITS
                exec_secs.append((addr, addr + size))
        self.rodata = next(((a, a + s) for n, a, s, _ in self.sections if n == ".rodata"), (0, 0))

        funcs, names = set(), []
        for name, typ, flags, addr, off, size, link, entsize in raw:
            if typ not in (2, 11):  # SYMTAB, DYNSYM
                continue
            st = raw[link]
            for i in range(size // 24):
                st_name, st_info, _, st_shndx, st_value, st_size = struct.unpack_from("<IBBHQQ", b, off + i * 24)
                if st_info & 0xF != 2 or not st_value:  # STT_FUNC
                    continue
                o = st[4] + st_name
                nm = b[o:b.index(b"\0", o)].decode(errors="replace")
                names.append((st_value, nm, st_info >> 4))
                if st_size:
                    funcs.add((st_value, st_value + st_size))
        self.symbols = sorted(set(names))
        ranges = []
        for lo, hi in exec_secs:
            inside = sorted(f for f in funcs if lo <= f[0] < hi)
            ranges += with_gaps(inside, lo, hi)
        self.ranges = sorted(ranges)

    # ---- common ---------------------------------------------------------
    def offset(self, addr):
        for _, va, size, off in self.sections:
            if va <= addr < va + size:
                return off + addr - va
        return None

    def string_at(self, addr):
        o = self.offset(addr)
        if o is None:
            return ""
        s = self.b[o:o + 200].split(b"\0")[0]
        return s.decode() if len(s) >= 4 and all(32 <= c < 127 for c in s) else ""


def with_gaps(fns, lo, hi):
    """Functions plus the gaps between them: leaf code needs no unwind entry
    or symbol size, so the gaps are decoded as ranges of their own."""
    out, at = [], lo
    for beg, end in fns:
        if beg > at and beg - at >= 16:
            out.append((at, beg))
        at = max(at, end)
    if hi - at >= 16:
        out.append((at, hi))
    return sorted(fns + out)


def read_msvc_map(path, base):
    """(rva, symbol, lib:object) from an MSVC /MAP file, sorted by rva."""
    line_re = re.compile(r"^\s*[0-9a-fA-F]{4}:[0-9a-fA-F]{8}\s+(\S+)\s+([0-9a-fA-F]{8,16})\s+(?:f\s+)?(?:i\s+)?(\S+)\s*$")
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = line_re.match(line)
            if m and int(m.group(2), 16) >= base:
                out.append((int(m.group(2), 16) - base, m.group(1), m.group(3)))
    return sorted(out)


def library_of_symbol(name):
    """Which library an ELF symbol belongs to, from its name."""
    if "aws_lc" in name:
        return "aws-lc"
    if re.search(r"11ctranslate2|(?<![0-9])3ruy[0-9]|12cpu_features|^ruy_", name):
        return "ct2rs (CTranslate2/ruy)"
    if re.search(r"ggml|whisper", name, re.I):
        return "whisper-rs-sys (ggml/whisper.cpp)"
    m = re.match(r"_ZN(?:K)?(\d+)", name)
    if m:  # Rust legacy / C++ mangling: the first path component
        n = int(m.group(1))
        return "crate/namespace " + name[m.end():m.end() + n]
    return "other: " + name[:40]


KNOWN = ("aws-lc", "ct2rs", "whisper-rs-sys")


def elf_lookup(symbols):
    """(addr, library, name) for each ELF function symbol.

    Assembly files keep their inner routines as local labels with no library
    prefix (aws-lc's `Lp384_montjscalarmul_p384_montjadd`, `mulx4x_internal`).
    A local symbol whose name says nothing is given the library of the
    nearest global function before it, which is the entry point of the same
    object file.
    """
    out, last_global = [], None
    for addr, name, bind in symbols:
        lib = library_of_symbol(name)
        if bind != 0:
            last_global = lib
        elif not lib.startswith(KNOWN) and last_global and last_global.startswith(KNOWN):
            lib = last_global
        out.append((addr, lib, name))
    return out


MARKERS = [
    (re.compile(r"whisper-rs-sys|ggml|whisper\.cpp", re.I), "whisper-rs-sys (ggml/whisper.cpp)"),
    (re.compile(r"ct2rs|CTranslate2|Kernel kAvx|RUY_|CT2_FORCE_CPU_ISA", re.I), "ct2rs (CTranslate2/ruy)"),
    (re.compile(r"aws-lc|AWS-LC~|aws_lc", re.I), "aws-lc"),
    (re.compile(r"index\.crates\.io-[0-9a-f]+[\\/]([A-Za-z0-9_.-]+?)-\d", re.I), None),
]


def label_from_strings(strings):
    for s in strings:
        for rx, label in MARKERS:
            m = rx.search(s)
            if m:
                return label or m.group(1)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("binary")
    ap.add_argument("--map", help="MSVC linker map for a Windows exe (/MAP)")
    ap.add_argument("--report", help="also write the result as Markdown to this file")
    ap.add_argument("--show", type=int, default=25, help="violations to list")
    args = ap.parse_args()

    bn = Binary(args.binary)
    if args.map:
        sym = read_msvc_map(args.map, bn.base)
        if len(sym) < 1000:
            sys.exit(f"{args.map}: only {len(sym)} symbols parsed -- not a linker map for this exe?")
        how = f"linker map {args.map}"
        lookup = [(a, lib, name) for a, name, lib in sym]
    elif bn.symbols and len(bn.symbols) > 1000:
        how = "ELF symbol table, by symbol name"
        lookup = elf_lookup(bn.symbols)
    else:
        how = "referenced strings (no map or symbols: approximate)"
        lookup = None
    keys = [x[0] for x in lookup] if lookup else None

    carried = "unattributed"
    per_lib = collections.defaultdict(collections.Counter)
    violations = []
    for beg, end in bn.ranges:
        o = bn.offset(beg)
        if o is None:
            continue
        feats, strings = collections.Counter(), []
        for ins in Decoder(64, bn.b[o:o + end - beg], ip=beg):
            if ins.code == Code.INVALID:
                continue
            for f in ins.cpuid_features():
                feats[FEATURE.get(f, str(f))] += 1
            if lookup is None and ins.is_ip_rel_memory_operand:
                t = ins.ip_rel_memory_address
                if bn.rodata[0] <= t < bn.rodata[1]:
                    s = bn.string_at(t)
                    if s:
                        strings.append(s)
        if lookup is not None:
            i = bisect.bisect_right(keys, beg) - 1
            lib, name = (lookup[i][1], lookup[i][2]) if i >= 0 else ("unattributed", "?")
        else:
            found = label_from_strings(strings)
            carried = found or carried
            lib, name = carried, ("" if found else "(carried forward)")
        hi = {f: n for f, n in feats.items() if f not in BASELINE}
        if not hi:
            continue
        per_lib[lib].update(hi)
        if not RUNTIME_DISPATCHED.search(lib):
            violations.append((beg, end, lib, name, hi))

    out = [f"{args.binary} ({bn.kind})",
           f"  {len(bn.ranges)} code ranges, attribution by {how}",
           "  instructions above the x86-64-v3 baseline (AVX2), by library:"]
    rows = []
    for lib, c in sorted(per_lib.items(), key=lambda kv: -sum(kv[1].values())):
        ok = RUNTIME_DISPATCHED.search(lib) is not None
        feats = ", ".join(f"{f}={n}" for f, n in c.most_common(6))
        out.append(f"    {lib[:70]:70s} {'allowed (runtime-dispatched)' if ok else 'NOT ALLOWED'}: {feats}")
        rows.append((lib, ok, feats))
    total = collections.Counter()
    for *_, hi in violations:
        total.update(hi)
    shown = sorted(violations, key=lambda v: -sum(v[4].values()))[:args.show]
    if violations:
        verdict = (f"FAIL: {len(violations)} functions outside runtime-dispatched code use instructions above AVX2: "
                   + ", ".join(f"{f}={n}" for f, n in total.most_common()))
        out.append(verdict)
        for beg, end, lib, name, hi in shown:
            out.append(f"    {beg + bn.base:#x} +{end - beg:<6d} {lib[:50]}  {name[:60]}  "
                       + " ".join(f"{f}={n}" for f, n in sorted(hi.items())))
    else:
        verdict = "PASS: nothing outside runtime-dispatched code needs more than AVX2."
        out.append(verdict)
    print("\n".join(out))

    if args.report:
        md = [f"### Instruction check: `{args.binary.replace(chr(92), '/').split('/')[-1]}` ({bn.kind})", "",
              f"**{verdict}**", "",
              f"{len(bn.ranges)} code ranges decoded; attribution by {how}. "
              "Baseline: x86-64-v3 (AVX2, FMA, F16C, BMI2). Only CTranslate2/ruy and aws-lc, "
              "which check the CPU at run time, may go above it.", "",
              "| Library | Above AVX2 | Allowed |", "|---|---|---|"]
        md += [f"| {lib} | {feats} | {'yes, runtime-dispatched' if ok else '**no**'} |" for lib, ok, feats in rows]
        if not rows:
            md.append("| (none) | | |")
        if violations:
            md += ["", "| Address | Size | Library | Function | Instructions |", "|---|---|---|---|---|"]
            md += [f"| `{beg + bn.base:#x}` | {end - beg} | {lib} | `{name[:60]}` | "
                   + " ".join(f"{f}={n}" for f, n in sorted(hi.items())) + " |" for beg, end, lib, name, hi in shown]
        with open(args.report, "w") as f:
            f.write("\n".join(md) + "\n")
    return 1 if violations else 0


if __name__ == "__main__":
    sys.exit(main())
