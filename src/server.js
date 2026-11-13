const http = require('http');
const fs = require('fs');
const path = require('path');
const { Manager } = require('./manager');
const { Sync } = require('./sync');
const { Effects } = require('./effects');
const { execFile } = require('child_process');
const { PUBLIC, DATA } = require('./paths');
const { parseShape } = require('./layout');

const PORT = +process.env.PORT || 7878;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const mgr = new Manager();
mgr.on('found', (u) => log('connected', u));
mgr.on('lost', (u) => log('lost', u));
mgr.on('openfail', (p, why) => log('could not open', p, '-', why.slice(0, 120)));
mgr.start();
const sync = new Sync(mgr);
const effects = new Effects(mgr);

const body = (req) => new Promise((res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res({}); } }); });
const send = (res, code, obj, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(obj) : obj); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Preview: first LED white, then each side in its own colour (red, green, blue); the rest dark.
async function paintPreview(uuid, segments) {
  const l = mgr.lights.get(uuid);
  if (!l) throw new Error('light not connected');
  const palette = [[255, 0, 0], [0, 255, 0], [0, 90, 255]], cols = [];
  segments.forEach((s, i) => { for (let k = 0; k < s.count; k++) cols.push(k === 0 && i === 0 ? [255, 255, 255] : palette[i % 3]); });
  while (cols.length < Math.max(l.lamps, cols.length)) cols.push([0, 0, 0]);
  await mgr.run(uuid, (x) => x.setLeds(cols));
}
async function clearPreview(uuid) {
  const l = mgr.lights.get(uuid);
  if (!l) return;
  if (mgr.state[uuid]) return mgr.apply(uuid);
  await mgr.run(uuid, (x) => x.setLeds(Array.from({ length: l.lamps }, () => [0, 0, 0])));
}
async function identify(uuid) {
  const l = mgr.lights.get(uuid);
  if (!l) throw new Error('light not connected');
  for (let i = 0; i < 4; i++) {
    await mgr.run(uuid, (x) => x.setLeds(Array.from({ length: l.lamps }, () => [255, 255, 255])));
    await sleep(260);
    await mgr.run(uuid, (x) => x.setLeds(Array.from({ length: l.lamps }, () => [0, 0, 0])));
    await sleep(260);
  }
  await clearPreview(uuid);
}

let dispCache = { t: 0, v: [] };
const displays = () => new Promise((resolve) => {
  if (Date.now() - dispCache.t < 300000) return resolve(dispCache.v);
  execFile('system_profiler', ['SPDisplaysDataType', '-json'], { timeout: 10000 }, (e, out) => {
    try {
      const v = [];
      for (const g of JSON.parse(out).SPDisplaysDataType || []) for (const d of g.spdisplays_ndrvs || []) v.push({ name: d._name, resolution: d._spdisplays_resolution || '' });
      dispCache = { t: Date.now(), v }; resolve(v);
    } catch { resolve(dispCache.v); }
  });
});

http.createServer(async (req, res) => {
  try {
    const m = req.url.match(/^\/api\/lights(?:\/([0-9a-f]+))?$/);
    if (m && req.method === 'GET' && !m[1]) return send(res, 200, mgr.list());
    if (m && req.method === 'POST' && m[1]) {
      const p = await body(req);
      if (p.color || p.on !== undefined) { effects.stop([m[1]]); sync.stop(); }
      await mgr.set(m[1], p);
      return send(res, 200, mgr.list().find((l) => l.uuid === m[1]));
    }
    if (req.url === '/api/ignored') return send(res, 200, Object.entries(mgr.ignored).map(([uuid, label]) => ({ uuid, label })));
    if (req.url === '/api/scan' && req.method === 'POST') { await mgr.scan(); return send(res, 200, mgr.list()); }
    if (req.url === '/api/version') return send(res, 200, { v: fs.statSync(path.join(PUBLIC, 'index.html')).mtimeMs });
    if (req.url === '/api/displays') return send(res, 200, await displays());
    const sm = req.url.match(/^\/api\/lights\/([0-9a-f]+)\/(setup|preview|identify|ignore)$/);
    if (sm && req.method === 'POST') {
      const [, uuid, act] = sm, p = await body(req);
      if (act === 'ignore') {
        if (p.ignore === false) mgr.unignore(uuid);
        else { effects.stop([uuid]); sync.stop(); mgr.ignore(uuid, p.label); }
        return send(res, 200, { ok: true });
      }
      if (act === 'identify') { effects.stop([uuid]); sync.stop(); await identify(uuid); return send(res, 200, { ok: true }); }
      if (act === 'preview') {
        effects.stop([uuid]); sync.stop();
        if (p.clear) await clearPreview(uuid); else await paintPreview(uuid, parseShape(p));
        return send(res, 200, { ok: true });
      }
      const segments = parseShape(p);                         // act === 'setup'
      effects.stop([uuid]); sync.stop();
      mgr.saveLight(uuid, { name: p.name, display: p.display, segments });
      await mgr.set(uuid, mgr.state[uuid] ? {} : { color: [255, 255, 255], brightness: 100 });
      await clearPreview(uuid);
      return send(res, 200, mgr.list().find((l) => l.uuid === uuid));
    }
    if (m && req.method === 'DELETE' && m[1]) {
      effects.stop([m[1]]); sync.stop(); mgr.forget(m[1]);
      return send(res, 200, { ok: true });
    }
    const lm = req.url.match(/^\/api\/lights\/([0-9a-f]+)\/leds$/);
    if (lm && req.method === 'POST') {
      const { colors } = await body(req);
      await mgr.run(lm[1], (l) => l.setLeds(colors));
      return send(res, 200, { ok: true });
    }
    if (req.url === '/api/sync') {
      if (req.method === 'POST') {
        const { enabled } = await body(req);
        if (enabled) { effects.stop(); await new Promise((r) => setTimeout(r, 300)); sync.start(); } else sync.stop();
        await new Promise((r) => setTimeout(r, 1000));
      }
      return send(res, 200, { ...sync.status(), displays: sync.displays || [] });
    }
    if (req.url === '/api/effects') {
      if (req.method === 'POST') {
        const p = await body(req);
        if (p.id) {
          if (sync.enabled) { sync.stop(); await new Promise((r) => setTimeout(r, 500)); }
          effects.start(p.id, p.targets, p);
        } else effects.stop(p.targets);
      }
      return send(res, 200, { list: Effects.list(), ...effects.status() });
    }
    if (req.url === '/' || req.url === '/index.html')
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'index.html')), 'text/html; charset=utf-8');
    send(res, 404, { error: 'not found' });
  } catch (e) { send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`SyncLight 2 on http://127.0.0.1:${PORT}  (settings: ${DATA})`));

displays();   // warm the cache at startup
// When the app starts this server it passes its own pid; if the app dies for any reason (crash, force quit,
// termination signal) the server must not linger holding the lights, so it exits too.
const parentPid = +process.env.SYNCLIGHT_PARENT_PID;
if (parentPid) setInterval(() => { try { process.kill(parentPid, 0); } catch { shutdown(); } }, 1500);

const shutdown = () => { effects.stop(); sync.stop(); mgr.stop(); setTimeout(() => process.exit(0), 150); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
