import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import db, { DATA_DIR } from '../src/db.js';

describe('MFP_DATA_DIR', () => {
  it('moves the database and its folders out of the working directory', () => {
    expect(DATA_DIR).toBe(process.env.MFP_DATA_DIR);
    expect(DATA_DIR).not.toBe(path.join(process.cwd(), 'data'));
    expect(DATA_DIR.startsWith(fs.realpathSync(os.tmpdir()))).toBe(true);
    expect(db.name).toBe(path.join(DATA_DIR, 'workout-planner.db'));
    expect(fs.existsSync(path.join(DATA_DIR, 'thumbnails'))).toBe(true);
  });
});
