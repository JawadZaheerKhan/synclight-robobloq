// Animated "flows". Each effect is a pure function of (LED position, time) -> [r,g,b], rendered at ~30fps
// to every connected light that has a layout. Positions come from layouts.json so "left to right" means
// left to right on the actual monitor, whatever the strip length.
const { file, readJson } = require('./paths');

const LAYOUTS = file('layouts.json');

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const mix = (c1, c2, k) => c1.map((v, i) => v + (c2[i] - v) * k);
const hsv = (h, s, v) => {
  h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [r * 255, g * 255, b * 255];
};
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pingpong = (x) => { const m = x % 2; return m < 1 ? m : 2 - m; };
const gauss = (d, w) => Math.exp(-((d / w) ** 2));

// p = {x,y in 0..1 (x: left->right, y: top->bottom), t: 0..1 along the strip, i: led index}
// T = seconds * speed factor, a/b = colours.
const EFFECTS = {
  blink:     { name: 'Blink',        desc: 'Flash on and off',                         fn: (p, T, a, b) => (Math.floor(T * 2) % 2 === 0 ? a : b) },
  breathe:   { name: 'Breathe',      desc: 'Slow fade in and out',                     fn: (p, T, a, b) => mix(b, a, 0.1 + 0.9 * (0.5 + 0.5 * Math.sin(T * 2.2))) },
  sweep:     { name: 'Sweep',        desc: 'A wave from left to right',                fn: (p, T, a, b) => mix(b, a, gauss(p.x - ((T * 0.45) % 1.5 - 0.25), 0.14)) },
  scanner:   { name: 'Scanner',      desc: 'A bar bouncing side to side',              fn: (p, T, a, b) => mix(b, a, gauss(p.x - pingpong(T * 0.6), 0.1)) },
  comet:     { name: 'Comet',        desc: 'A tail racing around the monitor',         fn: (p, T, a, b) => { const d = ((T * 0.4 - p.t) % 1 + 1) % 1; return mix(b, a, d < 0.35 ? (1 - d / 0.35) ** 2 : 0); } },
  alternate: { name: 'Alternate',    desc: 'Left and right swap colours',              fn: (p, T, a, b) => { const ph = Math.floor(T * 1.5) % 2 === 0; return (p.x > 0.5) === ph ? a : b; } },
  sparkle:   { name: 'Sparkle',      desc: 'Random twinkles',                          fn: (p, T, a, b) => (hash(p.i * 7.3 + Math.floor(T * 5) * 13.7) > 0.85 ? a : mix(b, a, 0.06)) },
  rainbow:   { name: 'Rainbow',      desc: 'Rainbow flowing across (ignores colours)', fn: (p, T) => hsv(p.x * 0.8 - T * 0.12, 1, 1) },
  cycle:     { name: 'Colour cycle', desc: 'Whole strip fades through every hue',      fn: (p, T) => hsv(T * 0.08, 1, 1) },
};

function geometry(layout) {
  const total = layout.segments.reduce((n, s) => n + s.count, 0);
  const pts = []; let i = 0;
  for (const s of layout.segments) for (let k = 0; k < s.count; k++, i++) {
    const f = (k + 0.5) / s.count;
    let x = 0, y = 0;
    if (s.edge === 'right')  { x = 1;     y = s.direction === 'up' ? 1 - f : f; }
    if (s.edge === 'left')   { x = 0;     y = s.direction === 'up' ? 1 - f : f; }
    if (s.edge === 'top')    { y = 0;     x = s.direction === 'left' ? 1 - f : f; }
    if (s.edge === 'bottom') { y = 1;     x = s.direction === 'left' ? 1 - f : f; }
    pts.push({ x, y, t: i / total, i });
  }
  return pts;
}

class Effects {
  constructor(mgr) {
    this.mgr = mgr; this.assign = new Map();   // uuid -> { id, speed, colors }
    this.busy = new Set(); this.timer = null; this.geo = {};
  }
  static list() { return Object.entries(EFFECTS).map(([id, e]) => ({ id, name: e.name, desc: e.desc })); }
  status() { return { running: this.assign.size > 0, assigned: Object.fromEntries(this.assign) }; }

  // targets: array of light uuids, or empty/undefined for every light that has a layout.
  start(id, targets, { speed = 50, colors = ['#0a84ff', '#000000'] } = {}) {
    if (!EFFECTS[id]) throw new Error('unknown effect');
    const layouts = readJson(LAYOUTS, {});
    this.geo = Object.fromEntries(Object.entries(layouts).map(([u, l]) => [u, geometry(l)]));
    const uuids = targets && targets.length ? targets : Object.keys(layouts);
    for (const u of uuids) if (this.geo[u]) this.assign.set(u, { id, speed: clamp(+speed, 1, 100), colors });
    if (!this.timer && this.assign.size) {
      this.t0 = Date.now();                        // shared clock keeps both monitors in step
      this.timer = setInterval(() => this.tick(), 33);
    }
  }

  tick() {
    const secs = (Date.now() - this.t0) / 1000;
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    for (const [uuid, a] of this.assign) {
      if (!this.mgr.lights.has(uuid) || this.busy.has(uuid)) continue;
      const T = secs * (0.2 + a.speed / 45), c1 = hex(a.colors[0]), c2 = hex(a.colors[1]), fn = EFFECTS[a.id].fn;
      const frame = this.geo[uuid].map((p) => fn(p, T, c1, c2).map((v) => Math.round(clamp(v, 0, 255))));
      this.busy.add(uuid);
      this.mgr.run(uuid, (l) => l.setLeds(frame)).catch(() => {}).finally(() => this.busy.delete(uuid));
    }
  }

  // Stop flows on the given lights (all if none given) and put them back to their saved colour.
  stop(targets) {
    const uuids = targets && targets.length ? targets : [...this.assign.keys()];
    const stopped = uuids.filter((u) => this.assign.delete(u));
    if (!this.assign.size && this.timer) { clearInterval(this.timer); this.timer = null; }
    setTimeout(() => { for (const u of stopped) if (!this.assign.has(u)) this.mgr.apply(u).catch(() => {}); }, 120);
  }
}

module.exports = { Effects, EFFECTS, geometry };
