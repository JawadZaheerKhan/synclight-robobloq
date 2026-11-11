require('./_env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSegments, parseShape } = require('../src/layout');
const { sampleLayout, friendlyError } = require('../src/sync');
const { geometry, EFFECTS } = require('../src/effects');

test('right-start layout winds up the right, across the top leftwards, down the left', () => {
  assert.deepEqual(buildSegments('right', [15, 27, 15]), [
    { edge: 'right', direction: 'up', count: 15 },
    { edge: 'top', direction: 'left', count: 27 },
    { edge: 'left', direction: 'down', count: 15 }]);
});

test('left-start layout is the mirror image', () => {
  assert.deepEqual(buildSegments('left', [18, 32, 18]), [
    { edge: 'left', direction: 'up', count: 18 },
    { edge: 'top', direction: 'right', count: 32 },
    { edge: 'right', direction: 'down', count: 18 }]);
});

test('parseShape accepts good input and rejects bad counts', () => {
  assert.equal(parseShape({ startSide: 'left', counts: [10, 20, 10] })[0].edge, 'left');
  assert.equal(parseShape({ counts: ['10', '20', '10'] })[0].edge, 'right');     // default start, numeric strings ok
  for (const counts of [[0, 20, 10], [10, 20], [300, 1, 1], [100, 100, 100], [1.4, 20, 10].map(() => NaN)])
    assert.throws(() => parseShape({ counts }), /LED counts/);
});

// Paint only the bottom-right corner of a tiny "screen" red and see which LEDs notice.
function redBottomRight() {
  const w = 96, h = 54, rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x > w * 0.8 && y > h * 0.8) rgb[(y * w + x) * 3] = 255;
  return { w, h, rgb };
}
const lit = (cols) => cols.map((c, i) => (c[0] > 120 ? i : -1)).filter((i) => i >= 0);

test('screen sync: right-start strip -> bottom-right corner is the FIRST LEDs', () => {
  const cols = sampleLayout(redBottomRight(), { segments: buildSegments('right', [15, 27, 15]) });
  assert.equal(cols.length, 57);
  assert.deepEqual(lit(cols), [0, 1, 2]);
});

test('screen sync: left-start strip -> bottom-right corner is the LAST LEDs', () => {
  const cols = sampleLayout(redBottomRight(), { segments: buildSegments('left', [15, 27, 15]) });
  assert.deepEqual(lit(cols), [54, 55, 56]);
});

test('geometry places LEDs on the right edge first for a right-start strip', () => {
  const g = geometry({ segments: buildSegments('right', [10, 20, 10]) });
  assert.equal(g.length, 40);
  assert.ok(g[0].x === 1 && g[0].y > 0.9);          // bottom of the right edge
  assert.ok(g[9].x === 1 && g[9].y < 0.1);          // top of the right edge
  assert.ok(g[10].y === 0 && g[10].x > 0.9);        // top edge starts at the right
  assert.ok(g[39].x === 0 && g[39].y > 0.9);        // ends at the bottom of the left edge
});

test('every flow returns a finite RGB triple for every LED over time', () => {
  const g = geometry({ segments: buildSegments('right', [10, 20, 10]) });
  for (const [id, e] of Object.entries(EFFECTS))
    for (let T = 0; T < 12; T += 0.37)
      for (const p of g) {
        const c = e.fn(p, T, [255, 0, 80], [0, 0, 0]);
        assert.equal(c.length, 3, id);
        assert.ok(c.every(Number.isFinite), `${id} gave ${c}`);
      }
});

test('a Screen Recording refusal becomes plain instructions', () => {
  const msg = friendlyError('capture failed: Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801 "The user declined TCCs"');
  assert.match(msg, /Screen & System Audio Recording/);
  assert.match(msg, /SyncLight 2/);
  assert.equal(friendlyError('something else broke'), 'something else broke');
});
