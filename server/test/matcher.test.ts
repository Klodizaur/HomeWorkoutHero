import { describe, expect, it } from 'vitest';
import db from '../src/db.js';
import { extractKeywords, matchVideo, rematchPlanWorkouts } from '../src/matcher.js';
import { seedVideo } from './helpers.js';

const videos = (...filenames: string[]) => filenames.map((filename, i) => ({ id: `v${i}`, filename }));

describe('extractKeywords', () => {
  it('lowercases, splits on punctuation and drops stopwords', () => {
    expect(extractKeywords('Rozgrzewka – 10 min, Całe Ciało!')).toEqual(['rozgrzewka', '10', 'całe', 'ciało']);
    expect(extractKeywords('Trening.mp4')).toEqual([]);
  });
});

describe('matchVideo', () => {
  it('picks the video sharing the most words', () => {
    const library = videos('Pilates nogi.mp4', 'Pilates brzuch.mp4', 'Joga.mp4');
    expect(matchVideo('Pilates brzuch 20 min', library)).toBe('v1');
  });

  it('avoids a warm-up or cool-down the name did not ask for', () => {
    const library = videos('Rozgrzewka brzuch pilates.mp4', 'Brzuch pilates.mp4');
    expect(matchVideo('Brzuch pilates', library)).toBe('v1');
    expect(matchVideo('Rozgrzewka brzuch pilates', library)).toBe('v0');
  });

  it('ignores numbers in the filename when scoring', () => {
    const library = videos('Pilates mocny.mp4', 'Pilates 2024.mp4');
    expect(matchVideo('Pilates', library)).toBe('v1');
  });

  it('returns null when nothing matches', () => {
    expect(matchVideo('Joga', videos('Pilates.mp4'))).toBeNull();
    expect(matchVideo('Trening min', videos('Trening min.mp4'))).toBeNull();
    expect(matchVideo('Joga', [])).toBeNull();
  });
});

describe('rematchPlanWorkouts', () => {
  it("binds only to videos in the plan owner's own library", () => {
    db.prepare("INSERT INTO profiles (id, name, setup_done) VALUES ('other', 'Other', 1)").run();
    seedVideo({ id: 'mine', filename: 'Joga poranna.mp4' });
    seedVideo({ id: 'theirs', filename: 'Pilates brzuch.mp4' }, ['other']);
    db.prepare("INSERT INTO workout_plans (id, profile_id, name) VALUES ('plan', 'p1', 'Plan')").run();
    db.prepare(`INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES
      ('w1', 'plan', 'Joga poranna', 0, '[]'),
      ('w2', 'plan', 'Pilates brzuch', 1, '[]')`).run();

    rematchPlanWorkouts('plan');

    const ids = db.prepare('SELECT id, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order').all('plan');
    expect(ids).toEqual([
      { id: 'w1', video_ids: '["mine"]' },
      { id: 'w2', video_ids: '[]' },
    ]);
  });
});
