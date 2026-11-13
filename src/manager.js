// Keeps every connected light open, re-finds them after unplug/replug/sleep, and re-applies the last
// requested state so a dropout never leaves a light in the wrong colour.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { Light, sleep } = require('./light');

const { file, readJson, writeJson } = require('./paths');
const NAMES = file('names.json');
const STATE = file('state.json');
const LAYOUTS = file('layouts.json');
const IGNORED = file('ignored.json');

class Manager extends EventEmitter {
  constructor() {
    super();
    this.lights = new Map();                       // uuid -> Light
    this.queues = new Map();                       // uuid -> promise chain (one write at a time per light)
    this.state = readJson(STATE, {});              // uuid -> {on, color:[r,g,b], brightness}
    this.names = readJson(NAMES, {});
    this.layouts = readJson(LAYOUTS, {});
    this.ignored = readJson(IGNORED, {});           // uuid -> label; these lights are released and hidden
    this.failed = new Map();                        // path -> last open error, so we only report a reason once
    this.skip = new Set();                          // HID paths of ignored lights, so we stop re-opening them
    this.scanning = false;
  }

  start(intervalMs = 2000) {
    const tick = () => this.scan().catch(() => {}).finally(() => { this.timer = setTimeout(tick, intervalMs); });
    tick();
  }
  stop() { clearTimeout(this.timer); for (const l of this.lights.values()) l.close().catch(() => {}); }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const present = new Set(Light.list().map((d) => d.path));
      for (const [uuid, l] of this.lights) {
        if (l.closed || !present.has(l.path)) { l.close().catch(() => {}); this.lights.delete(uuid); this.emit('lost', uuid); }
      }
      for (const p of this.skip) if (!present.has(p)) this.skip.delete(p);
      for (const p of this.failed.keys()) if (!present.has(p)) this.failed.delete(p);
      const open = new Set([...this.lights.values()].map((l) => l.path));
      for (const p of present) {
        if (open.has(p) || this.skip.has(p)) continue;
        try {
          const l = await Light.open(p);
          if (this.ignored[l.info.uuid]) { this.skip.add(p); await l.close().catch(() => {}); continue; }
          this.lights.set(l.info.uuid, l);
          this.emit('found', l.info.uuid);
          await this.apply(l.info.uuid);           // restore last known state
        } catch (e) {                                  // busy or still waking up: retry next scan, but say why (once)
          if (this.failed.get(p) !== e.message) { this.failed.set(p, e.message); this.emit('openfail', p, e.message); }
        }
      }
    } finally { this.scanning = false; }
  }

  // Serialise writes per light; any failure marks the light closed so the next scan reconnects it.
  run(uuid, fn) {
    const l = this.lights.get(uuid);
    if (!l) return Promise.reject(new Error('light not connected'));
    const prev = this.queues.get(uuid) || Promise.resolve();
    const next = prev.catch(() => {}).then(async () => {
      try { await fn(l); await sleep(15); } catch (e) { l.closed = true; throw e; }
    });
    this.queues.set(uuid, next);
    return next;
  }

  async apply(uuid) {
    const s = this.state[uuid];
    if (!s) return;
    if (s.on === false) return this.run(uuid, (l) => l.turnOff());
    await this.run(uuid, (l) => l.setBrightness(s.brightness ?? 100));
    if (s.color) await this.run(uuid, (l) => l.setColor(...s.color));
  }

  async set(uuid, patch) {
    const s = (this.state[uuid] = { on: true, color: [255, 255, 255], brightness: 100, ...this.state[uuid] });
    if (patch.brightness !== undefined) s.brightness = Math.max(0, Math.min(100, Math.round(patch.brightness)));
    if (patch.color) { s.color = patch.color.map((v) => Math.max(0, Math.min(255, Math.round(v)))); s.on = true; }
    if (patch.on !== undefined) s.on = !!patch.on;
    writeJson(STATE, this.state);
    await this.apply(uuid);
  }

  // Persist a light's name and strip layout (used by the setup wizard).
  saveLight(uuid, { name, display, segments }) {
    name = (name || '').trim() || `Light ${uuid.slice(-4)}`;
    this.names[uuid] = name;
    this.layouts[uuid] = { ...(this.layouts[uuid] || {}), name, display: display || '', segments };
    writeJson(NAMES, this.names);
    writeJson(LAYOUTS, this.layouts);
  }

  // Forget a light entirely; if it is still plugged in it shows up again as a new light.
  forget(uuid) {
    delete this.names[uuid]; delete this.layouts[uuid]; delete this.state[uuid];
    writeJson(NAMES, this.names);
    writeJson(LAYOUTS, this.layouts);
    writeJson(STATE, this.state);
  }

  // Ignore a light: hide it and let go of the USB device (so other software can use it).
  ignore(uuid, label) {
    this.ignored[uuid] = label || this.names[uuid] || `Light ${uuid.slice(-4)}`;
    writeJson(IGNORED, this.ignored);
    const l = this.lights.get(uuid);
    if (l) { this.skip.add(l.path); l.close().catch(() => {}); this.lights.delete(uuid); }
  }
  unignore(uuid) {
    delete this.ignored[uuid];
    writeJson(IGNORED, this.ignored);
    this.skip.clear();
  }

  list() {
    const ids = new Set([...Object.keys(this.names), ...Object.keys(this.layouts), ...this.lights.keys()]);
    for (const u of Object.keys(this.ignored)) ids.delete(u);
    return [...ids].sort().map((uuid) => ({
      uuid, name: this.names[uuid] || `Light ${uuid.slice(-4)}`,
      configured: !!this.layouts[uuid], display: this.layouts[uuid]?.display || '', segments: this.layouts[uuid]?.segments || null,
      connected: this.lights.has(uuid),
      lamps: this.lights.get(uuid)?.info.lamps ?? null,
      leds: this.layouts[uuid] ? this.layouts[uuid].segments.reduce((n, s) => n + s.count, 0) : (this.lights.get(uuid)?.info.lamps ?? null),
      firmware: this.lights.get(uuid)?.info.firmware ?? null,
      state: { on: true, color: [255, 255, 255], brightness: 100, ...this.state[uuid] },
    }));
  }
}

module.exports = { Manager };
