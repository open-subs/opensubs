const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
/** SHA-256 of an ASCII string. Returns the eight state words. */
export function sha256Words(text) {
    const len = text.length;
    const blocks = ((len + 9 + 63) >> 6) << 4; // 32-bit words, padded
    const m = new Uint32Array(blocks);
    for (let i = 0; i < len; i++)
        m[i >> 2] |= (text.charCodeAt(i) & 0xff) << (24 - (i & 3) * 8);
    m[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
    m[blocks - 1] = len * 8;
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    for (let off = 0; off < blocks; off += 16) {
        for (let t = 0; t < 16; t++)
            W[t] = m[off + t];
        for (let t = 16; t < 64; t++) {
            const a = W[t - 15], b = W[t - 2];
            const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
            const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
            W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let t = 0; t < 64; t++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[t] + W[t]) | 0;
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g;
            g = f;
            f = e;
            e = (d + t1) | 0;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
        h5 = (h5 + f) | 0;
        h6 = (h6 + g) | 0;
        h7 = (h7 + h) | 0;
    }
    return new Uint32Array([h0, h1, h2, h3, h4, h5, h6, h7]);
}
/** Leading zero bits of a digest given as state words. */
export function leadingZeroBits(words) {
    let bits = 0;
    for (const w of words) {
        if (w === 0) {
            bits += 32;
            continue;
        }
        return bits + Math.clz32(w);
    }
    return bits;
}
/** Solve a challenge. Rejects with an AbortError if `signal` aborts. */
export async function solvePow(challenge, signal) {
    const prefix = `${challenge.salt}:`;
    const yieldEvery = 4096;
    for (let nonce = 0;; nonce++) {
        if (leadingZeroBits(sha256Words(prefix + nonce)) >= challenge.bits) {
            return {
                salt: challenge.salt,
                bits: challenge.bits,
                signature: challenge.signature,
                nonce: String(nonce),
            };
        }
        if (nonce % yieldEvery === yieldEvery - 1) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (signal?.aborted)
                throw new DOMException("aborted", "AbortError");
        }
    }
}
//# sourceMappingURL=pow.js.map