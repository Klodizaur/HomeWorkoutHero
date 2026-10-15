import { FastifyInstance } from 'fastify';
import db from '../db.js';
import { getProfileSetting, isProfileSetting, requireProfile, setProfileSetting } from '../profiles.js';

/**
 * Generic settings, under /api/settings. Moved out of index.ts unchanged so the
 * test suite can load them without starting the server.
 */
export default async function (fastify: FastifyInstance) {
  // Generic settings: the shared ones, with the profile's own values on top
  // (rhythm, theme, calendar view, library folder, exclusions).
  fastify.get('/', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const settings = db.prepare('SELECT * FROM settings').all();
    const parse = (key: string, value: string | null) =>
      (key === 'workout_pattern' || key === 'exclude_paths') ? JSON.parse(value || '[]') : value;
    const settingsObj = settings.reduce((acc: Record<string, unknown>, curr: any) => {
      // `ai_*` rows hold the optional AI integration's config, including an API
      // key. They are served by /api/ai/settings, which never returns the key —
      // this endpoint must not leak it through the generic dump. Same for the
      // secret profile cookies are signed with.
      if (curr.key.startsWith('ai_') || curr.key === 'profile_secret') return acc;
      acc[curr.key] = parse(curr.key, isProfileSetting(curr.key) ? getProfileSetting(profileId, curr.key) : curr.value);
      return acc;
    }, {} as Record<string, unknown>);
    // Whether this profile closed the dashboard's guide banner. Kept per profile
    // so everyone in the house sees it once, on every device.
    settingsObj.guide_dismissed = getProfileSetting(profileId, 'guide_dismissed') === '1';
    return reply.send(settingsObj);
  });

  fastify.post('/', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const body = request.body as any;

    if (body.workout_pattern !== undefined) {
      setProfileSetting(profileId, 'workout_pattern', JSON.stringify(body.workout_pattern));
    }
    if (body.start_date !== undefined) {
      setProfileSetting(profileId, 'start_date', body.start_date);
    }
    if (body.exclude_paths !== undefined) {
      setProfileSetting(profileId, 'exclude_paths', JSON.stringify(body.exclude_paths));
    }
    if (body.theme !== undefined) {
      setProfileSetting(profileId, 'theme', body.theme);
    }
    if (body.calendar_view !== undefined) {
      setProfileSetting(profileId, 'calendar_view', body.calendar_view);
    }
    if (body.guide_dismissed !== undefined) {
      setProfileSetting(profileId, 'guide_dismissed', body.guide_dismissed ? '1' : '0');
    }
    return reply.send({ success: true });
  });
}
