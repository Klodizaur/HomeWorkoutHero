import fs from 'fs';
import path from 'path';
import { afterAll } from 'vitest';

/**
 * Runs before each test file, ahead of anything importing db.ts: points the
 * server's data folder at a fresh temp directory, so every file starts from an
 * empty database and no test can ever reach a real library.
 */
const root = fs.mkdtempSync(path.join(process.env.MFP_TEST_ROOT!, 'file-'));
process.env.MFP_DATA_DIR = path.join(root, 'data');

// And work from inside it too, so anything that still builds `<cwd>/data`
// itself lands in the temp folder rather than in server/data — away from
// MFP_DATA_DIR, so the dataDir test can tell the two apart.
fs.mkdirSync(path.join(root, 'cwd'));
process.chdir(path.join(root, 'cwd'));

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
