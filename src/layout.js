// Strip shapes. A layout is an ordered list of segments, each one monitor edge with a direction:
//   right/left edges run 'up' (bottom->top) or 'down'; top/bottom edges run 'left' (right->left) or 'right'.
// The wizard builds the common U shape (three sides), starting on the right or on the left.
function buildSegments(startSide, counts) {
  const [a, b, c] = counts;
  return startSide === 'left'
    ? [{ edge: 'left', direction: 'up', count: a }, { edge: 'top', direction: 'right', count: b }, { edge: 'right', direction: 'down', count: c }]
    : [{ edge: 'right', direction: 'up', count: a }, { edge: 'top', direction: 'left', count: b }, { edge: 'left', direction: 'down', count: c }];
}

// Validate wizard input: three counts of 1-254, 254 LEDs in total at most.
function parseShape(p) {
  const counts = (p.counts || []).map((n) => Math.round(+n));
  if (counts.length !== 3 || counts.some((n) => !(n >= 1 && n <= 254)) || counts.reduce((x, y) => x + y, 0) > 254)
    throw new Error('LED counts must be 1-254 per side, 254 in total');
  return buildSegments(p.startSide === 'left' ? 'left' : 'right', counts);
}

module.exports = { buildSegments, parseShape };
