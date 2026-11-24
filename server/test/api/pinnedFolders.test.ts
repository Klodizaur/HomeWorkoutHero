import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FIRST_PROFILE_ID } from '../../src/db.js';
import { as, buildTestApp } from '../helpers.js';

/**
 * Folders pinned to the top of the Library: newest pin first, never twice,
 * and each profile's own.
 */

let app: FastifyInstance;
let me: ReturnType<typeof as>;

beforeAll(async () => {
  app = await buildTestApp();
  const res = await as(app).post(`/api/profiles/${FIRST_PROFILE_ID}/select`);
  const header = res.headers['set-cookie'];
  me = as(app, String(Array.isArray(header) ? header[0] : header).split(';')[0]);
});

afterAll(() => app.close());

const pins = async (client = me) => (await client.get('/api/library/pins')).json().pins;

describe('pinned folders', () => {
  it('starts empty, puts the newest pin first and never lists one twice', async () => {
    expect(await pins()).toEqual([]);
    await me.post('/api/library/pins', { key: 'Nogi', pinned: true });
    await me.post('/api/library/pins', { key: 'Joga', pinned: true });
    expect(await pins()).toEqual(['Joga', 'Nogi']);
    // Pinning again moves it to the front rather than adding a copy.
    const again = await me.post('/api/library/pins', { key: 'Nogi', pinned: true });
    expect(again.json().pins).toEqual(['Nogi', 'Joga']);
  });

  it('unpins', async () => {
    await me.post('/api/library/pins', { key: 'Joga', pinned: false });
    expect(await pins()).toEqual(['Nogi']);
  });

  it('rejects a request without a folder or a yes/no', async () => {
    expect((await me.post('/api/library/pins', { key: '', pinned: true })).statusCode).toBe(400);
    expect((await me.post('/api/library/pins', { key: 'Nogi' })).statusCode).toBe(400);
  });

  it("keeps each profile's pins to itself", async () => {
    const created = await me.post('/api/profiles', { name: 'Bob' });
    const bobId = created.json().id ?? created.json().profile?.id;
    const selected = await as(app).post(`/api/profiles/${bobId}/select`);
    const header = selected.headers['set-cookie'];
    const bob = as(app, String(Array.isArray(header) ? header[0] : header).split(';')[0]);
    expect(await pins(bob)).toEqual([]);
    await bob.post('/api/library/pins', { key: 'Kids', pinned: true });
    expect(await pins()).toEqual(['Nogi']);
  });
});
