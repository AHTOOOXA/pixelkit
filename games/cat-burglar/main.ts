// Effects sandbox: the test street. Every effect has a key, and the time of day has a slider.
import { Atlas } from '../../engine/sprites';
import { Draw, FX, FxKey, Light, Renderer } from '../../engine/renderer';
import { dayAt, nightness } from '../../engine/time';
import { Art, ROAD_BOT, ROAD_TOP, WORLD_H, WORLD_W, buildArt } from './art';

const W = 320, H = 180;
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = W; canvas.height = H;
let r: Renderer;
try {
  r = new Renderer(canvas, W, H);
} catch (e) {
  document.body.innerHTML = '<p style="padding:24px;text-align:center">This demo needs WebGL2, which this browser or device does not provide.</p>';
  throw e;
}
const atlas = new Atlas();
const art: Art = buildArt(atlas);
r.upload(atlas);

const WARM: [number, number, number] = [1.7, .98, .36];
const lamps: [number, number][] = [[196, 148], [410, 148], [296, 232], [548, 232]];
const statics: Draw[] = [{ sprite: art.ground, x: WORLD_W / 2, y: 0, ground: true }];
const add = (d: Draw) => statics.push(d);
add({ sprite: art.cottages[0], x: 96, y: 138 }); add({ sprite: art.cottages[1], x: 306, y: 138 }); add({ sprite: art.cottages[0], x: 516, y: 138 });
add({ sprite: art.tree, x: 196, y: 120, sway: 1.1, phase: 1 }); add({ sprite: art.tree, x: 610, y: 150, sway: 1.1, phase: 2.4 });
add({ sprite: art.tree, x: 250, y: 330, sway: 1.1, phase: 4 }); add({ sprite: art.tree, x: 600, y: 340, sway: 1.1, phase: .4 });
add({ sprite: art.stall, x: 450, y: 296 });
add({ sprite: art.barrel, x: 150, y: 146 }); add({ sprite: art.barrel, x: 166, y: 148 }); add({ sprite: art.crate, x: 240, y: 146 });
add({ sprite: art.crate, x: 500, y: 304 }); add({ sprite: art.barrel, x: 396, y: 300 });
for (const [x, y] of lamps) add({ sprite: art.lamp, x, y });

interface Tuft { d: Draw; x: number; y: number }
const tufts: Tuft[] = [];
for (let y = 248; y < 346; y += 8) for (let x = 26; x < 192; x += 10) {
  const jx = x + ((y * 7) % 5) - 2, jy = y + ((x * 3) % 3);
  if (Math.hypot((jx - 108) / 90, (jy - 294) / 56) > 1) continue;
  const d: Draw = { sprite: art.wheat[(x + y) % 3], x: jx, y: jy, sway: 2.6, phase: jx * .09 + jy * .13 };
  tufts.push({ d, x: jx, y: jy }); add(d);
}

const cat = { x: 300, y: 200, dir: 'side', flip: false, frame: 0, moving: false };
const walker = { x: 140, y: 214, vx: 22, frame: 0 };
const keys = new Set<string>();
const mouse = { x: 0, y: 0, on: false };
const state = { auto: false, t: .02 };

const FX_KEYS: [string, FxKey | 'palette', string][] = [
  ['1', 'ambient', 'ambient light'], ['2', 'lut', 'LUT grading'], ['3', 'normals', 'normal maps'], ['4', 'rule3d', '3D light rule'],
  ['5', 'shadows', 'sprite shadows'], ['6', 'fog', 'fog'], ['7', 'wind', 'wind'], ['8', 'palette', 'palette snap'], ['9', 'bands', 'light bands'],
];
const panel = document.getElementById('panel')!, slider = document.getElementById('time') as HTMLInputElement, label = document.getElementById('label')!;
const paletteName = () => !FX.palette ? 'off' : r.palette ? 'Sweetie-16' : 'Endesga-32';
function drawPanel() {
  panel.innerHTML = FX_KEYS.map(([k, f, n]) => {
    const on = FX[f as FxKey];
    return `<div class="${on ? 'on' : 'off'}"><b>${k}</b> ${n}${f === 'palette' ? ': ' + paletteName() : ''}</div>`;
  }).join('') + `<div class="${mouse.on ? 'on' : 'off'}"><b>L</b> mouse light</div><div class="${state.auto ? 'on' : 'off'}"><b>T</b> run time</div>`;
}
function press(k: string) {
  const hit = FX_KEYS.find(e => e[0] === k);
  if (hit) {
    if (hit[1] === 'palette') {               // cycle Endesga-32 -> Sweetie-16 -> off
      if (FX.palette && r.palette === 0) r.palette = 1;
      else if (FX.palette) FX.palette = false;
      else { FX.palette = true; r.palette = 0; }
    } else FX[hit[1]] = !FX[hit[1]];
  }
  if (k === 'l') mouse.on = !mouse.on;
  if (k === 't') state.auto = !state.auto;
  drawPanel();
}
// e.code is the physical key, so controls work on any keyboard layout (Russian, AZERTY, Dvorak).
const keyName = (code: string) => code.replace(/^(Key|Digit|Numpad)/, '').toLowerCase();
addEventListener('keydown', e => {
  const k = keyName(e.code); keys.add(k);
  if (!e.repeat) press(k);
  if (k.startsWith('arrow') || k === 'space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(keyName(e.code)));
addEventListener('blur', () => keys.clear());   // don't keep walking after alt-tab
canvas.addEventListener('pointermove', e => {
  const b = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - b.left) / b.width * W + r.camX; mouse.y = (e.clientY - b.top) / b.height * H + r.camY;
});
slider.addEventListener('input', () => { state.t = +slider.value / 1000; });

function fit() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H)));
  canvas.style.width = W * s + 'px'; canvas.style.height = H * s + 'px';
}
addEventListener('resize', fit); fit();

let clock = 0;
function step(dt: number) {
  clock += dt;
  if (state.auto) { state.t = (state.t + dt / 60) % 1; slider.value = String(Math.round(state.t * 1000)); }
  r.dayT = state.t;
  r.fog = .08 + .37 * nightness(state.t);
  label.textContent = dayAt(state.t).name;
  r.time = Math.floor(clock * 12) / 12;      // everything animates on a stepped 12 fps clock
  const pulse = Math.max(0, Math.sin(clock * .45));
  r.wind = .12 + pulse ** 6 * 1.3;           // calm with occasional gusts

  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx--;
  if (keys.has('arrowright') || keys.has('d')) dx++;
  if (keys.has('arrowup') || keys.has('w')) dy--;
  if (keys.has('arrowdown') || keys.has('s')) dy++;
  cat.moving = !!(dx || dy);
  if (cat.moving) {
    const m = Math.hypot(dx, dy) || 1, sp = 46;
    cat.x = Math.max(12, Math.min(WORLD_W - 12, cat.x + dx / m * sp * dt));
    cat.y = Math.max(20, Math.min(WORLD_H - 4, cat.y + dy / m * sp * dt));
    cat.frame += dt * 8;
    if (dx) { cat.dir = 'side'; cat.flip = dx < 0; } else cat.dir = dy < 0 ? 'up' : 'down';
  }
  walker.x += walker.vx * dt; walker.frame += dt * 4;
  if (walker.x > 590 || walker.x < 40) walker.vx *= -1;

  for (const t of tufts) {                    // bodies part the wheat
    let bend = 0;
    for (const b of [cat, walker]) {
      const d = Math.hypot(t.x - b.x, (t.y - b.y) * 1.6);
      if (d < 16) bend += (t.x >= b.x ? 1 : -1) * (1 - d / 16) * 6;
    }
    t.d.bend = bend;
  }
  r.camX = Math.max(0, Math.min(WORLD_W - W, cat.x - W / 2));
  r.camY = Math.max(0, Math.min(WORLD_H - H, cat.y - H / 2 - 10));
}

function frame() {
  const f = Math.floor(cat.frame);
  const set = cat.dir === 'side' ? art.catSide : cat.dir === 'up' ? art.catUp : art.catDown;
  const catSprite = cat.moving ? set[f % set.length] : set[cat.dir === 'side' ? 1 : 0];
  const lanternSide = walker.vx > 0 ? 9 : -9;
  const flick = 1 + Math.sin(r.time * 9) * .03 + Math.sin(r.time * 23) * .02;
  const n = nightness(state.t), dim = (c: [number, number, number]): [number, number, number] => [c[0] * n, c[1] * n, c[2] * n];
  const lights: Light[] = lamps.map(([x, y]) => ({ x, y: y + 1, z: 42, radius: 108 * flick, color: dim(WARM) }));
  lights.push({ x: walker.x + lanternSide, y: walker.y + 2, z: 22, radius: 70 * flick, color: dim([1.5, .84, .3]) });
  for (const wx of [96, 306, 516]) for (const ox of [-33, 35]) lights.push({ x: wx + ox, y: 142, z: 24, radius: 30, color: dim([.55, .34, .14]) });
  if (mouse.on) lights.unshift({ x: mouse.x, y: mouse.y, z: 26, radius: 90, color: [.9, .95, 1.1] });
  const draws: Draw[] = [...statics,
    { sprite: catSprite, x: cat.x, y: cat.y, flip: cat.flip },
    { sprite: art.villager[Math.floor(walker.frame) % 2], x: walker.x, y: walker.y, flip: walker.vx < 0 },
    { sprite: art.lantern, x: walker.x + lanternSide, y: walker.y + 1, elev: 13, noShadow: true },
  ];
  r.render(draws, lights);
}

drawPanel();
let last = performance.now();
function loop(now: number) {
  step(Math.max(0, Math.min(.05, (now - last) / 1000))); last = now; frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

Object.assign(window, { __pk: { r, FX, state, cat, walker, step, frame, press, drawPanel, ROAD_TOP, ROAD_BOT, WORLD_H } }); // test hooks
