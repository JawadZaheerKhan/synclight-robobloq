// Where things live. Code and UI ship with the app; each user's own settings live in a data folder
// so updating or reinstalling the app never touches them.
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const DATA = process.env.SYNCLIGHT_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'SyncLight 2');
fs.mkdirSync(DATA, { recursive: true });

const file = (name) => path.join(DATA, name);
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
// Write via a temp file + rename so a crash or power cut can never leave a half-written config.
const writeJson = (f, obj) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(obj, null, 2)); fs.renameSync(t, f); };

module.exports = {
  APP_ROOT, DATA, file, readJson, writeJson,
  PUBLIC: path.join(APP_ROOT, 'public'),
  HELPER: process.env.SYNCLIGHT_HELPER || path.join(APP_ROOT, 'helper', 'capture'),
};
