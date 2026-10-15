import fs from 'fs';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import db, { FIRST_PROFILE_ID } from '../src/db.js';
import libraryRoutes from '../src/routes/library.js';
import planRoutes from '../src/routes/plan.js';
import scheduleRoutes from '../src/routes/schedule.js';
import profilesRoutes from '../src/routes/profiles.js';
import settingsRoutes from '../src/routes/settings.js';

/** A folder inside this test file's temp directory — never anywhere real. */
export function tempFolder(name: string): string {
  const dir = path.join(path.dirname(process.env.MFP_DATA_DIR!), name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The API route groups mounted the way index.ts mounts them, ready for
 * `inject()`. (index.ts itself starts listening as soon as it's imported.)
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.register(multipart);
  app.register(libraryRoutes, { prefix: '/api/library' });
  app.register(planRoutes, { prefix: '/api/plan' });
  app.register(scheduleRoutes, { prefix: '/api/schedule' });
  app.register(profilesRoutes, { prefix: '/api/profiles' });
  app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.ready();
  return app;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Requests made as one device: the profile cookie (if any) goes on each. */
export function as(app: FastifyInstance, cookie?: string) {
  const call = (method: Method, url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: cookie ? { cookie } : {} });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, body: object = {}) => call('POST', url, body),
    put: (url: string, body: object = {}) => call('PUT', url, body),
    patch: (url: string, body: object = {}) => call('PATCH', url, body),
    delete: (url: string) => call('DELETE', url),
  };
}

/**
 * Two profiles, each with a signed-in device: the install's first profile
 * (Alice) and a second one added beside it (Bob).
 */
export async function twoProfiles(app: FastifyInstance) {
  const created = await as(app).post('/api/profiles', { name: 'Bob' });
  const bobId = created.json().profile.id as string;
  const select = async (id: string) => {
    const res = await as(app).post(`/api/profiles/${id}/select`);
    const header = res.headers['set-cookie'];
    return String(Array.isArray(header) ? header[0] : header).split(';')[0];
  };
  return {
    aliceId: FIRST_PROFILE_ID,
    bobId,
    alice: as(app, await select(FIRST_PROFILE_ID)),
    bob: as(app, await select(bobId)),
  };
}

/** Put a video row straight into the database, in the given profiles' libraries. */
export function seedVideo(
  video: {
    id: string;
    filename: string;
    source?: string;
    externalId?: string;
    relativePath?: string;
    description?: string | null;
    equipment?: string[];
    trainingType?: string[];
    bodyParts?: string[];
    intensity?: string;
  },
  profileIds: string[] = [FIRST_PROFILE_ID]
) {
  db.prepare(`
    INSERT INTO videos (id, filename, filepath, relative_path, source, external_id, description,
                        equipment, training_type, body_parts, intensity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    video.id, video.filename, video.source && video.source !== 'local' ? '' : `/nowhere/${video.filename}`,
    video.relativePath ?? video.filename, video.source ?? 'local', video.externalId ?? null,
    video.description === undefined ? '' : video.description,
    JSON.stringify(video.equipment ?? []), JSON.stringify(video.trainingType ?? []),
    JSON.stringify(video.bodyParts ?? []), video.intensity ?? ''
  );
  for (const profileId of profileIds) {
    db.prepare('INSERT INTO profile_videos (profile_id, video_id, relative_path) VALUES (?, ?, ?)')
      .run(profileId, video.id, video.relativePath ?? video.filename);
  }
}

/** Every row of every table, to prove a request changed nothing at all. */
export function snapshotDatabase(): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}
