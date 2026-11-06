// Placeholder art, all drawn in code. Step 2 replaces the big pieces with generated art.
import { Atlas, Canvas, Sprite } from '../../engine/sprites';
import { RGB, hex } from '../../engine/palette';

const c = (h: string): RGB => hex(h);
export const C = {
  rust: c('be4a2f'), orange: c('d77643'), sand: c('ead4aa'), tan: c('e4a672'), clay: c('b86f50'), brown: c('733e39'),
  dark: c('3e2731'), red: c('a22633'), scarlet: c('e43b44'), flame: c('f77622'), gold: c('feae34'), yellow: c('fee761'),
  leaf: c('63c74d'), green: c('3e8948'), forest: c('265c42'), deep: c('193c3e'), blue: c('124e89'), sky: c('0099db'),
  cyan: c('2ce8f5'), white: c('ffffff'), ash: c('c0cbdc'), grey: c('8b9bb4'), slate: c('5a6988'), steel: c('3a4466'),
  ink: c('262b44'), black: c('181425'), plum: c('68386c'), skin: c('e8b796'),
};

let seed = 1234;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

export const WORLD_W = 640, WORLD_H = 360;
export const ROAD_TOP = 150, ROAD_BOT = 226;

function ground(): Canvas {
  const g = new Canvas(WORLD_W, WORLD_H);
  const wave = (x: number, y: number) => Math.sin(x * .031 + y * .017) + Math.sin(y * .043 - x * .021) + Math.sin((x + y) * .083) * .5;
  for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const n = wave(x, y) + (rnd() - .5) * .7;
    const col = n > .9 ? C.forest : n > -.5 ? C.green : C.forest;
    g.px(x, y, rnd() < .02 ? C.leaf : col, { bump: rnd() * .5 });
  }
  // Cobbled street: jittered cells, each stone domed by distance to its centre.
  const S = 8, cols = Math.ceil(WORLD_W / S) + 2, rows = Math.ceil((ROAD_BOT - ROAD_TOP) / S) + 2;
  const cells: { x: number; y: number; c: RGB }[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++)
    cells.push({ x: i * S + (j % 2) * 4 + rnd() * 4 - 2 - S, y: ROAD_TOP + j * S + rnd() * 4 - 2 - S, c: pick([C.slate, C.slate, C.steel, C.grey]) });
  for (let y = ROAD_TOP; y < ROAD_BOT; y++) for (let x = 0; x < WORLD_W; x++) {
    const edge = Math.min(y - ROAD_TOP, ROAD_BOT - 1 - y) + Math.sin(x * .3) * 1.5;
    if (edge < 0) continue;
    let d1 = 1e9, d2 = 1e9, best = cells[0];
    const i0 = Math.floor((x + S) / S), j0 = Math.floor((y - ROAD_TOP + S) / S);
    for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) {
      const k = cells[j * cols + i]; if (!k) continue;
      const d = Math.hypot(x - k.x, y - k.y);
      if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
    }
    const gap = d2 - d1 < 1.1;
    g.px(x, y, gap ? C.ink : best.c, { bump: gap ? 0 : Math.max(0, 2.2 - d1 * .42) });
  }
  // Dirt under the wheat.
  for (let y = 240; y < 348; y++) for (let x = 20; x < 196; x++) {
    if (Math.hypot((x - 108) / 92, (y - 294) / 58) > 1) continue;
    g.px(x, y, rnd() < .3 ? C.dark : C.brown, { bump: rnd() });
  }
  return g;
}

function cottage(wallA: RGB, wallB: RGB, roofA: RGB, roofB: RGB): Canvas {
  const w = 108, h = 96, k = new Canvas(w, h), eave = 46;
  for (let y = 12; y < eave; y++) {                     // shingle roof: faces up, not at the camera
    const inset = Math.round((eave - y) * .28);
    for (let x = inset; x < w - inset; x++) {
      const row = Math.floor((y - 12) / 4), off = row % 2 ? 3 : 0;
      const seam = (x + off) % 6 === 0 || (y - 12) % 4 === 3;
      const col = seam ? C.dark : (((x + off) / 6 | 0) * 7 + row * 3) % 5 === 0 ? roofB : roofA;
      k.px(x, y, col, { ty: .72, bump: seam ? 0 : 1 });
    }
  }
  k.rect(82, 0, 12, 20, C.slate, { ty: .1 }); k.rect(80, 0, 16, 3, C.steel); // chimney
  for (let y = 4; y < 20; y += 4) for (let x = 82 + (y % 8 ? 0 : 3); x < 94; x += 6) k.rect(x, y, 1, 3, C.steel, { bump: 0 });
  for (let y = eave; y < h; y++) for (let x = 3; x < w - 3; x++)
    k.px(x, y, rnd() < .12 ? wallB : wallA, { ty: -.05, bump: rnd() * .35 });
  k.rect(1, eave, w - 2, 3, C.dark, { ty: -.6 });         // shaded eave
  for (const x of [3, 34, 72, w - 7]) k.rect(x, eave + 3, 4, h - eave - 9, C.brown, { bump: 1.5 });
  k.rect(3, eave + 16, w - 6, 3, C.brown, { bump: 1.5 });
  for (let y = h - 8; y < h; y++) for (let x = 3; x < w - 3; x++)
    k.px(x, y, ((x + (y % 4 < 2 ? 3 : 0)) % 7 === 0 || y % 4 === 3) ? C.ink : (rnd() < .4 ? C.slate : C.grey), { bump: (y % 4 === 3) ? 0 : 1 });
  const win = (x: number, y: number) => {
    k.rect(x - 2, y - 2, 21, 21, C.dark, { bump: 2 });
    for (let j = 0; j < 17; j++) for (let i = 0; i < 17; i++)
      k.px(x + i, y + j, j < 8 && i % 3 === 0 ? C.yellow : j % 5 === 0 ? C.flame : C.gold, { emit: 215, bump: 0 });
    k.rect(x + 8, y, 1, 17, C.dark, { emit: 0 }); k.rect(x, y + 8, 17, 1, C.dark, { emit: 0 });
    k.rect(x - 3, y + 18, 23, 2, C.clay, { ty: .6 });
  };
  win(12, eave + 8); win(80, eave + 8);
  k.rect(44, h - 40, 22, 40, C.dark, { bump: 2 });
  for (let x = 46; x < 64; x++) for (let y = h - 38; y < h; y++)
    k.px(x, y, (x - 46) % 6 === 0 ? C.dark : (x % 2 ? C.brown : C.clay), { bump: (x - 46) % 6 === 0 ? 0 : 1 });
  k.rect(60, h - 20, 2, 3, C.gold);
  return k;
}

function tree(): Canvas {
  const k = new Canvas(68, 84);
  for (let y = 44; y < 84; y++) {
    const half = 4 + Math.max(0, y - 74) * .6;
    for (let x = 34 - half; x < 34 + half; x++) k.px(x, y, rnd() < .3 ? C.dark : C.brown, { tx: (x - 34) / (half + 1) * .8, bump: rnd() });
  }
  const leaf = [C.deep, C.forest, C.green, C.leaf];
  for (const [x, y, r] of [[34, 40, 15], [18, 32, 13], [50, 32, 13], [26, 18, 13], [44, 16, 12], [34, 26, 14]] as const) k.blob(x, y, r, leaf, rnd);
  return k;
}

function lampPost(): Canvas {
  const k = new Canvas(14, 50);
  k.rect(6, 12, 2, 36, C.steel, { tx: -.2 });
  k.rect(4, 47, 6, 3, C.ink); k.rect(3, 3, 8, 1, C.ink); k.rect(5, 1, 4, 2, C.ink); k.rect(3, 12, 8, 1, C.ink);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 10; x++) k.px(x, y, (x + y) % 3 ? C.yellow : C.gold, { emit: 255 });
  k.rect(3, 4, 1, 8, C.ink); k.rect(10, 4, 1, 8, C.ink);
  return k;
}

function wheat(): Canvas {
  const k = new Canvas(13, 20);
  for (let i = 0; i < 4; i++) {
    const x0 = 1 + i * 3 + Math.floor(rnd() * 2), top = 1 + Math.floor(rnd() * 5);
    for (let y = top + 5; y < 20; y++) k.px(x0, y, y > 14 ? C.brown : C.clay, {});
    for (let y = top; y < top + 6; y++) { k.px(x0, y, C.gold, { ty: .5 }); k.px(x0 + 1, y, y % 2 ? C.yellow : C.flame, { ty: .5 }); }
  }
  return k;
}

function barrel(): Canvas {
  const k = new Canvas(16, 20);
  for (let y = 2; y < 20; y++) for (let x = 1; x < 15; x++) {
    const hoop = y === 5 || y === 15;
    k.px(x, y, hoop ? C.steel : ((x % 4 === 0) ? C.dark : (x < 7 ? C.clay : C.brown)), { tx: (x - 8) / 8, bump: hoop ? 1 : 0 });
  }
  k.rect(2, 0, 12, 3, C.dark, { ty: .8 }); k.rect(3, 1, 10, 1, C.brown, { ty: .8 });
  return k;
}

function crate(): Canvas {
  const k = new Canvas(20, 20);
  k.rect(0, 0, 20, 6, C.tan, { ty: .8 });
  k.rect(0, 6, 20, 14, C.clay, {});
  for (let y = 6; y < 20; y += 4) k.rect(0, y, 20, 1, C.brown);
  k.rect(0, 6, 2, 14, C.brown, { bump: 1 }); k.rect(18, 6, 2, 14, C.brown, { bump: 1 });
  return k;
}

function stall(): Canvas {
  const k = new Canvas(84, 60);
  for (const x of [3, 79]) k.rect(x, 12, 3, 48, C.brown, { bump: 1 });
  k.rect(6, 36, 74, 6, C.clay, { ty: .75 }); k.rect(6, 42, 74, 12, C.brown, {});
  for (let x = 6; x < 80; x += 8) k.rect(x, 42, 1, 12, C.dark);
  for (let i = 0; i < 7; i++) {                         // fish on the counter
    const x = 11 + i * 10;
    for (let j = 0; j < 7; j++) k.px(x + j, 38 - (j === 3 ? 1 : 0), j === 0 ? C.black : (j < 5 ? C.ash : C.grey), { ty: .75 });
    k.rect(x + 1, 38, 4, 2, C.sky, { ty: .75 }); k.rect(x + 7, 37, 1, 3, C.grey);
  }
  for (let y = 0; y < 18; y++) for (let x = 0; x < 84; x++) {  // striped awning
    const inset = Math.round((18 - y) * .35);
    if (x < inset || x >= 84 - inset) continue;
    k.px(x, y, Math.floor(x / 7) % 2 ? C.sand : C.red, { ty: .7, bump: x % 7 === 0 ? 0 : .6 });
  }
  for (let x = 0; x < 84; x += 7) k.rect(x, 18, 7, x % 14 ? 2 : 3, Math.floor(x / 7) % 2 ? C.sand : C.red);
  return k;
}

function lantern(): Canvas {
  const k = new Canvas(7, 10);
  k.rect(3, 0, 1, 2, C.ink); k.rect(1, 2, 5, 1, C.ink); k.rect(1, 9, 5, 1, C.ink);
  for (let y = 3; y < 9; y++) for (let x = 2; x < 5; x++) k.px(x, y, (x + y) % 2 ? C.yellow : C.gold, { emit: 255 });
  k.rect(1, 3, 1, 6, C.ink); k.rect(5, 3, 1, 6, C.ink);
  return k;
}

function villager(frame: number): Canvas {
  const k = new Canvas(24, 48), cloak = C.steel, dark = C.ink;
  for (let y = 14; y < 43; y++) {
    const half = 5 + Math.min(4, (y - 14) * .16);
    for (let x = 12 - half; x < 12 + half; x++) k.px(x, y, x > 12 + half * .4 ? dark : cloak, { tx: (x - 12) / (half + 1) * .7 });
  }
  k.rect(8, 16, 8, 2, C.plum); k.rect(11, 18, 2, 18, C.ink); k.rect(7, 30, 10, 2, C.dark);
  for (let y = 2; y < 14; y++) { const half = y < 4 ? 3 : 5; for (let x = 12 - half; x < 12 + half; x++) k.px(x, y, C.plum, { tx: (x - 12) / 6 }); }
  k.rect(9, 6, 6, 6, C.skin); k.rect(10, 8, 1, 1, C.black); k.rect(13, 8, 1, 1, C.black); k.rect(9, 11, 6, 2, C.brown);
  k.rect(17, 18, 3, 12, cloak); k.rect(17, 29, 3, 2, C.skin);
  k.rect(frame ? 7 : 8, 43, 4, 5, C.dark); k.rect(frame ? 13 : 12, 43, 4, 5, C.dark);
  return k;
}

const CATMAP: Record<string, RGB> = { k: C.black, o: C.flame, y: C.gold, d: C.rust, w: C.white, s: C.clay, g: C.leaf };

const SIDE_TOP = [".................k....k.","................kyk..kyk",".kk.............koookook","kook...........kogoooogk","kok..kkkkkkkkkkkoowdwook",
  "kok.kyydyydyydykowwwwwok",".kokooodoodoodookkwwwkk.","..koooodoodoodooowwk....","...koooooooooooowwwk....","...kooooooooooooowk.....","....kkoooooooooookk....."];
const SIDE_LEGS = [
  ["....kokksk...kskkok.....","...kok...ksk.ksk...kok..","..kwk.....kwkwk.....kwk.","..kk.......kkkk......kk."],
  [".....ksok.....ksok......",".....ksok.....ksok......",".....kwwk.....kwwk......",".....kkkk.....kkkk......"],
  ["....kskkok...kokksk.....","...ksk...kok.kok...ksk..","..kwk.....kwkwk.....kwk.","..kk.......kkkk......kk."],
  [".....ksok.....ksok......",".....ksok.....ksok......",".....kwwk.....kwwk......",".....kkkk.....kkkk......"]];
const mir = (rows: string[]) => rows.map(r => r + [...r.slice(0, -1)].reverse().join(''));
const BACK = ["..k....",".kok...",".koookk",".kooood",".kooooo",".koooyo","..koooo","..koooo",".koooyy",".kooood","koooodo","koooooo","koooodo",".kooooo"];
const FRONT = ["..k....",".kok...",".koookk",".kooooo",".kogooo",".koooww","..kowwd","..koowk",".kooyww",".koooww","kooooww","kooooww","koooooo",".kooooo"];
const FEET = [[".kw.kok",".kk.kkk"], [".kok.kw",".kkk.kk"]];

export interface Art {
  ground: Sprite; cottages: Sprite[]; tree: Sprite; lamp: Sprite; wheat: Sprite[]; barrel: Sprite; crate: Sprite; stall: Sprite; lantern: Sprite;
  villager: Sprite[]; catSide: Sprite[]; catUp: Sprite[]; catDown: Sprite[];
}

export function buildArt(a: Atlas): Art {
  const cat = (rows: string[]) => { const k = new Canvas(rows[0].length, rows.length); k.grid(rows, CATMAP); return a.add(k, { bevel: .5 }); };
  return {
    ground: a.add(ground(), { bevel: 0, shadow: false }),
    cottages: [a.add(cottage(C.sand, C.tan, C.rust, C.red), { bevel: .25 }), a.add(cottage(C.tan, C.clay, C.steel, C.slate), { bevel: .25 })],
    tree: a.add(tree(), { bevel: .3 }),
    lamp: a.add(lampPost(), { bevel: .3 }),
    wheat: [wheat(), wheat(), wheat()].map(k => a.add(k, { bevel: 0, shadow: false })),
    barrel: a.add(barrel(), { bevel: .4 }), crate: a.add(crate(), { bevel: .3 }), stall: a.add(stall(), { bevel: .2 }), lantern: a.add(lantern(), { bevel: 0, shadow: false }),
    villager: [villager(0), villager(1)].map(k => a.add(k, { bevel: .6 })),
    catSide: SIDE_LEGS.map(l => cat([...SIDE_TOP, ...l])),
    catUp: FEET.map(f => cat(mir([...BACK, ...f]))),
    catDown: FEET.map(f => cat(mir([...FRONT, ...f]))),
  };
}
