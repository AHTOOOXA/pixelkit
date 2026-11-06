// Sprite canvas: colour plus a per-pixel surface description, packed into one atlas.
// Normals come from three sources mixed together:
//   tilt   - painted surface direction (a roof faces up)
//   bump   - painted height, turned into normals with a Sobel pass
//   bevel  - rounding derived from the silhouette, so flat art gets volume for free
import { RGB } from './palette';

export class Canvas {
  rgb: Uint8Array; alpha: Uint8Array; bump: Float32Array; tx: Float32Array; ty: Float32Array; emit: Uint8Array;
  constructor(public w: number, public h: number) {
    const n = w * h;
    this.rgb = new Uint8Array(n * 3); this.alpha = new Uint8Array(n); this.bump = new Float32Array(n);
    this.tx = new Float32Array(n); this.ty = new Float32Array(n); this.emit = new Uint8Array(n);
  }
  in(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  px(x: number, y: number, c: RGB, o: { bump?: number; tx?: number; ty?: number; emit?: number } = {}) {
    x |= 0; y |= 0; if (!this.in(x, y)) return;
    const i = y * this.w + x;
    this.rgb[i * 3] = c[0]; this.rgb[i * 3 + 1] = c[1]; this.rgb[i * 3 + 2] = c[2]; this.alpha[i] = 255;
    if (o.bump !== undefined) this.bump[i] = o.bump;
    if (o.tx !== undefined) this.tx[i] = o.tx;
    if (o.ty !== undefined) this.ty[i] = o.ty;
    if (o.emit !== undefined) this.emit[i] = o.emit;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, o = {}) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, o);
  }
  /** Sphere-shaded blob with clustered colour bands: for foliage, bushes, stones. */
  blob(cx: number, cy: number, r: number, shades: RGB[], rand: () => number) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y) / r;
      if (d > 1 - rand() * 0.12) continue;
      const nx = x / r, ny = -y / r;
      const lit = (ny * 0.7 - nx * 0.25 + 1) / 2 + (rand() - 0.5) * 0.16;
      const c = shades[Math.max(0, Math.min(shades.length - 1, Math.floor(lit * shades.length)))];
      this.px(cx + x, cy + y, c, { tx: nx * 0.8, ty: ny * 0.8 });
    }
  }
  /** Paint from a text grid. */
  grid(rows: string[], map: Record<string, RGB>, ox = 0, oy = 0, o: Record<string, { emit?: number }> = {}) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (map[ch]) this.px(ox + x, oy + y, map[ch], o[ch] ?? {}); }));
  }
}

export interface Sprite { w: number; h: number; u: number; v: number; shadow: boolean }

const SIZE = 2048;
export class Atlas {
  color = new Uint8Array(SIZE * SIZE * 4);
  normal = new Uint8Array(SIZE * SIZE * 4);
  size = SIZE;
  private x = 1; private y = 1; private rowH = 0;

  add(c: Canvas, opt: { bevel?: number; shadow?: boolean } = {}): Sprite {
    if (this.x + c.w + 1 > SIZE) { this.x = 1; this.y += this.rowH + 1; this.rowH = 0; }
    if (this.y + c.h + 1 > SIZE) throw new Error('atlas full');
    const u = this.x, v = this.y;
    this.x += c.w + 1; this.rowH = Math.max(this.rowH, c.h);
    const bevel = opt.bevel ?? 0.7, dist = bevel ? edgeDistance(c) : null;
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const i = y * c.w + x, o = ((v + y) * SIZE + u + x) * 4;
      this.color[o] = c.rgb[i * 3]; this.color[o + 1] = c.rgb[i * 3 + 1]; this.color[o + 2] = c.rgb[i * 3 + 2]; this.color[o + 3] = c.alpha[i];
      const b = (dx: number, dy: number) => {
        const X = Math.max(0, Math.min(c.w - 1, x + dx)), Y = Math.max(0, Math.min(c.h - 1, y + dy));
        return c.bump[Y * c.w + X];
      };
      let nx = c.tx[i] + (b(-1, 0) - b(1, 0)) * 0.5;
      let ny = c.ty[i] + (b(0, 1) - b(0, -1)) * 0.5;
      if (dist) {
        const d = (dx: number, dy: number) => {
          const X = x + dx, Y = y + dy;
          return X < 0 || Y < 0 || X >= c.w || Y >= c.h ? 0 : dist[Y * c.w + X];
        };
        nx += (d(-1, 0) - d(1, 0)) * bevel * 0.5;
        ny += (d(0, 1) - d(0, -1)) * bevel * 0.5;
      }
      const m = Math.hypot(nx, ny); if (m > 0.95) { nx *= 0.95 / m; ny *= 0.95 / m; }
      this.normal[o] = Math.round((nx * 0.5 + 0.5) * 255);
      this.normal[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      this.normal[o + 2] = c.emit[i];
      this.normal[o + 3] = 255;
    }
    return { w: c.w, h: c.h, u, v, shadow: opt.shadow ?? true };
  }
}

/** Distance to the nearest transparent pixel, capped: rounds off only the outer few pixels. */
function edgeDistance(c: Canvas, cap = 4): Float32Array {
  const d = new Float32Array(c.w * c.h);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!c.alpha[y * c.w + x]) continue;
    let best = cap;
    for (let j = -cap; j <= cap; j++) for (let i = -cap; i <= cap; i++) {
      const X = x + i, Y = y + j;
      if (X < 0 || Y < 0 || X >= c.w || Y >= c.h || !c.alpha[Y * c.w + X]) best = Math.min(best, Math.hypot(i, j));
    }
    d[y * c.w + x] = best;
  }
  return d;
}
