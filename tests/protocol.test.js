require('./_env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Light, rb, sc } = require('../src/light');

const sum = (b) => b.reduce((a, x) => (a + x) & 0xff, 0);

test('RB frame: header, length, action and checksum', () => {
  const f = rb(130);                                   // read-info request
  assert.equal(f.toString('ascii', 0, 2), 'RB');
  assert.equal(f[2], f.length);
  assert.equal(f[4], 130);
  assert.equal(f[f.length - 1], sum(f.subarray(0, -1)));
});

test('RB frame carries its payload before the checksum', () => {
  const f = rb(135, [42]);                             // brightness 42
  assert.equal(f.length, 7);
  assert.equal(f[5], 42);
  assert.equal(f[6], sum(f.subarray(0, 6)));
});

test('sequence numbers advance and never reach 0 or 251+', () => {
  const seen = new Set();
  for (let i = 0; i < 600; i++) { const s = rb(130)[3]; assert.ok(s >= 1 && s <= 250); seen.add(s); }
  assert.ok(seen.size > 100);
});

test('SC frame: 16-bit length, action 0x80, groups, checksum', () => {
  const f = sc([1, 255, 0, 0, 10]);
  assert.equal(f.toString('ascii', 0, 2), 'SC');
  assert.equal(f.readUInt16BE(2), f.length);
  assert.equal(f[5], 128);
  assert.deepEqual([...f.subarray(6, 11)], [1, 255, 0, 0, 10]);
  assert.equal(f[f.length - 1], sum(f.subarray(0, -1)));
});

// A fake HID device that records what would be written to the light.
function fakeLight() {
  const writes = [];
  const dev = { on() {}, async write(b) { writes.push(Buffer.from(b)); }, async close() {} };
  const l = new Light(dev, 'fake');
  l.lamps = 10;
  const lastFrame = () => Buffer.concat(writes.map((w) => w.subarray(1)));   // strip HID report id
  return { l, writes, lastFrame };
}

test('setLeds merges runs of identical colours into groups', async () => {
  const { l, lastFrame } = fakeLight();
  await l.setLeds([[255, 0, 0], [255, 0, 0], [255, 0, 0], [0, 0, 255], [0, 0, 255]]);
  const f = lastFrame();
  const body = [...f.subarray(6, f.length - 1)].slice(0, 10);
  assert.deepEqual(body, [1, 255, 0, 0, 3, 4, 0, 0, 255, 5]);   // LEDs 1-3 red, 4-5 blue (1-based, inclusive)
});

test('long frames are split into 64-byte HID reports with report id 0', async () => {
  const { l, writes } = fakeLight();
  await l.setLeds(Array.from({ length: 60 }, (_, i) => [i, 255 - i, 7]));   // all different -> 60 groups
  assert.ok(writes.length > 1);
  for (const w of writes) { assert.equal(w[0], 0); assert.ok(w.length <= 65); }
});

test('setColor fills the strip and blanks anything beyond it', async () => {
  const { l, lastFrame } = fakeLight();
  await l.setColor(1, 2, 3);
  const f = lastFrame();
  assert.equal(f[4], 134);                                         // "section LED" action
  assert.deepEqual([...f.subarray(5, 10)], [1, 1, 2, 3, 10]);      // LEDs 1..10 in the colour
  assert.deepEqual([...f.subarray(10, 15)], [11, 0, 0, 0, 254]);   // the rest off
});

test('a light that never answers is closed, not leaked', async () => {
  let closed = false;
  const dev = { on() {}, async write() {}, async close() { closed = true; } };       // never replies
  const fakeHid = { HIDAsync: { open: async () => dev } };
  await assert.rejects(Light.open('fake', fakeHid), /did not answer/);
  assert.equal(closed, true, 'the HID handle must be released so the next attempt can open the device');
});

test('a light that answers late is still picked up', async () => {
  let onData;
  const dev = { on(ev, f) { if (ev === 'data') onData = f; }, async close() {},
    async write(b) {                                                                  // the first two requests are ignored
      dev.n = (dev.n || 0) + 1;
      if (dev.n >= 3) {                                                               // the third info request is the first one answered
        const reply = Buffer.alloc(64); reply.write('RB', 0, 'ascii'); reply[3] = b[4]; reply[4] = 130; reply[11] = 57; reply[21] = 1; reply[22] = 8; reply[23] = 2;
        setImmediate(() => onData(reply));
      }
    } };
  const l = await Light.open('fake', { HIDAsync: { open: async () => dev } });
  assert.equal(l.info.lamps, 57);
  assert.equal(l.info.firmware, '1.8.2');
});
