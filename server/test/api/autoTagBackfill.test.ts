import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import db from '../../src/db.js';
import externalRoutes from '../../src/routes/external.js';
import { seedVideo } from '../helpers.js';

/**
 * On start, imported videos from before auto-tagging get tags from their
 * titles — but only ones with no tags at all, and only once, so a video the
 * user has tagged (or deliberately cleared) is never second-guessed.
 */

async function startServer() {
  const app = Fastify({ logger: false });
  app.register(externalRoutes, { prefix: '/api/external' });
  await app.ready();
  await app.close();
}

const row = (id: string) =>
  db.prepare('SELECT equipment, training_type, body_parts, intensity FROM videos WHERE id = ?').get(id);

describe('auto-tag backfill', () => {
  it('only fills videos that have no tags at all, and only once', async () => {
    seedVideo({ id: 'untagged', filename: 'Trening z hantlami', source: 'youtube', externalId: 'a' });
    seedVideo({ id: 'partly', filename: 'Joga z hantlami', source: 'youtube', externalId: 'b', intensity: 'low' });
    seedVideo({ id: 'nothing-to-find', filename: 'Sesja 12', source: 'youtube', externalId: 'c' });
    seedVideo({ id: 'local', filename: 'Trening z hantlami.mp4' });
    const untouched = ['partly', 'nothing-to-find', 'local'].map(row);

    await startServer();

    expect(row('untagged')).toEqual({ equipment: '["dumbbells"]', training_type: '[]', body_parts: '[]', intensity: '' });
    expect(['partly', 'nothing-to-find', 'local'].map(row)).toEqual(untouched);

    // The user clears the guess; the next start leaves it cleared.
    db.prepare("UPDATE videos SET equipment = '[]' WHERE id = 'untagged'").run();
    await startServer();
    expect(row('untagged')).toMatchObject({ equipment: '[]' });
  });
});
