# Light protocol notes

How SyncLight 2 talks to the Robobloq USB light (`0x1A86:0xFE07`, firmware 1.8.2). This was worked out by observing the official app's behaviour with hardware the author owns, and checked against real lights. Items are marked **verified** (seen working on a real light) or **unverified** (taken from the official app's behaviour but not confirmed visually).

## Transport

- USB HID, **interface 0** (vendor usage page `0xFF00`). Interface 1 is a keyboard-style interface used for the light's own buttons; ignore it.
- Commands are **output reports, report ID 0, 64 bytes** per report. Frames longer than 64 bytes are split across consecutive reports.
- Replies arrive as input reports starting with `RB`.
- Only one process can hold the device open. macOS refuses a second open with *"exclusive access and device already open"*, which is why the official app must be closed.
- Quirks of the hardware: every unit reports the same USB serial number (`0123456789`), and the order in which HID enumerates two lights changes between runs. Identify a light by the **8-byte ID it reports** (below), never by serial number or enumeration order.

## Frames

### `RB` command frames

```
52 42 | len | seq | action | payload... | checksum
```

- `len`: total frame length in bytes, including header and checksum.
- `seq`: sequence number, echoed in replies. SyncLight 2 cycles 1-250.
- `checksum`: sum of all preceding bytes, modulo 256.

### `SC` streaming frames (bulk LED colours)

```
53 43 | len_hi len_lo | seq | 80 | groups... | checksum
```

`len` is a big-endian 16-bit total length. Action `0x80`. Used for screen sync and flows; **verified**.

### Colour groups

Both `SC` frames and the `RB` "section" command carry colours as groups of five bytes:

```
first_led  r  g  b  last_led
```

LED numbers are **1-based and inclusive**. A group paints `first..last` with one colour, so consecutive LEDs of the same colour should be merged into a single group to keep frames short. Colour order on the test strips is plain RGB; the official app has a configurable wire order, so other strips may differ.

## Commands (`RB`)

| Action | Hex | Payload | Notes |
|---|---|---|---|
| Read device info | `0x82` | none | Reply below. **Verified.** |
| Section LED (static colour) | `0x86` | colour groups | e.g. `[1, r,g,b, n, n+1, 0,0,0, 254]` lights LEDs 1..n and blanks the rest. **Verified.** |
| Brightness | `0x87` | `[0..100]` | Set via the official app's command; **unverified** against flows/sync. |
| Open-URL / mode | `0x93` | `[0]` | The official app sends this once right after reading device info. Purpose unknown. Harmless. |
| Turn off | `0x97` | none | **Unverified.** |
| Built-in effect | `0x85` | `[type, index]` | Preset effects stored in the light. Not used by SyncLight 2. **Unverified.** |

## Device info reply (`0x82`)

Offsets into the reply report:

| Offset | Meaning |
|---|---|
| 0-1 | `RB` |
| 2 | length |
| 3 | sequence (echo) |
| 4 | action (`0x82`) |
| 11 | number of LEDs the light **reports** (see below) |
| 12-19 | unique **8-byte ID** of the unit |
| 21, 22, 23 | firmware version, major.minor.patch |

The reported LED count is a configured value, not necessarily the number of LEDs on the strip. One test strip reports 100 but physically has 57. Ask the user how many LEDs each side really has.

## Strip order

On the test strips the LEDs run continuously around three sides of the monitor: up one side, across the top, down the other side, starting at a bottom corner. SyncLight 2 models this as an ordered list of segments (`edge`, `direction`, `count`), see `src/layout.js`.

## Other Robobloq devices

The official app also supports a Bluetooth LE device, a wireless dongle (children addressed by 6-byte ID), serial-port lights and keyboard/mouse variants, using related but different framings (for example, `SC`-header frames with a CRC-16 for keyboards and mice). None of those are implemented here. If you have one and want to add it, open an issue with the output of `ioreg -p IOUSB -l` (or the Bluetooth device details) and we can work out the framing together.
