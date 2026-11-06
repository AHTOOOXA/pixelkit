// Palettes and the colour tables built from them.
export type RGB = [number, number, number];

export const hex = (h: string): RGB => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const ENDESGA32 = ('be4a2f d77643 ead4aa e4a672 b86f50 733e39 3e2731 a22633 e43b44 f77622 feae34 fee761 ' +
  '63c74d 3e8948 265c42 193c3e 124e89 0099db 2ce8f5 ffffff c0cbdc 8b9bb4 5a6988 3a4466 262b44 181425 ff0044 ' +
  '68386c b55088 f6757a e8b796 c28569').split(' ').map(hex);

export const SWEETIE16 = ('1a1c2c 5d275d b13e53 ef7d57 ffcd75 a7f070 38b764 257179 29366f 3b5dc9 41a6f6 73eff7 ' +
  'f4f4f4 94b0c2 566c86 333c57').split(' ').map(hex);

// OKLab: nearest-colour matches that look right to the eye, unlike raw RGB distance.
function oklab([r, g, b]: RGB): RGB {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122 * R + 0.5363 * G + 0.0514 * B);
  const m = Math.cbrt(0.2119 * R + 0.6807 * G + 0.1074 * B);
  const s = Math.cbrt(0.0883 * R + 0.2817 * G + 0.6300 * B);
  return [0.2105 * l + 0.7936 * m - 0.0041 * s, 1.9780 * l - 2.4286 * m + 0.4506 * s, 0.0259 * l + 0.7828 * m - 0.8087 * s];
}

/** N^3 table mapping any colour to its nearest palette entry. */
export function paletteTable(pal: RGB[], n = 32): Uint8Array {
  const labs = pal.map(oklab), out = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const c = oklab([r * 255 / (n - 1), g * 255 / (n - 1), b * 255 / (n - 1)]);
    let best = 0, bd = 1e9;
    for (let i = 0; i < labs.length; i++) {
      const d = (c[0] - labs[i][0]) ** 2 + (c[1] - labs[i][1]) ** 2 + (c[2] - labs[i][2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    out[o++] = pal[best][0]; out[o++] = pal[best][1]; out[o++] = pal[best][2]; out[o++] = 255;
  }
  return out;
}

export interface Grade { tint: RGB; sat: number; gamma: number; lift: RGB; gain: number }

/** 16^3 colour-grading LUT, the code version of the article's painted LUTs. Tint is 0..1 per channel. */
export function gradeTable(g: Grade, n = 16): Uint8Array {
  const out = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let b = 0; b < n; b++) for (let gg = 0; gg < n; gg++) for (let r = 0; r < n; r++) {
    const c = [r / (n - 1), gg / (n - 1), b / (n - 1)];
    const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    for (let i = 0; i < 3; i++) {
      const s = lum + (c[i] - lum) * g.sat;
      const v = Math.pow(Math.max(s, 0), g.gamma) * g.gain * g.tint[i] + g.lift[i] * (1 - lum);
      out[o++] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    out[o++] = 255;
  }
  return out;
}
