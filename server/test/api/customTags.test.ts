import { beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import db, { FIRST_PROFILE_ID } from '../../src/db.js';
import { as, buildTestApp, seedVideo } from '../helpers.js';

/**
 * Tags people add themselves sit beside the built-in ones: they can be put on
 * videos, they never duplicate an existing tag, and deleting one takes it off
 * every video so nothing is left carrying a tag that no longer exists.
 */

let app: FastifyInstance;
let cookie: string;
let alice: ReturnType<typeof as>;

const tagsOf = (id: string) =>
  db.prepare('SELECT training_type, body_parts, equipment, level FROM videos WHERE id = ?').get(id) as Record<string, string | null>;

const removeTag = (kind: string, value: string) =>
  app.inject({ method: 'DELETE', url: '/api/library/tags', payload: { kind, value }, headers: { cookie } });

beforeAll(async () => {
  app = await buildTestApp();
  const res = await as(app).post(`/api/profiles/${FIRST_PROFILE_ID}/select`);
  const header = res.headers['set-cookie'];
  cookie = String(Array.isArray(header) ? header[0] : header).split(';')[0];
  alice = as(app, cookie);
  seedVideo({ id: 'v1', filename: 'Salsa night.mp4', trainingType: ['Cardio'] });
  seedVideo({ id: 'v2', filename: 'Other.mp4' });
});

describe('custom tags', () => {
  it('adds a tag, and folds a near-duplicate onto the existing one', async () => {
    const added = await alice.post('/api/library/tags', { kind: 'training_type', label: '  Salsa  ' });
    expect(added.statusCode).toBe(200);
    expect(added.json().value).toBe('Salsa');

    // Different case and spacing: the same tag, not a second one.
    const again = await alice.post('/api/library/tags', { kind: 'training_type', label: 'salsa' });
    expect(again.json().value).toBe('Salsa');

    // Matching a built-in tag answers with the built-in value.
    const builtIn = await alice.post('/api/library/tags', { kind: 'training_type', label: 'dance' });
    expect(builtIn.json().value).toBe('Dance');

    const list = await alice.get('/api/library/tags');
    expect(list.json().custom.training_type).toEqual(['Salsa']);
  });

  it('rejects empty and over-long names', async () => {
    expect((await alice.post('/api/library/tags', { kind: 'equipment', label: '   ' })).statusCode).toBe(400);
    expect((await alice.post('/api/library/tags', { kind: 'equipment', label: 'x'.repeat(40) })).statusCode).toBe(400);
    expect((await alice.post('/api/library/tags', { kind: 'nonsense', label: 'Rope' })).statusCode).toBe(400);
  });

  it('saves custom and new built-in tags and a level on a video, and drops unknown ones', async () => {
    await alice.post('/api/library/tags', { kind: 'equipment', label: 'Water bottles' });
    const res = await alice.patch('/api/library/videos/v1', {
      description: '',
      equipment: ['Water bottles', 'mini_bands', 'made-up'],
      training_type: ['Cardio', 'Salsa', 'Dance', 'Nope'],
      body_parts: ['pelvic_floor'],
      intensity: 'medium',
      level: 'beginner',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      equipment: ['Water bottles', 'mini_bands'],
      training_type: ['Cardio', 'Salsa', 'Dance'],
      body_parts: ['pelvic_floor'],
      level: 'beginner',
    });
  });

  it('leaves the level alone when an older client does not send it', async () => {
    await alice.patch('/api/library/videos/v1', { description: '', training_type: ['Cardio', 'Salsa'] });
    expect(tagsOf('v1').level).toBe('beginner');
  });

  it('deleting a tag takes it off every video', async () => {
    db.prepare(`UPDATE videos SET training_type = '["Salsa"]' WHERE id = 'v2'`).run();
    const res = await removeTag('training_type', 'Salsa');
    expect(res.statusCode).toBe(200);
    expect(res.json().videos).toBe(2);
    expect(JSON.parse(tagsOf('v1').training_type!)).toEqual(['Cardio']);
    expect(JSON.parse(tagsOf('v2').training_type!)).toEqual([]);
    expect((await alice.get('/api/library/tags')).json().custom.training_type).toEqual([]);
  });

  it('cannot delete a built-in tag', async () => {
    expect((await removeTag('training_type', 'Dance')).statusCode).toBe(404);
  });

  it('needs a profile once there is more than one to choose from', async () => {
    // With a single profile the app signs everyone into it; a second one
    // makes the choice real.
    await as(app, cookie).post('/api/profiles', { name: 'Bob' });
    expect((await as(app).get('/api/library/tags')).statusCode).toBe(401);
  });
});
