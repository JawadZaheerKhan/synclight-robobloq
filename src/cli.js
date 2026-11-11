const { Light } = require('./light');
// Lights enumerate in unstable order and share a USB serial, so identify them by the uuid they report.
async function openAll() {
  const ls = [];
  for (const d of Light.list()) ls.push(await Light.open(d.path));
  return ls.sort((a, b) => a.info.uuid.localeCompare(b.info.uuid));
}
(async () => {
  const [cmd, idx, ...args] = process.argv.slice(2);
  const lights = await openAll();
  if (cmd === 'list' || !cmd) lights.forEach((l, i) => console.log(i, l.info.uuid, `${l.info.lamps} LEDs`, `fw ${l.info.firmware}`));
  else {
    const targets = idx === 'all' ? lights : [lights[+idx]];
    for (const l of targets) {
      if (cmd === 'color') await l.setColor(...args.map(Number));
      if (cmd === 'brightness') await l.setBrightness(+args[0]);
      if (cmd === 'effect') await l.setEffect(+args[0], +args[1]);
      if (cmd === 'off') await l.turnOff();
      console.log(l.info.uuid, `(${l.info.lamps} LEDs)`, '->', cmd, args.join(' '));
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await Promise.all(lights.map((l) => l.close()));
})().catch((e) => { console.error(e.message); process.exit(1); });
