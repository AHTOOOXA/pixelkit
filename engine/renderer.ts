// WebGL2 renderer. Three passes, all at the low internal resolution:
//   1. sprites  -> albedo + normal/emissive/height targets
//   2. shadows  -> one channel per light slot (r = sun/moon, gba = lamps)
//   3. compose  -> lights, fog, LUT, palette snap, straight to the canvas
import { COMPOSE_FS, MAX_LIGHTS, QUAD_VS, SHADOW_FS, SHADOW_VS, SPRITE_FS, SPRITE_VS } from './shaders';
import { ENDESGA32, SWEETIE16, gradeTable, paletteTable } from './palette';
import { DAY, dayAt } from './time';
import { Atlas, Sprite } from './sprites';

export interface Light { x: number; y: number; z: number; radius: number; color: [number, number, number]; slot?: number }

export interface Draw {
  sprite: Sprite; x: number; y: number;  // x = foot centre, y = ground row of the foot, world pixels
  flip?: boolean; ground?: boolean; sway?: number; phase?: number; bend?: number; elev?: number; noShadow?: boolean;
}

export const FX = { ambient: true, lut: true, normals: true, rule3d: true, shadows: true, fog: true, wind: true, palette: false, bands: true };
export type FxKey = keyof typeof FX;

const PAD = 5, MAX_DRAWS = 4096;

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const cache: Record<string, WebGLUniformLocation | null> = {};
  return { p, u: (n: string) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private sprite; private shadow; private compose;
  private quad: WebGLBuffer; private inst: WebGLBuffer; private vaoS: WebGLVertexArrayObject; private vaoH: WebGLVertexArrayObject; private vaoQ: WebGLVertexArrayObject;
  private data = new Float32Array(MAX_DRAWS * 20);
  private fbScene: WebGLFramebuffer; private fbShadow: WebGLFramebuffer;
  private tAlbedo: WebGLTexture; private tNormalRT: WebGLTexture; private tShadow: WebGLTexture;
  private tColor!: WebGLTexture; private tNormal!: WebGLTexture;
  private luts: WebGLTexture[]; private pals: WebGLTexture[];
  palette = 0;   // 0 = Endesga-32, 1 = Sweetie-16
  camX = 0; camY = 0; time = 0; wind = 0; fog = 0.45; fogHeight = 26; dayT = 0.05; bands = 5; dither = 0.02;

  constructor(public canvas: HTMLCanvasElement, public W: number, public H: number) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.sprite = program(gl, SPRITE_VS, SPRITE_FS);
    this.shadow = program(gl, SHADOW_VS, SHADOW_FS);
    this.compose = program(gl, QUAD_VS, COMPOSE_FS);

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const vao = (attrs: number) => {
      const v = gl.createVertexArray()!; gl.bindVertexArray(v);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      if (attrs) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
        for (let i = 0; i < attrs; i++) {
          gl.enableVertexAttribArray(i + 1);
          gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, 80, i * 16);
          gl.vertexAttribDivisor(i + 1, 1);
        }
      }
      gl.bindVertexArray(null); return v;
    };
    this.vaoS = vao(4); this.vaoH = vao(4); this.vaoQ = vao(0);

    const rt = () => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    this.tAlbedo = rt(); this.tNormalRT = rt(); this.tShadow = rt();
    this.fbScene = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbScene);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tAlbedo, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.tNormalRT, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.fbShadow = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbShadow);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tShadow, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const tex3 = (n: number, data: Uint8Array, filter: number) => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, n, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_3D, p, filter);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.luts = DAY.map(k => tex3(16, gradeTable(k.grade), gl.LINEAR));
    this.pals = [ENDESGA32, SWEETIE16].map(p => tex3(32, paletteTable(p), gl.NEAREST));
  }

  upload(a: Atlas) {
    const gl = this.gl;
    const up = (d: Uint8Array) => {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, a.size, a.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    this.tColor = up(a.color); this.tNormal = up(a.normal);
  }

  private bind(unit: number, target: number, t: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); gl.uniform1i(loc, unit);
  }

  /** Up to 3 lamps cast shadows, nearest to each object, plus the sun or moon. */
  private shadowsFor(d: Draw, lights: Light[], day: ReturnType<typeof dayAt>, out: Float32Array, n: number) {
    const s = d.sprite, cx = this.camX, cy = this.camY;
    const push = (dx: number, dy: number, len: number, strength: number, chan: number) => {
      // A flat sprite lit from the side projects to a thin line, so stack copies to give it body.
      const body = Math.max(0, 1 - Math.abs(dy) / 0.45) * s.w * 0.14;
      for (const off of body > 1 ? [-body, 0, body] : [0]) {
        out.set([d.x - cx, d.y - cy + off, dx, dy, s.w * 0.5, len, strength, d.flip ? 1 : 0, s.u, s.v, s.w, s.h,
          chan === 0 ? 1 : 0, chan === 1 ? 1 : 0, chan === 2 ? 1 : 0, chan === 3 ? 1 : 0], n * 20);
        n++;
      }
    };
    const [sx, sy, sz] = day.sunDir, m = Math.hypot(sx, sy) || 1;
    push(-sx / m, -sy / m, Math.min(s.h * 2.2, s.h * 0.9 * m / Math.max(sz, 0.25)), 1, 0);
    const near = lights.map(l => ({ l, dist: Math.hypot(l.x - d.x, l.y - d.y) }))
      .filter(e => e.dist < e.l.radius && e.dist > 1).sort((a, b) => a.dist - b.dist).slice(0, 3);
    for (const { l, dist } of near) {
      const fall = 1 - dist / l.radius, over = Math.max(l.z - s.h * 0.75, 6);
      push((d.x - l.x) / dist, (d.y - l.y) / dist, Math.min(s.h * 3, s.h * dist / over + 4), Math.min(1, fall * 2.4), 1 + (l.slot ?? 0));
    }
    return n;
  }

  render(draws: Draw[], lights: Light[]) {
    const gl = this.gl, W = this.W, H = this.H, day = dayAt(this.dayT);
    const cx = Math.round(this.camX), cy = Math.round(this.camY);
    this.camX = cx; this.camY = cy;
    lights.slice(0, MAX_LIGHTS).forEach((l, i) => { l.slot = i % 3; });

    // Painter's order: ground first, then by foot row.
    const ordered = [...draws].sort((a, b) => (a.ground ? -1e6 : a.y) - (b.ground ? -1e6 : b.y));
    let n = 0;
    for (const d of ordered) {
      const s = d.sprite, o = n * 20, pad = d.ground ? 0 : PAD;
      const x = Math.round(d.x - s.w / 2) - cx - pad, y = d.ground ? Math.round(d.y) - cy : Math.round(d.y) - s.h - cy - Math.round(d.elev ?? 0);
      if (x > W || y > H || x + s.w + pad * 2 < 0 || y + s.h < 0) continue;
      this.data.set([x, y, s.w + pad * 2, s.h, s.u, s.v, s.w, s.h, d.flip ? 1 : 0, d.ground ? 1 : 0, d.sway ?? 0, d.phase ?? 0, pad, d.bend ?? 0, d.elev ?? 0, 0], o);
      n++;
    }
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbScene);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.sprite.p);
    gl.uniform2f(this.sprite.u('uScreen'), W, H);
    gl.uniform1f(this.sprite.u('uTime'), this.time);
    gl.uniform1f(this.sprite.u('uWind'), this.wind);
    gl.uniform1f(this.sprite.u('uSway'), FX.wind ? 1 : 0);
    this.bind(0, gl.TEXTURE_2D, this.tColor, this.sprite.u('tColor'));
    this.bind(1, gl.TEXTURE_2D, this.tNormal, this.sprite.u('tNormal'));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, n * 20);
    gl.bindVertexArray(this.vaoS);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);

    let m = 0;
    for (const d of ordered) if (!d.ground && !d.noShadow && d.sprite.shadow) m = this.shadowsFor(d, lights, day, this.data, m);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbShadow);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.shadow.p);
    gl.uniform2f(this.shadow.u('uScreen'), W, H);
    this.bind(0, gl.TEXTURE_2D, this.tColor, this.shadow.u('tColor'));
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, m * 20);
    gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.vaoH);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, m);
    gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = this.compose;
    gl.useProgram(c.p);
    this.bind(0, gl.TEXTURE_2D, this.tAlbedo, c.u('tAlbedo'));
    this.bind(1, gl.TEXTURE_2D, this.tNormalRT, c.u('tNormal'));
    this.bind(2, gl.TEXTURE_2D, this.tShadow, c.u('tShadow'));
    this.bind(3, gl.TEXTURE_3D, this.luts[day.a], c.u('tLutA'));
    this.bind(4, gl.TEXTURE_3D, this.luts[day.b], c.u('tLutB'));
    this.bind(5, gl.TEXTURE_3D, this.pals[this.palette], c.u('tPal'));
    gl.uniform2f(c.u('uCam'), cx, cy);
    gl.uniform1f(c.u('uH'), H); gl.uniform1f(c.u('uTime'), this.time); gl.uniform1f(c.u('uLutMix'), day.mix);
    gl.uniform1f(c.u('uFogH'), this.fogHeight); gl.uniform1f(c.u('uFog'), this.fog);
    gl.uniform1f(c.u('uBands'), this.bands); gl.uniform1f(c.u('uDither'), this.dither);
    gl.uniform3fv(c.u('uAmbient'), day.ambient); gl.uniform3fv(c.u('uSun'), day.sun); gl.uniform3fv(c.u('uSunDir'), day.sunDir);
    const cnt = Math.min(lights.length, MAX_LIGHTS), pos = new Float32Array(MAX_LIGHTS * 4), col = new Float32Array(MAX_LIGHTS * 4);
    for (let i = 0; i < cnt; i++) {
      const l = lights[i];
      pos.set([l.x, l.y, l.z, l.radius], i * 4); col.set([...l.color, l.slot ?? 0], i * 4);
    }
    gl.uniform1i(c.u('uCount'), cnt);
    gl.uniform4fv(c.u('uLightPos'), pos); gl.uniform4fv(c.u('uLightCol'), col);
    const flag = (name: string, on: boolean) => gl.uniform1f(c.u(name), on ? 1 : 0);
    flag('fAmbient', FX.ambient); flag('fLut', FX.lut); flag('fNormals', FX.normals); flag('fRule', FX.rule3d);
    flag('fShadows', FX.shadows); flag('fFog', FX.fog); flag('fPal', FX.palette); flag('fBands', FX.bands);
    gl.bindVertexArray(this.vaoQ);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /** Distinct colours on screen, for the pixel-integrity check. */
  colourCount() {
    const gl = this.gl, b = new Uint8Array(this.W * this.H * 4);
    gl.readPixels(0, 0, this.W, this.H, gl.RGBA, gl.UNSIGNED_BYTE, b);
    const s = new Set<number>();
    for (let i = 0; i < b.length; i += 4) s.add(b[i] << 16 | b[i + 1] << 8 | b[i + 2]);
    return s.size;
  }
}
