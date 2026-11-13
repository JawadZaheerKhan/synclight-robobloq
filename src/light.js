// Driver for Robobloq "SyncLight" USB lights (VID 0x1A86, PID 0xFE07, firmware >= 1.x).
// Protocol recovered from the official app (module "60895"):
//   Command frame : 'R','B', len, seq, action, ...payload, checksum   (checksum = sum of all prior bytes mod 256)
//   Screen stream : 'S','C', lenHi, lenLo, seq, 128, ...groups, checksum
//   Colour groups : 5 bytes each [firstLed, r, g, b, lastLed]  (1-based, inclusive)
// Transport: HID interface 0, output report ID 0, 64-byte chunks. No device addressing.
const HID = require('node-hid');

const VID = 0x1a86, PID = 0xfe07;
const A = { SYNC_SCREEN: 128, WRITE_INFO: 129, READ_INFO: 130, READ_UUID: 131, EFFECT: 133,
            SECTION: 134, BRIGHTNESS: 135, SPEED: 138, OPEN_URL: 147, OFF: 151 };
const sum = (b) => b.reduce((a, x) => (a + x) & 0xff, 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const nextSeq = () => (seq = (seq % 250) + 1);

function rb(action, payload = []) {
  const len = 6 + payload.length;
  const b = Buffer.alloc(len);
  b.write('RB', 0, 'ascii'); b[2] = len; b[3] = nextSeq(); b[4] = action;
  Buffer.from(payload).copy(b, 5);
  b[len - 1] = sum(b);
  return b;
}

function sc(groups) { // groups: flat [first,r,g,b,last, ...]
  const len = 7 + groups.length;
  const b = Buffer.alloc(len);
  b.write('SC', 0, 'ascii'); b.writeUInt16BE(len, 2); b[4] = nextSeq(); b[5] = A.SYNC_SCREEN;
  Buffer.from(groups).copy(b, 6);
  b[len - 1] = sum(b);
  return b;
}

class Light {
  constructor(dev, path) {
    this.dev = dev; this.path = path; this.replies = [];
    dev.on('data', (d) => { if (['RB', 'SC'].includes(d.toString('ascii', 0, 2))) this.replies.push(d); });
    dev.on('error', () => { this.closed = true; });
  }

  static list() {
    return HID.devices().filter((d) => d.vendorId === VID && d.productId === PID && d.interface === 0);
  }

  // `hid` is injectable so tests can fake the device.
  static async open(path, hid = HID) {
    const dev = await hid.HIDAsync.open(path);
    const l = new Light(dev, path);
    try { await l.readInfo(); }
    catch (e) { await dev.close().catch(() => {}); throw e; }   // never leak the handle: a leaked one blocks every later open
    return l;
  }

  async send(buf) {
    for (let i = 0; i < buf.length; i += 64) {
      await this.dev.write(Buffer.concat([Buffer.from([0]), buf.subarray(i, i + 64)]));
    }
  }

  async request(buf, timeout = 500) {
    const id = buf[buf[0] === 0x53 ? 4 : 3];
    this.replies.length = 0;
    await this.send(buf);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const r = this.replies.find((x) => (x[0] === 0x53 ? x[4] : x[3]) === id);
      if (r) return r;
      await sleep(5);
    }
    return null;
  }

  async readInfo() {
    // Right after plug-in, wake or a USB reset the light can take a moment to answer, so try a few times.
    let r = null;
    for (let i = 0; i < 4 && !r; i++) { r = await this.request(rb(A.READ_INFO), 700); if (!r) await sleep(250); }
    if (!r) throw new Error('light did not answer the info request');
    this.info = {
      lamps: r[11],
      uuid: r.subarray(12, 20).toString('hex'),
      firmware: [r[21], r[22], r[23]].join('.'),
    };
    this.lamps = this.info.lamps || 100;
    await this.send(rb(A.OPEN_URL, [0]));   // the official app always sends this after reading info
    return this.info;
  }

  // Solid colour across the whole strip (lit LEDs 1..lamps, anything beyond is blanked).
  setColor(r, g, b) {
    const n = this.lamps;
    const g1 = [1, r, g, b, n];
    const rest = n < 254 ? [n + 1, 0, 0, 0, 254] : [];
    return this.send(rb(A.SECTION, [...g1, ...rest]));
  }
  setBrightness(pct) { return this.send(rb(A.BRIGHTNESS, [Math.max(0, Math.min(100, pct))])); }
  setEffect(type, index) { return this.send(rb(A.EFFECT, [type, index])); }
  turnOff() { return this.send(rb(A.OFF)); }
  // Fast path for ambilight: array of [r,g,b] per LED, run-length-merged into groups.
  setLeds(colors) {
    const groups = [];
    let start = 0;
    for (let i = 1; i <= colors.length; i++) {
      const same = i < colors.length && colors[i][0] === colors[start][0] && colors[i][1] === colors[start][1] && colors[i][2] === colors[start][2];
      if (!same) { groups.push(start + 1, ...colors[start], i); start = i; }
    }
    return this.send(sc(groups));
  }
  close() { return this.dev.close(); }
}

module.exports = { Light, rb, sc, sleep };
