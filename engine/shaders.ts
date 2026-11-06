// All GLSL. Screen space: x right, y down, in low-res pixels. World space: x right, y toward the
// camera (down the screen), z up. An upright sprite pixel at height z stands on ground row screenY + z.

export const SPRITE_VS = /* glsl */`#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 iRect;   // screen x, y, w, h (padded for sway)
layout(location=2) in vec4 iUv;     // atlas u, v, sprite w, sprite h
layout(location=3) in vec4 iMisc;   // flip, ground, sway amp, sway phase
layout(location=4) in vec4 iMisc2;  // pad, bend, elevation, unused
uniform vec2 uScreen;
out vec2 vLocal; flat out vec4 vUv; flat out vec4 vMisc; flat out vec4 vMisc2;
void main(){
  vec2 p = iRect.xy + corner * iRect.zw;
  vLocal = corner * iRect.zw;
  vUv = iUv; vMisc = iMisc; vMisc2 = iMisc2;
  gl_Position = vec4(p.x / uScreen.x * 2. - 1., 1. - p.y / uScreen.y * 2., 0., 1.);
}`;

export const SPRITE_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vLocal; flat in vec4 vUv; flat in vec4 vMisc; flat in vec4 vMisc2;
uniform sampler2D tColor, tNormal;
uniform float uTime, uWind, uSway;
layout(location=0) out vec4 oColor;
layout(location=1) out vec4 oNormal;
void main(){
  ivec2 p = ivec2(floor(vLocal));
  int pad = int(vMisc2.x);
  int w = int(vUv.z), h = int(vUv.w);
  int row = h - 1 - p.y;                         // pixels above the sprite's foot
  float k = float(row) / float(h);
  // Wind: whole-pixel row shifts, so the art stays on the grid. Root fixed, top moves most.
  float wave = sin(uTime * 2.1 + vMisc.w + float(row) * .05) * .6 + sin(uTime * 3.7 + vMisc.w * 1.7) * .25;
  float shift = (vMisc.z * (wave * (.45 + uWind) + uWind * 1.2) + vMisc2.y) * k * k * uSway;
  int sx = p.x - pad - int(round(shift));
  if (sx < 0 || sx >= w) discard;
  int fx = vMisc.x > .5 ? w - 1 - sx : sx;
  ivec2 t = ivec2(int(vUv.x) + fx, int(vUv.y) + p.y);
  vec4 c = texelFetch(tColor, t, 0);
  if (c.a < .5) discard;
  vec4 n = texelFetch(tNormal, t, 0);
  if (vMisc.x > .5) n.r = 1. - n.r;
  float z = vMisc.y > .5 ? 0. : float(row) + 1. + vMisc2.z;
  oColor = vec4(c.rgb, 1.);
  oNormal = vec4(n.rg, n.b, z / 255.);
}`;

export const SHADOW_VS = /* glsl */`#version 300 es
layout(location=0) in vec2 corner;
layout(location=1) in vec4 iBase;   // foot x, foot y, direction x, direction y
layout(location=2) in vec4 iSize;   // half width, length, strength, flip
layout(location=3) in vec4 iUv;
layout(location=4) in vec4 iChan;   // which light this shadow blocks
uniform vec2 uScreen;
out vec2 vT; flat out vec4 vUv; flat out vec4 vChan; flat out vec2 vS;
void main(){
  // Projected in the vertex shader. The foot line stays put and only height moves along the
  // light direction, so left stays left. Rotating the quad instead mirrors shadows that fall
  // toward the camera.
  vec2 d = iBase.zw;
  vec2 p = iBase.xy + vec2((corner.x - .5) * 2. * iSize.x, 0.) + d * corner.y * iSize.y;
  vT = corner; vUv = iUv; vChan = iChan; vS = iSize.zw;
  gl_Position = vec4(p.x / uScreen.x * 2. - 1., 1. - p.y / uScreen.y * 2., 0., 1.);
}`;

export const SHADOW_FS = /* glsl */`#version 300 es
precision highp float;
in vec2 vT; flat in vec4 vUv; flat in vec4 vChan; flat in vec2 vS;
uniform sampler2D tColor;
out vec4 o;
void main(){
  float fx = vS.y > .5 ? 1. - vT.x : vT.x;
  ivec2 t = ivec2(vUv.x + min(floor(fx * vUv.z), vUv.z - 1.), vUv.y + min(floor((1. - vT.y) * vUv.w), vUv.w - 1.));
  if (texelFetch(tColor, t, 0).a < .5) discard;
  o = vChan * vS.x * (1. - vT.y * .45);          // fades toward the tip
}`;

export const QUAD_VS = /* glsl */`#version 300 es
layout(location=0) in vec2 corner;
void main(){ gl_Position = vec4(corner * 2. - 1., 0., 1.); }`;

export const MAX_LIGHTS = 16;

export const COMPOSE_FS = /* glsl */`#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D tAlbedo, tNormal, tShadow;
uniform sampler3D tLutA, tLutB, tPal;
uniform vec2 uCam; uniform float uH, uTime, uLutMix, uFogH, uFog, uBands, uDither;
uniform vec3 uAmbient, uSun, uSunDir;
uniform int uCount;
uniform vec4 uLightPos[${MAX_LIGHTS}];   // x, y, z, radius
uniform vec4 uLightCol[${MAX_LIGHTS}];   // r, g, b, shadow slot
// on/off switches: ambient, lut, normals, rule3d, shadows, fog, palette, bands
uniform float fAmbient, fLut, fNormals, fRule, fShadows, fFog, fPal, fBands;
out vec4 o;

float bayer(ivec2 p){
  int x = p.x & 3, y = p.y & 3;
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(m[y * 4 + x]) + .5) / 16.;
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){ return noise(p) * .55 + noise(p * 2.1 + 7.) * .3 + noise(p * 4.3 + 3.) * .15; }
// Step a smooth value into bands, with Bayer dither on the band edges: pixel-art shading.
float band(float v, float d){
  if (fBands < .5) return v;
  return clamp(floor(v * uBands + .5 + (d - .5) * .55) / uBands, 0., 1.);  // dither only near band edges
}
float slot(vec4 s, float i){ return i < .5 ? s.g : (i < 1.5 ? s.b : s.a); }

void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 alb = texelFetch(tAlbedo, ip, 0).rgb;
  vec4 nz = texelFetch(tNormal, ip, 0);
  vec4 sh = texelFetch(tShadow, ip, 0) * fShadows;
  float d = bayer(ip);
  float z = nz.a * 255.;
  bool ground = z < .5;
  float sy = uH - 1. - float(ip.y);
  vec3 P = vec3(float(ip.x) + uCam.x, sy + uCam.y + z, z);

  vec2 t = (nz.rg * 2. - 1.) * fNormals;
  float tz = sqrt(max(0., 1. - dot(t, t)));
  // Painted normals are in sprite space. Ground faces up, upright sprites face the camera (+y).
  vec3 N = ground ? vec3(t.x, -t.y, tz) : normalize(vec3(t.x, tz * .8, t.y + tz * .45));

  vec3 skyAmb = fAmbient > .5 ? uAmbient : vec3(.72);
  vec3 sun = fAmbient > .5 ? uSun : vec3(.3);
  float sunL = max(dot(N, normalize(uSunDir)), 0.);
  float sunShadow = ground ? sh.r : 0.;
  vec3 light = skyAmb * (.62 + .38 * N.z) + sun * band(sunL, d) * .8 * (1. - sunShadow * .85);
  light *= 1. - sunShadow * .5;

  vec3 glow = vec3(0.);                          // light reaching the ground here, for lighting fog
  vec3 lamp = vec3(0.);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uCount) break;
    vec4 lp = uLightPos[i]; vec4 lc = uLightCol[i];
    vec3 L = lp.xyz - P;
    float dist = length(L);
    float att = clamp(1. - dist / lp.w, 0., 1.);
    if (att <= 0.) continue;
    att = band(min(1., pow(att, 1.5) * 1.5), d);
    float lam = clamp(dot(N, L / dist) * 1.15 + .12, 0., 1.);
    float front = 1.;
    if (!ground && fRule > .5) front = clamp(1. + L.y / 12., 0., 1.);   // the 3D light rule
    else if (!ground) lam = max(lam, .55);
    float blocked = ground ? min(1., slot(sh, lc.a) * 1.25) : 0.;
    lamp += lc.rgb * att * lam * front * (1. - blocked);
    glow += lc.rgb * att;
  }
  light += lamp;
  float peak = max(light.r, max(light.g, light.b));
  if (peak > 1.3) light *= 1.3 / peak;           // scale, not clip, so warm light stays warm
  vec3 col = alb * light;
  float fogged = 0.;

  // Fog: drifts in world space, sits low. Pixels above uFogH poke through.
  if (fFog > .5 && uFog > 0.) {
    vec2 q = vec2(P.x, P.y) * vec2(.018, .034) + vec2(uTime * .05, uTime * .02);
    float cloud = smoothstep(.42, .68, fbm(q) + uFog * .3 - .14);
    float f = cloud * clamp(1. - z / uFogH, 0., 1.);
    f = band(f, d) * .86;
    vec3 fogCol = skyAmb * .92 + vec3(.02, .02, .03) + glow * .32;
    col = mix(col, fogCol, f);
    fogged = f;
  }

  col = clamp(col, 0., 1.);
  if (fLut > .5) {
    vec3 u = col * (15. / 16.) + .5 / 16.;       // sample texel centres of the 16^3 table
    vec3 graded = mix(texture(tLutA, u).rgb, texture(tLutB, u).rgb, uLutMix);
    // Lamp pools keep their own colour: the warm/cold contrast is the look.
    col = mix(graded, col, clamp(dot(lamp, vec3(.5, .35, .15)) * 1.1, 0., .8) * (1. - fogged));
  }
  // Glowing things skip the grade, so windows stay warm at midnight. Fog still veils them.
  col = max(col, alb * nz.b * (1. - fogged * .7));
  if (fPal > .5) {
    col = clamp(col + (d - .5) * uDither, 0., 1.);
    col = texture(tPal, col * (31. / 32.) + .5 / 32.).rgb;
  }
  o = vec4(col, 1.);
}`;
