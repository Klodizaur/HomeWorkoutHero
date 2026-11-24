import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { as, buildTestApp, tempFolder } from '../helpers.js';

/**
 * The Library page's Rescan button and the app-wide scan pop-up: a rescan of
 * the saved folder runs in the background, its progress and result can be
 * read by anyone, and only its own profile is told it's theirs.
 */

let app: FastifyInstance;
let api: ReturnType<typeof as>;
const library = tempFolder('scan-status');

const addFile = (relative: string) => {
  const file = path.join(library, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
};

const progress = async () => (await api.get('/api/library/scan-progress')).json();

async function waitForScan() {
  for (let i = 0; i < 100; i++) {
    const p = await progress();
    if (!p.active) return p;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('scan never finished');
}

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  app = await buildTestApp();
  api = as(app);
});

afterAll(() => app.close());

describe('auto-scan setting', () => {
  it('is off by default, saves a valid choice and ignores anything else', async () => {
    expect((await api.get('/api/settings')).json().auto_scan).toBe('off');
    await api.post('/api/settings', { auto_scan: 'hourly' });
    expect((await api.get('/api/settings')).json().auto_scan).toBe('hourly');
    await api.post('/api/settings', { auto_scan: 'every-second' });
    expect((await api.get('/api/settings')).json().auto_scan).toBe('hourly');
  });
});

describe('rescan', () => {
  it('needs a folder first', async () => {
    const res = await api.post('/api/library/rescan');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('no_directory');
  });

  it('scans the saved folder in the background and reports what it added', async () => {
    addFile('Nogi/hantle.mp4');
    expect((await api.post('/api/library/set-directory', { directory: library })).json()).toMatchObject({ count: 1, added: 1 });

    addFile('Joga.mp4');
    addFile('Ramiona/guma.mp4');
    const res = await api.post('/api/library/rescan');
    expect(res.statusCode).toBe(200);
    expect(res.json().started).toBe(true);

    const done = await waitForScan();
    expect(done).toMatchObject({ id: res.json().id, trigger: 'library', mine: true, phase: 'done' });
    expect(done.result).toMatchObject({ count: 3, added: 2, removed: 0, skippedCleanup: false });
    expect(done).not.toHaveProperty('profileId');
  });

  it('says so when the saved folder has gone missing, and never scans it', async () => {
    const gone = tempFolder('scan-status-gone');
    await api.post('/api/library/set-directory', { directory: gone });
    fs.rmSync(gone, { recursive: true, force: true });
    const res = await api.post('/api/library/rescan');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('missing_directory');
  });

  it("doesn't tell another profile the scan is theirs", async () => {
    const created = await api.post('/api/profiles', { name: 'Bob' });
    const bobId = created.json().id ?? created.json().profile?.id;
    const selected = await as(app).post(`/api/profiles/${bobId}/select`);
    const header = selected.headers['set-cookie'];
    const bob = as(app, String(Array.isArray(header) ? header[0] : header).split(';')[0]);
    expect((await bob.get('/api/library/scan-progress')).json().mine).toBe(false);
  });
});
