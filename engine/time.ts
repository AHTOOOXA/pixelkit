// Time of day. t runs 0..1 over a full day, 0 = midnight. Ten keys, like the article's ten LUTs.
import { Grade, RGB } from './palette';

export interface DayKey { t: number; name: string; ambient: RGB; sun: RGB; grade: Grade }

const k = (t: number, name: string, ambient: RGB, sun: RGB, tint: RGB, sat: number, gamma: number, lift: RGB, gain = 1): DayKey =>
  ({ t, name, ambient, sun, grade: { tint, sat, gamma, lift, gain } });

export const DAY: DayKey[] = [
  k(0.00, 'midnight',  [.24, .27, .40], [.17, .21, .36], [.86, .95, 1.1], .80, 1.05, [.01, .02, .06]),
  k(0.13, 'small hours', [.22, .25, .38], [.15, .19, .34], [.86, .94, 1.1], .78, 1.05, [.01, .02, .06]),
  k(0.21, 'before dawn', [.30, .26, .46], [.20, .16, .32], [.97, .91, 1.08], .85, 1.02, [.04, .01, .06]),
  k(0.27, 'dawn',      [.62, .46, .50], [.95, .58, .42], [1.06, .95, .95], 1.0, .98, [.05, .01, .03]),
  k(0.38, 'morning',   [.76, .74, .72], [.95, .86, .68], [1.03, 1.0, .96], 1.05, .97, [.01, .01, .01]),
  k(0.50, 'noon',      [.84, .86, .88], [1.0, .97, .88], [1.0, 1.0, 1.0], 1.05, .96, [0, 0, 0]),
  k(0.66, 'afternoon', [.78, .76, .72], [1.0, .88, .68], [1.04, 1.0, .94], 1.08, .97, [.01, 0, 0]),
  k(0.77, 'golden',    [.62, .48, .46], [1.0, .62, .34], [1.1, .96, .84], 1.12, .98, [.04, .01, 0]),
  k(0.83, 'dusk',      [.36, .30, .50], [.46, .26, .40], [1.0, .9, 1.04], .92, 1.02, [.04, .01, .06]),
  k(0.92, 'evening',   [.26, .28, .42], [.19, .22, .38], [.88, .94, 1.1], .82, 1.05, [.02, .02, .06]),
];

/** 1 at night, 0 by day: lamps go out and fog burns off as the sun climbs. */
export function nightness(t: number) {
  t = ((t % 1) + 1) % 1;
  const s = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  return 1 - s(.25, .36, t) * (1 - s(.76, .86, t));
}

export interface DayState { a: number; b: number; mix: number; ambient: RGB; sun: RGB; sunDir: RGB; name: string }

const mix3 = (x: RGB, y: RGB, m: number): RGB => [x[0] + (y[0] - x[0]) * m, x[1] + (y[1] - x[1]) * m, x[2] + (y[2] - x[2]) * m];

export function dayAt(t: number): DayState {
  t = ((t % 1) + 1) % 1;
  let a = DAY.length - 1;
  for (let i = 0; i < DAY.length; i++) if (DAY[i].t <= t) a = i;
  const b = (a + 1) % DAY.length;
  const ta = DAY[a].t, tb = b === 0 ? 1 : DAY[b].t;
  const m = (t - ta) / (tb - ta);
  // Sun crosses by day, the moon by night: same direction logic, offset half a day.
  const day = t > 0.25 && t < 0.8;
  const p = day ? (t - 0.25) / 0.55 : (((t + 0.2) % 1)) / 0.45;
  const ang = Math.PI * Math.min(1, Math.max(0, p));
  const dir: RGB = [Math.cos(ang) * 0.85, 0.35, Math.max(0.2, Math.sin(ang))];
  return { a, b, mix: m, ambient: mix3(DAY[a].ambient, DAY[b].ambient, m), sun: mix3(DAY[a].sun, DAY[b].sun, m), sunDir: dir, name: DAY[m < 0.5 ? a : b].name };
}
