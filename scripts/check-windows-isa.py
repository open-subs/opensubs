#!/usr/bin/env python3
"""Fail a Windows build whose exe uses instructions an ordinary x86-64 CPU lacks.

    python scripts/check-windows-isa.py target/release/opensubs-desktop.exe \
        --map target/release/deps/opensubs_desktop-<hash>.map

Why: v1.0.3-rc.13 died with an illegal instruction (0xc000001d) on every CPU
without AVX-512, because ggml (inside whisper.cpp) had been compiled for the
build runner's own CPU. The release workflow now pins ggml's instruction set,
and this script checks the result in the finished binary rather than in the
build configuration.

How: every function in the exe's .text (bounded by .pdata) is decoded with
iced-x86 and each instruction's CPUID features are collected. A function may
use features above the x86-64-v3 baseline (AVX2, FMA, F16C, BMI1/2, ...) only
if it belongs to a library that checks the CPU at run time before running
such code: CTranslate2 and ruy (ct2rs), and aws-lc. Anything else using
AVX-512, AVX-VNNI, AMX, or any other feature beyond the baseline fails.

Which library a function belongs to comes from the MSVC linker map
(`-C link-arg=/MAP`). Without a map -- an exe from an older release -- the
script falls back to the source paths and markers each function references
in .rdata, carrying a label forward to the functions after it; that is an
approximation and says so in its output.
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


def pe_sections(b):
    pe = struct.unpack_from("<I", b, 0x3C)[0]
    if b[pe:pe + 4] != b"PE\0\0":
        sys.exit("not a PE file")
    nsec = struct.unpack_from("<H", b, pe + 6)[0]
    optsz = struct.unpack_from("<H", b, pe + 20)[0]
    base = struct.unpack_from("<Q", b, pe + 24 + 24)[0]
    off = pe + 24 + optsz
    secs = {}
    for _ in range(nsec):
        name = b[off:off + 8].rstrip(b"\0").decode()
        vsz, va, rsz, rptr = struct.unpack_from("<IIII", b, off + 8)
        secs[name] = (va, vsz, rptr, rsz)
        off += 40
    return base, secs


def functions(b, secs):
    """Code ranges: every .pdata function, plus the gaps between them in .text.

    Leaf functions need no unwind entry, so .pdata alone would let one
    through; the gaps are decoded as ranges of their own.
    """
    va, vsz, rptr, _ = secs[".pdata"]
    out = set()
    for i in range(0, vsz - vsz % 12, 12):
        beg, end, _ = struct.unpack_from("<III", b, rptr + i)
        if beg:
            out.add((beg, end))
    fns = sorted(out)
    tva, tvsz, _, trsz = secs[".text"]
    gaps, at = [], tva
    for beg, end in fns:
        if beg > at:
            gaps.append((at, beg))
        at = max(at, end)
    if at < tva + min(tvsz, trsz):
        gaps.append((at, tva + min(tvsz, trsz)))
    return sorted(fns + [g for g in gaps if g[1] - g[0] >= 16])


def rva_to_off(secs, rva):
    for va, vsz, rptr, rsz in secs.values():
        if va <= rva < va + min(vsz, rsz):
            return rptr + rva - va
    return None


def string_at(b, secs, rva):
    o = rva_to_off(secs, rva)
    if o is None:
        return ""
    s = b[o:o + 200].split(b"\0")[0]
    if len(s) >= 4 and all(32 <= c < 127 for c in s):
        return s.decode()
    return ""


def read_map(path, base):
    """(rva, symbol, lib:object) from an MSVC /MAP file, sorted by rva."""
    line_re = re.compile(r"^\s*[0-9a-fA-F]{4}:[0-9a-fA-F]{8}\s+(\S+)\s+([0-9a-fA-F]{8,16})\s+(?:f\s+)?(?:i\s+)?(\S+)\s*$")
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = line_re.match(line)
            if not m:
                continue
            addr = int(m.group(2), 16)
            if addr >= base:
                out.append((addr - base, m.group(1), m.group(3)))
    out.sort()
    return out


# Markers in referenced strings, for the no-map fallback.
MARKERS = [
    (re.compile(r"whisper-rs-sys|ggml|whisper\.cpp", re.I), "whisper-rs-sys (ggml)"),
    (re.compile(r"ct2rs|CTranslate2|Kernel kAvx|RUY_|CT2_FORCE_CPU_ISA", re.I), "ct2rs (CTranslate2/ruy)"),
    (re.compile(r"aws-lc|AWS-LC~|aws_lc", re.I), "aws-lc-sys"),
    (re.compile(r"index\.crates\.io-[0-9a-f]+\\([A-Za-z0-9_.-]+?)-\d", re.I), None),
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
    ap.add_argument("exe")
    ap.add_argument("--map", help="MSVC linker map for this exe (-C link-arg=/MAP)")
    ap.add_argument("--show", type=int, default=25, help="violations to list")
    args = ap.parse_args()

    b = open(args.exe, "rb").read()
    base, secs = pe_sections(b)
    fns = functions(b, secs)
    rdata = secs.get(".rdata", (0, 0, 0, 0))

    sym = read_map(args.map, base) if args.map else None
    if args.map and len(sym) < 1000:
        sys.exit(f"{args.map}: only {len(sym)} symbols parsed -- not a linker map for this exe?")
    sym_rvas = [s[0] for s in sym] if sym else None

    carried = "unattributed"
    per_lib = collections.defaultdict(collections.Counter)  # lib -> feature -> count
    violations = []
    unknown_hi = 0
    for beg, end in fns:
        o = rva_to_off(secs, beg)
        if o is None:
            continue
        feats = collections.Counter()
        strings = []
        for ins in Decoder(64, b[o:o + end - beg], ip=beg):
            if ins.code == Code.INVALID:
                continue
            for f in ins.cpuid_features():
                feats[FEATURE.get(f, str(f))] += 1
            if not sym and ins.is_ip_rel_memory_operand:
                t = ins.ip_rel_memory_address
                if rdata[0] <= t < rdata[0] + rdata[1]:
                    s = string_at(b, secs, t)
                    if s:
                        strings.append(s)
        if sym:
            i = bisect.bisect_right(sym_rvas, beg) - 1
            lib = sym[i][2] if i >= 0 else "unattributed"
            name = sym[i][1] if i >= 0 else "?"
        else:
            found = label_from_strings(strings)
            if found:
                carried = found
            lib, name = carried, ("" if found else "(carried forward)")
        hi = {f: n for f, n in feats.items() if f not in BASELINE}
        if not hi:
            continue
        for f, n in hi.items():
            per_lib[lib][f] += n
        if not RUNTIME_DISPATCHED.search(lib):
            violations.append((beg, end, lib, name, hi))

    mode = "linker map " + args.map if sym else "no map: attribution from referenced strings (approximate)"
    print(f"{args.exe}\n  {len(fns)} code ranges (.pdata functions and the gaps between them), attribution by {mode}")
    print("  features above the x86-64-v3 baseline, by library:")
    for lib, c in sorted(per_lib.items(), key=lambda kv: -sum(kv[1].values())):
        ok = "allowed (runtime-dispatched)" if RUNTIME_DISPATCHED.search(lib) else "NOT ALLOWED"
        print(f"    {lib[:70]:70s} {ok}: " + ", ".join(f"{f}={n}" for f, n in c.most_common(6)))
    if not violations:
        print("PASS: nothing outside runtime-dispatched code needs more than AVX2.")
        return 0
    total = collections.Counter()
    for *_, hi in violations:
        total.update(hi)
    print(f"FAIL: {len(violations)} functions outside runtime-dispatched code use instructions above AVX2: "
          + ", ".join(f"{f}={n}" for f, n in total.most_common()))
    for beg, end, lib, name, hi in sorted(violations, key=lambda v: -sum(v[4].values()))[:args.show]:
        print(f"    rva {beg:#09x} +{end - beg:<6d} {lib[:60]} {name[:50]}  "
              + " ".join(f"{f}={n}" for f, n in sorted(hi.items())))
    return 1


if __name__ == "__main__":
    sys.exit(main())
