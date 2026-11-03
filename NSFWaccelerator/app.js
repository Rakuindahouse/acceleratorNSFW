'use strict';
// ebb flow mixer
// 画面を斜めに分割したパネルに画像・動画・Spout(カメラ)を流し、全体の色を変えるミキサー。

var ctlWin = null; // 操作パネルを出した別窓
const $ = (s) => document.querySelector(s) || (ctlWin && !ctlWin.closed ? ctlWin.document.querySelector(s) : null);
const canvas = $('#view');
const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: true });
if (!gl) alert('WebGL2 が使えません。Chrome / Edge で開いてください。');

// ---------------------------------------------------------------- パラメータ
const PARAMS = [
  // section, key, label, min, max, step, default
  ['source', 'userRatio', '自分の素材', 0, 1, 0.01, 0.6],
  ['motion', 'panels', '分割数', 1, 9, 1, 4],
  ['motion', 'tilt', '傾き', 0, 1, 0.01, 0.45],
  ['motion', 'exchange', '切替(秒)', 0.3, 20, 0.1, 3.8],
  ['motion', 'fade', 'フェード', 0, 3, 0.05, 0.6],
  ['motion', 'speed', '流速', 0, 4, 0.01, 1],
  ['motion', 'warp', 'うねり', 0, 3, 0.01, 0.8],
  ['motion', 'after', '残像', 0, 0.97, 0.01, 0.35],
  ['motion', 'zoom', 'ズーム', 1, 4, 0.01, 1.4],
  ['motion', 'burstHz', '明滅速度', 2, 30, 1, 15],
  ['audio', 'aGain', '入力感度', 0, 4, 0.01, 1.2],
  ['audio', 'aBeat', 'ビート切替', 0, 1, 0.01, 0.6],
  ['audio', 'aBeatMin', '最短間隔(秒)', 0.05, 2, 0.01, 0.25],
  ['audio', 'aWarp', '低音→うねり', 0, 3, 0.01, 1],
  ['audio', 'aSpeed', '音量→流速', 0, 3, 0.01, 1],
  ['audio', 'aBright', '高音→明るさ', 0, 2, 0.01, 0.5],
  ['audio', 'aFlash', 'ビート→光', 0, 1, 0.01, 0.3],
  ['audio', 'aAfter', '静けさ→残像', 0, 1, 0.01, 0.4],
  ['color', 'hue', '色相', -180, 180, 1, 0],
  ['color', 'sat', '彩度', 0, 2.5, 0.01, 1],
  ['color', 'bri', '明るさ', 0, 2.5, 0.01, 1],
  ['color', 'con', 'コントラスト', 0, 2.5, 0.01, 1],
  ['color', 'gamma', 'ガンマ', 0.3, 2.5, 0.01, 1],
  ['color', 'mapMix', '色置換', 0, 1, 0.01, 0],
  ['color', 'tintMix', '色かぶり', 0, 1, 0.01, 0],
  ['color', 'invert', '反転', 0, 1, 0.01, 0],
  ['color', 'vignette', '周辺減光', 0, 1, 0.01, 0.15],
];
const COLOR_KEYS = { mapA: '#020618', mapB: '#1f4dff', mapC: '#e8f6ff', tint: '#9fd4ff' };

const PRESETS = {
  '原作 青と白': { hue: 0, sat: 1, bri: 1, con: 1, gamma: 1, mapMix: 0, tintMix: 0, invert: 0 },
  '深海': { hue: 0, sat: 1.2, bri: 0.9, con: 1.15, gamma: 1.1, mapMix: 0.9, tintMix: 0, invert: 0, mapA: '#000208', mapB: '#0a2fd6', mapC: '#9fe3ff' },
  '夕凪': { hue: 0, sat: 1, bri: 1.05, con: 1.05, gamma: 1, mapMix: 0.92, tintMix: 0, invert: 0, mapA: '#1a0626', mapB: '#ff4f6d', mapC: '#ffe8c8' },
  '桜': { hue: 0, sat: 1, bri: 1.1, con: 0.95, gamma: 0.9, mapMix: 0.85, tintMix: 0, invert: 0, mapA: '#2b0b1e', mapB: '#ff8fbf', mapC: '#fff4f8' },
  '緑青': { hue: 0, sat: 1, bri: 1, con: 1.1, gamma: 1, mapMix: 0.88, tintMix: 0, invert: 0, mapA: '#021512', mapB: '#14a38b', mapC: '#e8fff6' },
  '金': { hue: 0, sat: 1, bri: 1, con: 1.2, gamma: 1, mapMix: 0.9, tintMix: 0, invert: 0, mapA: '#0d0700', mapB: '#c98a12', mapC: '#fff3c9' },
  '墨': { hue: 0, sat: 0, bri: 1, con: 1.3, gamma: 1, mapMix: 0, tintMix: 0, invert: 0 },
  'ネオン': { hue: 150, sat: 1.8, bri: 1.1, con: 1.2, gamma: 1, mapMix: 0, tintMix: 0, invert: 0 },
  '反転': { hue: 0, sat: 1, bri: 1, con: 1, gamma: 1, mapMix: 0, tintMix: 0, invert: 1 },
};

const S = {};
const STORE_KEY = 'ebb-flow-mixer/settings';
function defaults() {
  for (const p of PARAMS) S[p[1]] = p[6];
  Object.assign(S, COLOR_KEYS);
  S.builtin = { materials: true, 'sea-blue': true, 'sea-white': true };
  S.outRes = 'window';
}
defaults();
try { Object.assign(S, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) {}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }, 300);
}

// ---------------------------------------------------------------- WebGL
function compile(vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

const VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos; gl_Position = vec4(aPos*2.0-1.0, 0.0, 1.0); }`;

// 1パネル分：テクスチャを cover で敷き、流してうねらせる
const panelProg = compile(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uTex;
uniform float uTexAspect, uScrAspect, uZoom, uTime, uWarp, uSeed, uAlpha, uRot, uGain;
uniform vec2 uOffset, uDrift;
void main(){
  vec2 s = vec2(uScrAspect, 1.0), t = vec2(uTexAspect, 1.0);
  float k = max(s.x/t.x, s.y/t.y);
  vec2 p = (vUv - 0.5) * s;
  float c = cos(uRot), sn = sin(uRot);
  p = mat2(c, -sn, sn, c) * p;
  vec2 uv = 0.5 + p / (t * k * uZoom) + uOffset + uDrift * uTime;
  float w = uWarp;
  uv += w * vec2(
    0.030*sin(uv.y*6.0 + uTime*1.3 + uSeed) + 0.012*sin(uv.y*17.0 - uTime*2.1 + uSeed*3.0),
    0.030*cos(uv.x*5.0 - uTime*1.1 + uSeed*2.0) + 0.012*cos(uv.x*15.0 + uTime*1.7 + uSeed));
  o = vec4(texture(uTex, uv).rgb * uGain, uAlpha);
}`);

// 残像（フィードバック）
const fbProg = compile(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uPrev;
uniform float uAfter, uTime, uWarp;
void main(){
  vec2 d = (vUv - 0.5) * 0.997 + 0.5;
  d += uWarp * 0.0015 * vec2(sin(vUv.y*9.0 + uTime), cos(vUv.x*8.0 - uTime*0.8));
  vec3 prev = texture(uPrev, d).rgb;
  vec3 sc = texture(uScene, vUv).rgb;
  o = vec4(mix(sc, prev, uAfter), 1.0);
}`);

// 全体の色
const colorProg = compile(VS, `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc;
uniform float uHue, uSat, uBri, uCon, uGamma, uMapMix, uTintMix, uInvert, uVignette, uAspect;
uniform vec3 uMapA, uMapB, uMapC, uTint;
vec3 hueShift(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.0 - ca);
}
void main(){
  vec3 c = texture(uSrc, vUv).rgb;
  c = hueShift(c, uHue);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c *= uBri;
  c = (c - 0.5) * uCon + 0.5;
  c = pow(max(c, 0.0), vec3(1.0/uGamma));
  float m = clamp(dot(c, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 g = m < 0.5 ? mix(uMapA, uMapB, m*2.0) : mix(uMapB, uMapC, m*2.0 - 1.0);
  c = mix(c, g, uMapMix);
  c = mix(c, c * uTint * 1.6, uTintMix);
  c = mix(c, 1.0 - c, uInvert);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.35, 1.0, length(q));
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`);

const quadBuf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);

function bindPos(buf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
}

function newTexture(wrap) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 30, 90, 255]));
  return t;
}

function uploadTexture(tex, el) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

// 描画先（シーン / 残像2枚）
let W = 0, H = 0;
const targets = {};
function makeTarget() {
  const tex = newTexture(gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = Math.max(2, Math.round(innerWidth * dpr)), h = Math.max(2, Math.round(innerHeight * dpr));
  const fixed = /^(\d+)x(\d+)$/.exec(S.outRes || '');
  if (fixed) { w = +fixed[1]; h = +fixed[2]; }
  else if (outWin && !outWin.closed && outWin.innerWidth > 50) {
    // 操作専用モードでは出力ウィンドウの大きさで描く
    const od = Math.min(outWin.devicePixelRatio || 1, 2);
    w = Math.round(outWin.innerWidth * od); h = Math.round(outWin.innerHeight * od);
  }
  canvas.style.aspectRatio = `${w} / ${h}`;
  if (w === W && h === H) return;
  W = canvas.width = w; H = canvas.height = h;
  for (const k of ['scene', 'fbA', 'fbB']) {
    if (targets[k]) { gl.deleteTexture(targets[k].tex); gl.deleteFramebuffer(targets[k].fb); }
    targets[k] = makeTarget();
  }
}

// ---------------------------------------------------------------- ソース
// source: { id, name, kind: 'image'|'video'|'camera', el, tex, aspect, ready, enabled, builtin?, group? }
const sources = [];
let nextId = 1;

function addImageSource(url, name, opts = {}) {
  const src = { id: nextId++, name, kind: 'image', tex: newTexture(gl.MIRRORED_REPEAT), aspect: 16 / 9, ready: false, enabled: true, ...opts };
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => { uploadTexture(src.tex, img); src.aspect = img.naturalWidth / img.naturalHeight; src.ready = true; };
  img.onerror = () => console.warn('画像を読み込めませんでした', url);
  img.src = (window.BUILTIN_DATA && window.BUILTIN_DATA[url]) || url;
  src.el = img;
  sources.push(src);
  return src;
}

function addVideoSource(video, name, kind) {
  const src = { id: nextId++, name, kind, el: video, tex: newTexture(gl.MIRRORED_REPEAT), aspect: 16 / 9, ready: false, enabled: true };
  sources.push(src);
  return src;
}

function addFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) {
    addImageSource(url, file.name);
  } else if (file.type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = url; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true;
    v.play().catch(() => {});
    addVideoSource(v, file.name, 'video');
  } else return;
  renderUserList();
}

async function addCamera(deviceId, label) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
      audio: false,
    });
    const v = document.createElement('video');
    v.srcObject = stream; v.muted = true; v.playsInline = true;
    await v.play().catch(() => {});
    const src = addVideoSource(v, label || 'カメラ', 'camera');
    src.stream = stream;
    renderUserList();
  } catch (e) {
    alert('カメラ / Spout を開けませんでした: ' + e.message);
  }
}

function removeSource(src) {
  const i = sources.indexOf(src);
  if (i < 0) return;
  sources.splice(i, 1);
  if (src.stream) src.stream.getTracks().forEach((t) => t.stop());
  if (src.kind === 'video') { src.el.pause(); URL.revokeObjectURL(src.el.src); }
  if (src.kind === 'image' && src.el.src.startsWith('blob:')) URL.revokeObjectURL(src.el.src);
  gl.deleteTexture(src.tex);
  renderUserList();
  for (const L of [layout, prevLayout]) if (L) for (const p of L.panels) if (p.src === src) p.src = null;
}

function updateVideoTextures() {
  for (const s of sources) {
    if (s.kind === 'image' || !s.enabled) continue;
    const v = s.el;
    if (v.readyState >= 2 && v.videoWidth) {
      uploadTexture(s.tex, v);
      s.aspect = v.videoWidth / v.videoHeight;
      s.ready = true;
    }
  }
}

// サイト素材（必要になったら読み込む）
const builtinLoaded = {};
function syncBuiltin() {
  for (const g of window.BUILTIN_GROUPS || []) {
    const on = !!S.builtin[g.id];
    if (on && !builtinLoaded[g.id]) {
      builtinLoaded[g.id] = g.files.map((f) => addImageSource(f, f.split('/').pop(), { builtin: true, group: g.id }));
    }
    for (const s of builtinLoaded[g.id] || []) s.enabled = on;
  }
}

function pool() {
  const user = sources.filter((s) => !s.builtin && s.enabled && s.ready);
  const built = sources.filter((s) => s.builtin && s.enabled && s.ready);
  return { user, built };
}

// ---------------------------------------------------------------- 分割レイアウト
let seed = (Math.random() * 1e9) | 0;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

function clip(poly, nx, ny, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a[0] * nx + a[1] * ny - d, db = b[0] * nx + b[1] * ny - d;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
function area(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }

function pickSources(n) {
  const { user, built } = pool();
  const bag = { user: [], built: [] };
  const take = (kind, list) => {
    if (!list.length) return null;
    if (!bag[kind].length) bag[kind] = list.slice().sort(() => rnd() - 0.5);
    return bag[kind].pop();
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const wantUser = rnd() < S.userRatio;
    out.push((wantUser ? take('user', user) || take('built', built) : take('built', built) || take('user', user)) || null);
  }
  return out;
}

function makeLayout() {
  const A = W / H;
  let polys = [[[0, 0], [A, 0], [A, 1], [0, 1]]];
  const count = Math.round(S.panels);
  let guard = 0;
  while (polys.length < count && guard++ < 200) {
    let bi = 0;
    polys.forEach((p, i) => { if (area(p) > area(polys[bi])) bi = i; });
    const p = polys[bi];
    let cx = 0, cy = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const v of p) { cx += v[0]; cy += v[1]; x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
    cx /= p.length; cy /= p.length;
    const vertical = (x1 - x0) > (y1 - y0) * (0.7 + rnd() * 0.6);
    const ang = (vertical ? 0 : Math.PI / 2) + (rnd() - 0.5) * S.tilt * Math.PI * 0.6;
    const nx = Math.cos(ang), ny = Math.sin(ang);
    const px = cx + (rnd() - 0.5) * (x1 - x0) * 0.5, py = cy + (rnd() - 0.5) * (y1 - y0) * 0.5;
    const d = px * nx + py * ny;
    const a = clip(p, nx, ny, d), b = clip(p, -nx, -ny, -d);
    const total = area(p);
    if (a.length >= 3 && b.length >= 3 && area(a) > total * 0.15 && area(b) > total * 0.15) polys.splice(bi, 1, a, b);
  }
  const srcs = pickSources(polys.length);
  const panels = polys.map((poly, i) => {
    const tri = [];
    const pts = poly.map((v) => [v[0] / A, v[1]]);
    for (let k = 1; k < pts.length - 1; k++) tri.push(...pts[0], ...pts[k], ...pts[k + 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tri), gl.STATIC_DRAW);
    const dir = rnd() * Math.PI * 2, mag = 0.01 + rnd() * 0.04;
    return {
      buf, count: tri.length / 2, src: srcs[i],
      zoom: 1 + rnd() * (S.zoom - 1),
      offset: [rnd(), rnd()],
      drift: [Math.cos(dir) * mag, Math.sin(dir) * mag],
      rot: (rnd() - 0.5) * 0.4,
      seed: rnd() * 100,
      gain: 0.85 + rnd() * 0.3,
    };
  });
  return { panels, born: performance.now() / 1000 };
}

function freeLayout(L) { if (L) for (const p of L.panels) gl.deleteBuffer(p.buf); }

let layout = null, prevLayout = null, lastExchange = 0, fadeDur = 0;
function nextLayout(fade = S.fade) {
  freeLayout(prevLayout);
  prevLayout = layout;
  layout = makeLayout();
  fadeDur = fade;
  lastExchange = performance.now() / 1000;
}

// ---------------------------------------------------------------- 描画ループ
let flowTime = 0, last = performance.now() / 1000, burst = false, burstAcc = 0, shotPending = false;

function drawLayout(L, alpha) {
  for (const p of L.panels) {
    const s = p.src && p.src.ready ? p.src : null;
    if (!s) continue;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, s.tex);
    const u = panelProg.u;
    // ライブ映像（Spout・カメラ・動画）は反転や回転をせず、そのまま敷く
    const live = s.kind !== 'image';
    gl.uniform1i(u.uTex, 0);
    gl.uniform1f(u.uTexAspect, s.aspect);
    gl.uniform1f(u.uScrAspect, W / H);
    gl.uniform1f(u.uZoom, live ? 1 : p.zoom);
    gl.uniform1f(u.uTime, flowTime);
    gl.uniform1f(u.uWarp, cur.warp);
    gl.uniform1f(u.uSeed, p.seed);
    gl.uniform1f(u.uAlpha, alpha);
    gl.uniform1f(u.uRot, live ? 0 : p.rot);
    gl.uniform1f(u.uGain, live ? 1 : p.gain);
    gl.uniform2f(u.uOffset, live ? 0 : p.offset[0], live ? 0 : p.offset[1]);
    gl.uniform2f(u.uDrift, live ? 0 : p.drift[0], live ? 0 : p.drift[1]);
    bindPos(p.buf);
    gl.drawArrays(gl.TRIANGLES, 0, p.count);
  }
}

function hex(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

// 出力ウィンドウがあるときはそちらのタイミングで描く（元ウィンドウを最小化しても止まらない）
let loopId = 0, lastTick = 0;
function schedule() {
  const id = ++loopId;
  const w = outWin && !outWin.closed ? outWin : window;
  w.requestAnimationFrame(() => { if (id === loopId) frame(); });
}
setInterval(() => { if (performance.now() - lastTick > 400) schedule(); }, 250);

function frame() {
  lastTick = performance.now();
  schedule();
  resize();
  const now = performance.now() / 1000;
  const dt = Math.min(0.1, now - last); last = now;
  // 音で各パラメータを動かす
  const A = updateAudio(dt, now);
  cur.warp = S.warp + S.aWarp * A.low * 2;
  cur.after = Math.min(0.97, S.after + (A.active ? S.aAfter * 0.5 * (1 - Math.min(1, A.vol * 2.5)) : 0));
  cur.bri = S.bri * (1 + S.aBright * A.high * 0.8 + S.aFlash * A.flash * 0.6);
  flowTime += dt * S.speed * (1 + S.aSpeed * A.vol * 3);
  if (A.beat && S.aBeat > 0 && !burst && now - lastExchange >= S.aBeatMin) nextLayout(Math.min(S.fade, 0.12));

  if (!layout) nextLayout(0);
  if (burst) {
    burstAcc += dt;
    if (burstAcc >= 1 / S.burstHz) { burstAcc = 0; nextLayout(0); }
  } else if (now - lastExchange >= S.exchange) nextLayout();
  // 素材が揃う前に作った配置は空きパネルを埋める
  if (layout.panels.some((p) => !p.src)) {
    const fill = pickSources(layout.panels.length);
    layout.panels.forEach((p, i) => { if (!p.src) p.src = fill[i]; });
  }

  updateVideoTextures();

  // 1. シーン
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets.scene.fb);
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.02, 0.03, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(panelProg.p);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  const t = fadeDur > 0 ? Math.min(1, (now - lastExchange) / fadeDur) : 1;
  if (prevLayout && t < 1) drawLayout(prevLayout, 1);
  drawLayout(layout, t);
  gl.disable(gl.BLEND);

  // 2. 残像
  const read = targets.fbA, write = targets.fbB;
  gl.bindFramebuffer(gl.FRAMEBUFFER, write.fb);
  gl.useProgram(fbProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets.scene.tex);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, read.tex);
  gl.uniform1i(fbProg.u.uScene, 0); gl.uniform1i(fbProg.u.uPrev, 1);
  gl.uniform1f(fbProg.u.uAfter, cur.after);
  gl.uniform1f(fbProg.u.uTime, flowTime);
  gl.uniform1f(fbProg.u.uWarp, cur.warp);
  bindPos(quadBuf); gl.drawArrays(gl.TRIANGLES, 0, 6);
  targets.fbA = write; targets.fbB = read;

  // 3. 色 → 画面
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.useProgram(colorProg.p);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, write.tex);
  const u = colorProg.u;
  gl.uniform1i(u.uSrc, 0);
  gl.uniform1f(u.uHue, S.hue * Math.PI / 180);
  gl.uniform1f(u.uSat, S.sat); gl.uniform1f(u.uBri, cur.bri); gl.uniform1f(u.uCon, S.con); gl.uniform1f(u.uGamma, S.gamma);
  gl.uniform1f(u.uMapMix, S.mapMix); gl.uniform1f(u.uTintMix, S.tintMix); gl.uniform1f(u.uInvert, S.invert);
  gl.uniform1f(u.uVignette, S.vignette); gl.uniform1f(u.uAspect, W / H);
  gl.uniform3fv(u.uMapA, hex(S.mapA)); gl.uniform3fv(u.uMapB, hex(S.mapB)); gl.uniform3fv(u.uMapC, hex(S.mapC)); gl.uniform3fv(u.uTint, hex(S.tint));
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // 出力ウィンドウへコピー（描画直後なので preserveDrawingBuffer 不要）
  if (outCtx) {
    if (outWin.closed) { outWin = outCtx = null; $('#btnOut').classList.remove('on'); setControlMode(false); }
    else {
      const oc = outCtx.canvas;
      if (oc.width !== W || oc.height !== H) { oc.width = W; oc.height = H; }
      outCtx.drawImage(canvas, 0, 0);
    }
  }

  if (shotPending) {
    shotPending = false;
    canvas.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'ebb-flow-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }
}

// ---------------------------------------------------------------- UI
const sliderEls = {};
function buildSliders() {
  for (const [sec, key, label, min, max, step] of PARAMS) {
    const wrap = document.createElement('label');
    wrap.className = 'slider';
    wrap.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}"><output></output>`;
    const input = wrap.querySelector('input'), out = wrap.querySelector('output');
    input.addEventListener('input', () => {
      S[key] = +input.value; out.textContent = fmt(S[key], step); save();
      if (key === 'panels' || key === 'tilt') nextLayout(0.2);
    });
    input.addEventListener('dblclick', () => { S[key] = PARAMS.find((p) => p[1] === key)[6]; syncUi(); save(); });
    sliderEls[key] = { input, out, step };
    $('#sliders-' + sec).appendChild(wrap);
  }
  for (const k of Object.keys(COLOR_KEYS)) {
    $('#' + k).addEventListener('input', (e) => { S[k] = e.target.value; save(); });
  }
  for (const [name, preset] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => { Object.assign(S, preset); syncUi(); save(); };
    $('#presets').appendChild(b);
  }
}
function fmt(v, step) { return step >= 1 ? String(Math.round(v)) : (+v).toFixed(2); }
function syncUi() {
  for (const [k, e] of Object.entries(sliderEls)) { e.input.value = S[k]; e.out.textContent = fmt(S[k], e.step); }
  for (const k of Object.keys(COLOR_KEYS)) $('#' + k).value = S[k];
  $('#outRes').value = S.outRes;
  renderBuiltinList();
}

function renderBuiltinList() {
  const box = $('#builtinList');
  box.innerHTML = '';
  for (const g of window.BUILTIN_GROUPS || []) {
    const row = document.createElement('label');
    row.className = 'item' + (S.builtin[g.id] ? '' : ' off');
    row.innerHTML = `<input type="checkbox"><img src="${g.files[0]}" alt=""><span class="name">${g.label}（${g.files.length}）</span>`;
    const cb = row.querySelector('input');
    cb.checked = !!S.builtin[g.id];
    cb.onchange = () => { S.builtin[g.id] = cb.checked; syncBuiltin(); renderBuiltinList(); save(); nextLayout(0.3); };
    box.appendChild(row);
  }
}

function renderUserList() {
  const box = $('#userList');
  box.innerHTML = '';
  for (const s of sources.filter((x) => !x.builtin)) {
    const row = document.createElement('div');
    row.className = 'item' + (s.enabled ? '' : ' off');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = s.enabled;
    cb.onchange = () => { s.enabled = cb.checked; renderUserList(); nextLayout(0.3); };
    let thumb;
    if (s.kind === 'image') { thumb = document.createElement('img'); thumb.src = s.el.src; }
    else { thumb = document.createElement('div'); thumb.className = 'thumb'; thumb.textContent = s.kind === 'camera' ? ' 📷' : ' ▶'; }
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = s.name; name.title = s.name;
    const rm = document.createElement('button');
    rm.textContent = '×'; rm.title = '削除'; rm.onclick = () => removeSource(s);
    row.append(cb, thumb, name, rm);
    box.appendChild(row);
  }
}

$('#fileInput').addEventListener('change', (e) => { [...e.target.files].forEach(addFile); e.target.value = ''; nextLayout(0.3); });

$('#btnCam').onclick = async () => {
  try {
    // ラベル取得のため一度許可をもらう
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) { alert('カメラの許可が必要です: ' + e.message); return; }
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const sel = $('#camSelect');
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || `カメラ ${i + 1}`;
    if (/spout/i.test(d.label)) o.selected = true;
    sel.appendChild(o);
  });
  $('#camPick').hidden = false;
};
$('#btnCamAdd').onclick = () => {
  const sel = $('#camSelect');
  addCamera(sel.value, sel.selectedOptions[0]?.textContent);
  $('#camPick').hidden = true;
};

// ドラッグ＆ドロップ / 貼り付け
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('dragging');
  [...e.dataTransfer.files].forEach(addFile); nextLayout(0.3);
});
addEventListener('paste', (e) => {
  for (const it of e.clipboardData.items) if (it.kind === 'file') addFile(it.getAsFile());
});

// ボタン・キー
function toggleUi() { document.body.classList.toggle('ui-hidden'); }
function toggleFull() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
$('#toggleUi').onclick = toggleUi;
$('#btnFull').onclick = toggleFull;
$('#btnNext').onclick = () => nextLayout();
$('#btnShot').onclick = () => { shotPending = true; };

// 出力ウィンドウ：映像だけを別ウィンドウに出す（OBS のウィンドウキャプチャ → Spout2 / NDI 用）
let outWin = null, outCtx = null;
function openOutput() {
  if (outWin && !outWin.closed) { outWin.focus(); return; }
  const dpr = window.devicePixelRatio || 1;
  outWin = window.open('', 'ebb-flow-output', `popup=yes,width=${Math.round(W / dpr)},height=${Math.round(H / dpr)}`);
  if (!outWin) { alert('ポップアップがブロックされました。アドレスバー右のアイコンから許可してください。'); return; }
  const d = outWin.document;
  d.title = 'ebb flow output';
  d.body.innerHTML = '';
  d.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
  const c = d.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;display:block;object-fit:contain';
  d.body.appendChild(c);
  outCtx = c.getContext('2d', { alpha: false });
  d.addEventListener('dblclick', () => (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen()));
  $('#btnOut').classList.add('on');
  setControlMode(true);
}

// 操作専用モード：出力中は元ウィンドウを「小さなプレビュー＋操作パネル」の縦長レイアウトにする
function setControlMode(on) {
  document.documentElement.classList.toggle('control', on && !ctlWin);
  document.body.classList.remove('ui-hidden');
  $('#controlBar').hidden = !on;
}
$('#btnPreview').onclick = () => {
  const off = document.documentElement.classList.toggle('no-preview');
  $('#btnPreview').classList.toggle('on', !off);
};
// 操作パネルを細い別窓へ（普通のウィンドウは約500pxより細くできないため）
const panelEl = $('#panel');
function openControlWindow() {
  if (ctlWin && !ctlWin.closed) { dockBack(); return; }
  const w = 340, h = screen.availHeight;
  const left = (screen.availLeft || 0) + screen.availWidth - w, top = screen.availTop || 0;
  ctlWin = window.open('', 'ebb-flow-control', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!ctlWin) { alert('ポップアップがブロックされました。アドレスバー右のアイコンから許可してください。'); return; }
  const d = ctlWin.document;
  d.title = 'NSFWaccelerator 操作';
  d.head.innerHTML = '<meta charset="UTF-8">';
  const link = d.createElement('link');
  link.rel = 'stylesheet'; link.href = new URL('style.css', location.href).href;
  d.head.appendChild(link);
  d.documentElement.className = 'control ctlwin';
  d.body.innerHTML = '';
  d.body.appendChild(panelEl);
  ctlWin.addEventListener('keydown', onKeyDown);
  ctlWin.addEventListener('keyup', onKeyUp);
  ctlWin.addEventListener('pointerup', onPointerUp);
  ctlWin.addEventListener('pagehide', dockBack);
  document.documentElement.classList.remove('control');
  document.documentElement.classList.add('undocked');
  $('#btnDock').textContent = '元の窓に戻す';
}
function dockBack() {
  if (panelEl.ownerDocument !== document) document.body.appendChild(panelEl);
  const w = ctlWin; ctlWin = null;
  if (w && !w.closed) w.close();
  document.documentElement.classList.remove('undocked');
  $('#btnDock').textContent = '細い別窓に';
  setControlMode(!!(outWin && !outWin.closed));
}
$('#btnDock').onclick = openControlWindow;
$('#btnCloseOut').onclick = () => { if (outWin && !outWin.closed) outWin.close(); };
$('#btnOut').onclick = openOutput;
$('#outRes').addEventListener('change', (e) => { S.outRes = e.target.value; save(); resize(); nextLayout(0); });
addEventListener('beforeunload', () => { if (outWin && !outWin.closed) outWin.close(); if (ctlWin && !ctlWin.closed) ctlWin.close(); });
const burstBtn = $('#btnBurst');
const setBurst = (on) => { burst = on; burstBtn.classList.toggle('on', on); };
burstBtn.addEventListener('pointerdown', () => setBurst(true));
function onPointerUp() { if (burst && !spaceHeld) setBurst(false); }
addEventListener('pointerup', onPointerUp);
$('#btnReset').onclick = () => { defaults(); syncBuiltin(); syncUi(); save(); nextLayout(); };

let spaceHeld = false;
function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'KeyH' && (ctlWin || document.documentElement.classList.contains('control'))) return;
  if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; setBurst(true); }
  else if (e.code === 'KeyH') toggleUi();
  else if (e.code === 'KeyF') toggleFull();
  else if (e.code === 'KeyN') nextLayout();
}
function onKeyUp(e) { if (e.code === 'Space') { spaceHeld = false; setBurst(false); } }
addEventListener('keydown', onKeyDown);
addEventListener('keyup', onKeyUp);

// ---------------------------------------------------------------- 音
// 入力（マイク/ライン・PCの音・音声ファイル）を解析して 低/中/高 とビートを出す
const cur = { warp: S.warp, after: S.after, bri: S.bri };
let actx = null, analyser = null, inputNode = null, inputStream = null, playerNode = null;
let freq = null;
const env = { low: 0, mid: 0, high: 0, vol: 0, prevLow: 0, riseAvg: 0, flash: 0, lastBeat: 0 };
const player = $('#player');

function ensureAudio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = actx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    freq = new Uint8Array(analyser.frequencyBinCount);
  }
  actx.resume();
}

function stopAudio() {
  if (inputNode) { try { inputNode.disconnect(); } catch (e) {} }
  inputNode = null;
  if (inputStream) inputStream.getTracks().forEach((t) => t.stop());
  inputStream = null;
  player.pause();
  player.hidden = true;
  $('#audioName').textContent = '音の入力なし';
}

function useStream(stream, label) {
  ensureAudio();
  stopAudio();
  if (!stream.getAudioTracks().length) { alert('音声が含まれていません。共有時に「音声を共有」をオンにしてください。'); stream.getTracks().forEach((t) => t.stop()); return; }
  inputStream = stream;
  inputNode = actx.createMediaStreamSource(stream);
  inputNode.connect(analyser);
  $('#audioName').textContent = label;
  stream.getAudioTracks()[0].addEventListener('ended', stopAudio);
}

const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

$('#btnMic').onclick = async () => {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch (e) { alert('マイクの許可が必要です: ' + e.message); return; }
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
  const sel = $('#micSelect');
  sel.innerHTML = '';
  devs.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId; o.textContent = d.label || `入力 ${i + 1}`;
    sel.appendChild(o);
  });
  $('#micPick').hidden = false;
};
$('#btnMicAdd').onclick = async () => {
  const sel = $('#micSelect');
  $('#micPick').hidden = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: sel.value }, ...RAW_AUDIO } });
    useStream(stream, sel.selectedOptions[0]?.textContent || 'マイク');
  } catch (e) { alert('音声入力を開けませんでした: ' + e.message); }
};

// Chrome / Edge (Windows) なら画面共有ダイアログで「システム音声を共有」を選ぶとPCの音が取れる
$('#btnSys').onclick = async () => {
  try {
    const nav = panelEl.ownerDocument.defaultView.navigator;
    const stream = await nav.mediaDevices.getDisplayMedia({ video: true, audio: RAW_AUDIO, systemAudio: 'include' });
    stream.getVideoTracks().forEach((t) => { t.enabled = false; });
    useStream(stream, 'PCの音');
  } catch (e) { if (e.name !== 'NotAllowedError') alert('PCの音を取り込めませんでした: ' + e.message); }
};

$('#audioInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  ensureAudio();
  stopAudio();
  if (player.src.startsWith('blob:')) URL.revokeObjectURL(player.src);
  player.src = URL.createObjectURL(f);
  player.hidden = false;
  if (!playerNode) playerNode = actx.createMediaElementSource(player);
  playerNode.connect(analyser);
  playerNode.connect(actx.destination); // ファイルはスピーカーにも鳴らす
  inputNode = playerNode;
  player.play().catch(() => {});
  $('#audioName').textContent = f.name;
});
$('#btnAudioStop').onclick = stopAudio;

function band(a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += freq[i];
  const v = s / (b - a) / 255;
  return Math.max(0, (v - 0.25) / 0.75) * S.aGain;
}
const follow = (e, v) => e + (v - e) * (v > e ? 0.6 : 0.12);

function updateAudio(dt, now) {
  const out = { active: false, low: 0, mid: 0, high: 0, vol: 0, beat: false, flash: 0 };
  if (!analyser || !inputNode || (inputNode === playerNode && player.paused)) {
    env.low = env.mid = env.high = env.vol = 0;
    drawMeter(out);
    return out;
  }
  analyser.getByteFrequencyData(freq);
  const hz = actx.sampleRate / analyser.fftSize; // 1bin あたりの周波数
  const bin = (f) => Math.max(1, Math.min(freq.length, Math.round(f / hz)));
  const low = band(bin(30), bin(160)), mid = band(bin(160), bin(2000)), high = band(bin(2000), bin(11000));
  env.low = follow(env.low, low); env.mid = follow(env.mid, mid); env.high = follow(env.high, high);
  env.vol = follow(env.vol, (low + mid + high) / 3);
  // ビート：低音が直近の平均を一気に超えたら
  // ビート：低音が急に立ち上がったら（直近の立ち上がり平均と比べる）
  const rise = Math.max(0, low - env.prevLow);
  env.prevLow = low;
  const thr = Math.max(0.03, env.riseAvg * (1.5 + (1 - S.aBeat) * 4));
  let beat = false;
  if (rise > thr && low > 0.1 && now - env.lastBeat > S.aBeatMin) { beat = true; env.lastBeat = now; env.flash = 1; }
  env.riseAvg += (rise - env.riseAvg) * Math.min(1, dt * 2);
  env.flash = Math.max(0, env.flash - dt * 5);
  Object.assign(out, { active: true, low: env.low, mid: env.mid, high: env.high, vol: env.vol, beat, flash: env.flash });
  drawMeter(out);
  return out;
}

const meter = $('#meter'), mctx = meter.getContext('2d');
function drawMeter(a) {
  if (document.body.classList.contains('ui-hidden')) return;
  mctx.clearRect(0, 0, meter.width, meter.height);
  const bars = [['低', a.low, '#3d6dff'], ['中', a.mid, '#6fb6e8'], ['高', a.high, '#d8f0ff']];
  const bw = (meter.width - 40) / 3;
  bars.forEach(([, v, c], i) => {
    mctx.fillStyle = c;
    mctx.fillRect(i * (bw + 4), 0, Math.min(1, v) * bw, meter.height);
  });
  mctx.fillStyle = a.flash > 0 ? `rgba(255,255,255,${a.flash})` : '#1c2530';
  mctx.fillRect(meter.width - 28, 0, 28, meter.height);
}

// ---------------------------------------------------------------- 起動
buildSliders();
syncBuiltin();
syncUi();
renderUserList();
resize();
requestAnimationFrame(frame);
