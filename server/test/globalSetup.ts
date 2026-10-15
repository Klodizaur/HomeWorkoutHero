import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * One temp folder for the whole run, holding each test file's own folder
 * (see setup.ts). Removed when the run ends — including the folder of a test
 * file that failed to load and so never got to clean up after itself.
 */
export default function () {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mfp-test-')));
  process.env.MFP_TEST_ROOT = root;
  return () => fs.rmSync(root, { recursive: true, force: true });
}
