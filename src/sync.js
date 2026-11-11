// Screen sync: runs the Swift capture helper, turns each display's edge pixels into per-LED colours
// using layouts.json, smooths them, and streams them to the matching light.
const { spawn } = require('child_process');
const { file, readJson, HELPER } = require('./paths');
const { EventEmitter } = require('events');

const LAYOUTS = file('layouts.json');
const DEPTH = 0.15;      // how far in from the screen edge to sample (fraction of width/height)
const ALPHA = 0.5;       // smoothing: 1 = no smoothing, lower = smoother
const BLACK = 10;        // channels below this snap to 0 (stops dim flicker on dark scenes)

function average(f, x0, x1, y0, y1) {
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(f.w, Math.max(x0 + 1, Math.ceil(x1))); y1 = Math.min(f.h, Math.max(y0 + 1, Math.ceil(y1)));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * f.w + x) * 3; r += f.rgb[i]; g += f.rgb[i + 1]; b += f.rgb[i + 2]; n++;
  }
  return [r / n, g / n, b / n];
}

// Each segment is one monitor edge with a direction, so strips can start on either side:
//   right/left edges run 'up' (bottom->top) or 'down'; top/bottom edges run 'left' (right->left) or 'right'.
function sampleLayout(f, layout) {
  const out = [];
  const dx = Math.max(2, f.w * DEPTH), dy = Math.max(2, f.h * DEPTH);
  for (const s of layout.segments) {
    for (let k = 0; k < s.count; k++) {
      const a = k / s.count, b = (k + 1) / s.count;
      const rev = s.direction === 'up' || s.direction === 'left';   // runs against the screen axis
      const [p0, p1] = rev ? [1 - b, 1 - a] : [a, b];                // fraction of the edge covered by this LED
      if (s.edge === 'right') out.push(average(f, f.w - dx, f.w, f.h * p0, f.h * p1));
      else if (s.edge === 'left') out.push(average(f, 0, dx, f.h * p0, f.h * p1));
      else if (s.edge === 'top') out.push(average(f, f.w * p0, f.w * p1, 0, dy));
      else if (s.edge === 'bottom') out.push(average(f, f.w * p0, f.w * p1, f.h - dy, f.h));
    }
  }
  return out;
}

// Turn the capture helper's raw failure into something a person can act on.
function friendlyError(text) {
  if (/-3801|declined TCC|not authorized|permission/i.test(text))
    return 'Screen sync needs permission to see your screen. Open System Settings > Privacy & Security > Screen & System Audio Recording, switch on SyncLight 2 (use + to add it if it is not listed), then quit and reopen the app.';
  return text || 'Screen capture stopped unexpectedly.';
}

class Sync extends EventEmitter {
  constructor(mgr) {
    super();
    this.mgr = mgr; this.proc = null; this.error = null;
    this.prev = new Map(); this.busy = new Set(); this.frames = 0;
  }

  get enabled() { return !!this.proc; }
  status() { return { enabled: this.enabled, error: this.error, frames: this.frames }; }

  start() {
    if (this.proc) return;
    this.error = null; this.frames = 0;
    const layouts = readJson(LAYOUTS, {});
    const p = (this.proc = spawn(HELPER, ['30'], { stdio: ['ignore', 'pipe', 'pipe'] }));
    let buf = Buffer.alloc(0), map = null, errText = '';

    p.on('error', (e) => { this.error = `Screen capture helper could not start (${e.code || e.message}). Rebuild with ./install.sh.`; });
    p.stderr.on('data', (d) => {
      errText += d.toString();
      const line = errText.split('\n').find((l) => l.startsWith('['));
      if (line && !map) {
        const displays = JSON.parse(line);
        map = new Map(); // displayIndex -> [{uuid, layout}]
        for (const d of displays) {
          const hits = Object.entries(layouts).filter(([, l]) => l.display && d.name.toLowerCase().includes(l.display.toLowerCase()));
          map.set(d.index, hits.map(([uuid, layout]) => ({ uuid, layout })));
        }
        this.displays = displays;
      }
    });

    p.stdout.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 5) {
        const w = buf.readUInt16BE(1), h = buf.readUInt16BE(3), total = 5 + w * h * 3;
        if (buf.length < total) break;
        if (map) this.onFrame(map.get(buf[0]) || [], { w, h, rgb: buf.subarray(5, total) });
        buf = buf.subarray(total);
      }
    });

    p.on('exit', (code) => {
      this.proc = null;
      if (code && code !== 0 && !this.stopping) this.error = friendlyError(errText.trim().split('\n').pop() || `helper exited (${code})`);
      this.stopping = false;
      this.restore();
      this.emit('change');
    });
    this.emit('change');
  }

  onFrame(targets, frame) {
    this.frames++;
    for (const { uuid, layout } of targets) {
      if (!this.mgr.lights.has(uuid) || this.busy.has(uuid)) continue;   // drop frame if light is still busy
      const cur = sampleLayout(frame, layout);
      const prev = this.prev.get(uuid);
      const out = cur.map((c, i) => c.map((v, ch) => {
        const p = prev && prev[i] ? prev[i][ch] : v;
        const s = p + (v - p) * ALPHA;
        return s < BLACK ? 0 : s;
      }));
      this.prev.set(uuid, out);
      this.busy.add(uuid);
      this.mgr.run(uuid, (l) => l.setLeds(out.map((c) => c.map(Math.round))))
        .catch(() => {}).finally(() => this.busy.delete(uuid));
    }
  }

  stop() {
    if (!this.proc) return;
    this.stopping = true;
    this.proc.kill('SIGTERM');
  }

  restore() {
    this.prev.clear();
    for (const uuid of this.mgr.lights.keys()) this.mgr.apply(uuid).catch(() => {});
  }
}

module.exports = { Sync, sampleLayout, friendlyError };
