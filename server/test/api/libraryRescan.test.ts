import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db from '../../src/db.js';
import { as, buildTestApp, tempFolder } from '../helpers.js';

/**
 * Tags are typed by hand and can't be got back, so a rescan of the library
 * folder must never change them on a video it already knows.
 */

let app: FastifyInstance;
let api: ReturnType<typeof as>;
const library = tempFolder('library');

const addFile = (relative: string) => {
  const file = path.join(library, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
};
const scan = async () => {
  const res = await api.post('/api/library/set-directory', { directory: library });
  expect(res.statusCode).toBe(200);
  return res.json();
};
const tagsOf = (relativePath: string) =>
  db.prepare(`
    SELECT id, equipment, training_type, body_parts, intensity, description FROM videos WHERE relative_path = ?
  `).get(relativePath) as Record<string, string | null> | undefined;

beforeAll(async () => {
  // The scan logs a line per file it can't make a thumbnail for (these are
  // empty files); nothing a test needs to see.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  app = await buildTestApp();
  api = as(app); // the only profile, so no cookie needed
  addFile('Nogi/hantle_20min.mp4');
  addFile('Joga poranna.mp4');
  expect((await scan()).count).toBe(2);
});

afterAll(() => app.close());

describe('library rescan', () => {
  it('keeps the tags on videos it already knows', async () => {
    const tagged = tagsOf('Nogi/hantle_20min.mp4')!;
    const cleared = tagsOf('Joga poranna.mp4')!;
    // One retagged by hand, one with everything deliberately cleared.
    await api.patch(`/api/library/videos/${tagged.id}`, {
      equipment: ['kettlebell'], training_type: ['HIIT'], body_parts: ['arms'], intensity: 'low', description: 'My notes',
    });
    await api.patch(`/api/library/videos/${cleared.id}`, {});
    const before = [tagsOf('Nogi/hantle_20min.mp4'), tagsOf('Joga poranna.mp4')];
    expect(before[0]).toMatchObject({ equipment: '["kettlebell"]', intensity: 'low', description: 'My notes' });

    addFile('Ramiona/guma biceps.mp4');
    expect((await scan()).count).toBe(3);

    expect([tagsOf('Nogi/hantle_20min.mp4'), tagsOf('Joga poranna.mp4')]).toEqual(before);
  });

  it('tags a file it sees for the first time from its folders and name', async () => {
    addFile('Plecy/mata_cardio.mp4');
    await scan();
    expect(tagsOf('Plecy/mata_cardio.mp4')).toMatchObject({
      equipment: '["mat"]',
      training_type: '["Cardio"]',
      body_parts: '["back"]',
    });
  });
});
