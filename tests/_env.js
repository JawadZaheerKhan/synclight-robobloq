// Point settings at a throwaway folder so tests never touch a real user's config.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.SYNCLIGHT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'synclight-test-'));
