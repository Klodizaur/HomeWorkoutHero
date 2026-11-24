/**
 * Turn a described goal plus a shortlist of videos into a draft plan.
 *
 * The result is a suggestion, not a saved plan: it goes back to the client in
 * the same shape the manual workout builder already holds in state, the user
 * reviews and edits it there, and the existing save path stores it. Nothing
 * here writes to the database.
 */
import { callModel, AiError } from './provider.js';
import { Candidate, CandidateSet, CandidateFilter, selectCandidates } from './candidates.js';
import { DESCRIPTION_LANGUAGE_NAMES, getAiSettings } from './settings.js';

/** One day of a drafted plan. An empty list is a rest day. */
export interface DraftDay {
  videoIds: string[];
}

export interface DraftWeek {
  days: DraftDay[];
}

export interface DraftPlan {
  /** Short title for the plan, shown in the builder and used on save. */
  name: string;
  summary: string;
  weeks: DraftWeek[];
  /** Ids the model returned that aren't in the library, after validation. */
  droppedIds: string[];
  /** How many library videos were eligible, and whether the list was capped. */
  candidateCount: number;
  truncated: boolean;
  /**
   * Workout days actually filled. Normally equals the number requested, but a
   * thin catalogue can leave the model short — the client says so rather than
   * letting the user find out by counting.
   */
  workoutDayCount: number;
}

export interface GenerateRequest extends CandidateFilter {
  description: string;
  /**
   * How many workout days the finished plan should have.
   *
   * This is the number the user actually gets: empty day slots are dropped when
   * the plan is saved, and the calendar spreads the remaining sessions over the
   * rest pattern from Settings. Asking for a number of *weeks* instead used to
   * make the plan look far longer than it turned out to be, because the rest
   * slots that padded it out never survived the save.
   */
  workoutDays: number;
  daysPerWeek: number;
}

/** The builder models a week as seven day slots; rest days are simply empty. */
const DAYS_PER_WEEK = 7;
const MAX_WEEKS = 12;
const MAX_WORKOUT_DAYS = MAX_WEEKS * DAYS_PER_WEEK;

/**
 * The coaching brief.
 *
 * Left to itself a model will happily schedule high-intensity work seven days
 * running, stack three long sessions into one evening, or open week one with
 * the hardest thing in the library. The rules below are the ordinary
 * programming judgement a trainer would apply — recovery between hard days,
 * short videos as components and long ones as whole sessions, a gradual ramp —
 * stated explicitly because that is the only way it reliably survives into the
 * output.
 *
 * Scope is deliberately narrow: arranging videos the person already owns. It
 * does not assess anyone, and it treats a stated limitation as a hard rule
 * rather than something to reason around.
 */
/**
 * Coaching brief. Language rules are filled in per call from AI settings so
 * name/summary follow the user's preferred language rather than drifting to
 * whatever language dominates the video catalogue.
 */
function buildSystemPrompt(daysPerWeek: number): string {
  return `You are an experienced personal trainer building a home workout plan for one person, using only a fixed catalogue of workout videos they already own.

You arrange the training they have. You do not assess anyone's health, diagnose anything, or work around an injury beyond respecting what the person tells you about it.

CHOOSING VIDEOS
- Only ever use ids that appear in the catalogue. Never invent an id, and never use a title in place of an id.
- Each entry lists its length in minutes and whatever tags exist. Many videos are untagged: infer what you can from the title and length, and never assume an untagged video is easy.
- Some entries also carry a profile after "profile:": impact (joint load: low/medium/high), level, actual work minutes ("work"), whether it includes its own warm-up/cool-down ("+warmup", "+cooldown"), where it fits ("fits"), and a short note. Use it — it is more reliable than guessing from the title. A profile marked "(unsure)" is a guess; weigh it lightly.

BUILDING A DAY
- Build the session by time, never by number of videos. Session length is the sum of the listed minutes. Get close to the requested length: within about 5 minutes for sessions under 30 minutes, within about 10 for longer ones.
- Main work is what the session is for. Warm-ups, cool-downs and stretching blocks are support. A profile's "work" minutes is the real training inside a video; use it when judging how much main work a day has. On every day that is not deliberately easy, at least two-thirds of the minutes must be main work in the requested style.
- Every session whose main work is strength, HIIT, pilates or hard cardio starts with a warm-up, whatever its length or intensity — nobody should go straight into exercises cold, beginners least of all. Use a warm-up video, or a short gentle mobility video when there is none.
- No separate warm-up for sessions whose main work is dance or walking cardio (they start gently by design), or that are entirely stretching, mobility, yoga or relaxation. Be consistent: within one plan, treat the same kind of session the same way.
- Size the support to the session, never the other way round:
  - Under 25 minutes: one short warm-up (about 5–8 minutes), then main work. No separate cool-down. A 6-minute warm-up plus two 7-minute blocks is a good 20-minute session; three blocks with no warm-up is not.
  - 25 to 40 minutes: one short warm-up, and a short cool-down only if it fits; together no more than about a quarter of the session.
  - Over 40 minutes: a warm-up and a cool-down are normal.
  - A video marked "+warmup" or "+cooldown" already has one. Do not add another next to it.
- Short videos (roughly under 15 minutes) are components, not sessions. Stack as many main-work blocks as the time budget needs. A warm-up, six six-minute blocks and a stretch is a perfectly normal 45-minute session; do not stop at two or three videos and leave the session half the length that was asked for.
- Order a multi-video day properly: any warm-up first, the main work in the middle, any stretch or cool-down last. Never open with hard work and never end on it.
- A video tagged "Finisher" is a short, hard burnout block: it goes at the end of the main work, right before any cool-down — never first, and at most one per day.
- If the catalogue has nothing tagged as a warm-up or cool-down, use the shortest and gentlest videos available for those slots — never substitute hard work into them. A cool-down may be left out; a warm-up may not.
- A long video (roughly 30 minutes or more) is a complete session on its own — it almost always contains its own warm-up and cool-down. Never put two long videos on the same day, and do not bolt extra work onto one. After a hard long session you may add a short stretch or cool-down, nothing more.

FOCUS
- When focus areas are given, make them the main emphasis of about three in every four sessions. The rest may be supporting or easy days. Do not fill a session's main work with other body parts.
- When styles are given, the main work of every session that is not deliberately easy must be in those styles.
- The person's own words outrank the style picks. If they name a specific kind of workout — dance, walking, pilates, yoga, boxing — every session's main work is that kind, judged from titles, tags and profiles. Repeat a fitting video rather than swap in a different kind of workout; only fall back to something else when the catalogue has nothing of that kind left to use.
- When high intensity is asked for, most sessions' main work should be high intensity. Recovery between hard sessions still applies, but space them with moderate sessions in the requested styles, not with easy ones.

BUILDING THE SEQUENCE
- Return one flat list of training days, in the order the person will do them. The first entry is their first workout, the second is the next time they train, and so on.
- NEVER return a rest day, an empty day, a "recovery" entry with no videos, or any placeholder. Every entry must contain at least one video.
- This matters more than it looks: the app adds rest itself, from the person's own schedule, and it DISCARDS any entry you send with no videos. An empty entry does not become a rest day — it disappears, and the plan ends up shorter than the person asked for. Do not think in weeks with rest days in them; think only in training sessions.
- Because rest is inserted afterwards, consecutive entries are NOT consecutive calendar days. Read each entry as "the next time this person trains".
- Hard work still needs recovery. Do not put two high-intensity sessions (HIIT, hard cardio, heavy strength) back to back in the list, and keep them to two or three in any run of ${daysPerWeek} entries. The sessions between them should be moderate, not empty of effort — only the one deliberately easy session per run below is truly easy.
- Do not train the same body part hard on back-to-back entries. Alternate the emphasis.
- Use the breadth of the catalogue. Avoid repeating a video within any run of ${daysPerWeek} entries unless the catalogue is too small to avoid it, and never repeat the same set of videos as a whole session. Warm-up and cool-down videos may repeat freely.
- In any run of ${daysPerWeek} entries, make at least one deliberately easy. Keep it in the requested kind of workout at a gentler level where the catalogue allows (an easy dance video for a dance plan, a gentle pilates session for a pilates plan); otherwise use mobility or stretching.

PROGRESSION
- If the person describes a progression (session lengths, levels, a ramp), follow it exactly.
- Otherwise, build gradually even if they did not ask: open with easier or beginner/all-level videos and less main work, and finish noticeably more demanding — more main-work minutes, harder or higher-level videos — than you started. In a plan of six or more sessions, the last third should clearly be harder than the first third.
- Skip the ramp only for plans that are meant to stay gentle: recovery, period, stretching or "easy week" requests.
- Increase volume or intensity a little at a time, and not both at once.
- Over a long plan, make roughly every fourth run of ${daysPerWeek} entries lighter to allow recovery.

CONSTRAINTS
- Equipment, album and length limits are already applied — everything in the catalogue is allowed.
- Style, body-part and intensity notes are preferences: follow them where the catalogue allows, use judgement where it does not.
- Anything the person states as a limitation — no jumping, quiet for neighbours, a sore knee, period-friendly — is a hard rule. If the catalogue cannot honour it, leave that day lighter or empty rather than breaking it.

LANGUAGE
- ${planLanguageRule()}

NAMING
- Give the plan a short, specific title (roughly 2–6 words) that reflects the goal or focus — not a generic label like "Workout Plan" or "AI Plan".

Reply with JSON only, no prose and no code fences, in exactly this shape:
{"name":"short plan title","summary":"one or two sentences on the structure you chose","days":[{"videoIds":["id1","id2"]},{"videoIds":["id3"]}]}

Every entry in "days" must have at least one id. Do not emit an entry with an empty "videoIds".`;
}

/** Which language the model must use for name and summary. */
function planLanguageRule(): string {
  const target = getAiSettings().descriptionLanguage;
  if (target) {
    return (
      `Write the "name" and "summary" fields in ${DESCRIPTION_LANGUAGE_NAMES[target]}. ` +
      'Do not use any other language for those fields, even if the catalogue titles ' +
      'or the person\'s description are written differently.'
    );
  }
  return (
    'Write the "name" and "summary" fields in the same language the person used in ' +
    'their description. If they wrote nothing, use English. Catalogue video titles ' +
    'may be in another language — that must not change the language of name and summary.'
  );
}

export async function generatePlan(request: GenerateRequest): Promise<DraftPlan> {
  const workoutDays = clamp(Math.round(request.workoutDays) || 1, 1, MAX_WORKOUT_DAYS);
  const daysPerWeek = clamp(Math.round(request.daysPerWeek) || 3, 1, DAYS_PER_WEEK);

  const candidateSet = selectCandidates(request);
  if (candidateSet.candidates.length === 0) {
    throw new AiError(
      'No videos in your library match those constraints. Try allowing more equipment, more albums, or a longer session.',
      'no_candidates'
    );
  }

  const raw = await callModel({
    system: buildSystemPrompt(daysPerWeek),
    user: buildUserPrompt(request, workoutDays, daysPerWeek, candidateSet),
  });

  const parsed = parseJsonReply(raw);
  const known = new Set(candidateSet.candidates.map(c => c.id));
  const { days, droppedIds } = validateDays(parsed, workoutDays, known);
  const draftWeeks = packIntoWeeks(days);
  const workoutDayCount = days.length;

  if (workoutDayCount === 0) {
    throw new AiError(
      'The model did not pick any videos from your library. Try again, or check that the model name is right.',
      'empty_plan'
    );
  }

  return {
    name: sanitizePlanName(parsed?.name),
    summary: typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 500) : '',
    weeks: draftWeeks,
    droppedIds,
    candidateCount: candidateSet.candidates.length,
    truncated: candidateSet.truncated,
    workoutDayCount,
  };
}

/**
 * Pack the training days into the week grid the builder renders on.
 *
 * Purely presentational: the builder lays a plan out in rows of seven, and the
 * save path renumbers whatever is non-empty, so packing consecutively preserves
 * the order the model chose. A row of seven here is "the next seven sessions",
 * not a calendar week — the calendar's rest days are applied later, from the
 * user's own schedule pattern.
 */
function packIntoWeeks(days: DraftDay[]): DraftWeek[] {
  const emptyWeek = (): DraftWeek => ({
    days: Array.from({ length: DAYS_PER_WEEK }, () => ({ videoIds: [] as string[] })),
  });
  if (days.length === 0) return [emptyWeek()];

  const weeks: DraftWeek[] = [];
  for (let start = 0; start < days.length; start += DAYS_PER_WEEK) {
    const week = emptyWeek();
    days.slice(start, start + DAYS_PER_WEEK).forEach((day, index) => {
      week.days[index] = day;
    });
    weeks.push(week);
  }
  return weeks;
}

function buildUserPrompt(
  request: GenerateRequest,
  workoutDays: number,
  daysPerWeek: number,
  candidateSet: CandidateSet
): string {
  const lines: string[] = [];

  lines.push(
    `Plan length: exactly ${workoutDays} training day(s). Return exactly ` +
    `${workoutDays} entries in "days", every single one holding at least one ` +
    `video. Do not add rest days, empty entries or spacers of any kind — the ` +
    `app inserts rest itself and throws away anything empty, which would leave ` +
    `this person with fewer sessions than they asked for.`
  );
  lines.push(
    `For pacing only: this person trains about ${daysPerWeek} time(s) a week ` +
    `(from their workout schedule pattern), so assume roughly that rhythm when ` +
    `you space hard sessions out and build the plan up. Do not turn it into ` +
    `weeks in the output — the output is one flat list.`
  );
  if (request.maxMinutes > 0) {
    // Worth stating: the catalogue was already filtered to fit, so the model
    // should be budgeting a day's total rather than re-checking each video.
    lines.push(
      `Target session length: about ${request.maxMinutes} minutes per training day. ` +
      'Some videos run up to about 10 minutes over it; such a video is the whole ' +
      'day on its own, with nothing added. Otherwise reach the target by stacking ' +
      'as many short videos as it takes, or let one long video stand alone. Getting close to the target matters more than keeping the ' +
      'number of videos low. Size the warm-up and cool-down to this length as ' +
      'the rules describe.'
    );
  }
  if (request.intensity) lines.push(`Preferred intensity: ${request.intensity}.`);
  if (request.level) lines.push(`Their level: ${request.level}. Prefer videos for that level or all levels; use harder ones only as the plan builds up, and never open with them.`);
  if (request.trainingTypes.length) lines.push(`Preferred styles: ${request.trainingTypes.join(', ')}.`);
  if (request.bodyParts.length) lines.push(`Focus areas: ${request.bodyParts.join(', ')}.`);
  if (request.equipment.length) lines.push(`Equipment available: ${request.equipment.join(', ')}.`);
  else lines.push('Equipment available: not specified.');

  const description = request.description.trim();
  if (description) {
    lines.push('', 'In the user\'s own words:', description.slice(0, 2000));
  }

  lines.push('', `Catalogue (${candidateSet.candidates.length} videos):`);
  for (const candidate of candidateSet.candidates) {
    lines.push(formatCandidate(candidate));
  }

  lines.push(
    '',
    `Build the plan now. Return exactly ${workoutDays} entries in "days", in the ` +
    `order they will be done, each with at least one video id and no empty entries.`
  );
  return lines.join('\n');
}

function formatCandidate(candidate: Candidate): string {
  const facts: string[] = [];
  if (candidate.minutes) facts.push(`${candidate.minutes}min`);
  if (candidate.intensity) facts.push(candidate.intensity);
  if (candidate.level) facts.push(candidate.level === 'all' ? 'all levels' : candidate.level);
  if (candidate.types.length) facts.push(candidate.types.join('/'));
  if (candidate.parts.length) facts.push(candidate.parts.join('/'));
  if (candidate.equipment.length) facts.push(`needs ${candidate.equipment.join('+')}`);
  const suffix = facts.length ? ` [${facts.join(' | ')}]` : '';
  return `${candidate.id} :: ${candidate.title}${suffix}${formatProfile(candidate)}`;
}

/** The profile, compacted to one bracket: this is per-token on every candidate. */
function formatProfile(candidate: Candidate): string {
  const profile = candidate.profile;
  if (!profile) return '';
  const facts: string[] = [];
  if (profile.impact) facts.push(`${profile.impact} impact`);
  if (profile.workMinutes && profile.workMinutes !== candidate.minutes) facts.push(`work ${profile.workMinutes}min`);
  if (profile.warmup) facts.push('+warmup');
  if (profile.cooldown) facts.push('+cooldown');
  if (profile.goodFor.length) facts.push(`fits: ${profile.goodFor.join(', ')}`);
  if (profile.notes) facts.push(profile.notes);
  if (facts.length === 0) return '';
  const unsure = profile.confidence === 'low' ? ' (unsure)' : '';
  return ` profile${unsure}: ${facts.join('; ')}`;
}

/**
 * Pull the JSON object out of a reply.
 *
 * Models are asked for bare JSON but frequently wrap it in a code fence or add
 * a sentence of preamble, and that is not worth failing the whole request over.
 */
function parseJsonReply(raw: string): any {
  const withoutFence = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  const slice = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    return JSON.parse(slice);
  } catch {
    throw new AiError('The model did not return a usable plan. Try generating again.', 'unparsable');
  }
}

/**
 * Coerce whatever came back into a list of training days, keeping only ids that
 * exist in the catalogue.
 *
 * Two things are dropped on the way through, and both matter:
 *
 * Unrecognised ids are dropped and reported rather than passed on — a phantom
 * id renders as a nameless row in the builder and then vanishes on save, so the
 * plan the user reviewed would not be the plan they saved.
 *
 * Empty days are dropped outright. The model is told not to emit them, but if
 * one slips through it must not survive: the save path discards empty days, so
 * keeping one here would quietly shorten the plan below the number the user
 * asked for — the exact failure this flat-list shape exists to prevent.
 */
function validateDays(
  parsed: any,
  workoutDays: number,
  known: Set<string>
): { days: DraftDay[]; droppedIds: string[] } {
  // The flat list is the shape we ask for. A model that falls back to the older
  // nested "weeks" shape is flattened rather than failed — its rest slots are
  // empty days, which the empty-day rule below removes anyway.
  const rawDays: unknown[] = Array.isArray(parsed?.days)
    ? parsed.days
    : Array.isArray(parsed?.weeks)
      ? parsed.weeks.flatMap((week: any) => (Array.isArray(week?.days) ? week.days : []))
      : [];

  const dropped = new Set<string>();
  const days: DraftDay[] = [];

  for (const raw of rawDays) {
    // Overshooting is capped here: the count the user picked is the count they get.
    if (days.length >= workoutDays) break;

    const rawIds = (raw as any)?.videoIds;
    const seen = new Set<string>();
    const videoIds: string[] = [];

    if (Array.isArray(rawIds)) {
      for (const value of rawIds) {
        if (typeof value !== 'string') continue;
        let id = value.trim();
        if (!id) continue;
        if (!known.has(id)) {
          // Models sometimes copy an id with a character missing or changed.
          const recovered = nearestId(id, known);
          if (!recovered) {
            dropped.add(id);
            continue;
          }
          id = recovered;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        videoIds.push(id);
      }
    }

    if (videoIds.length === 0) continue;
    days.push({ videoIds });
  }

  return { days, droppedIds: Array.from(dropped) };
}

/**
 * The one catalogue id within two edits of `id`, or null when there is none or
 * more than one. Ids are 21 random characters, so a near miss can only mean
 * that video; a tie is left alone rather than guessed.
 */
function nearestId(id: string, known: Set<string>): string | null {
  if (id.length < 10) return null;
  let match: string | null = null;
  for (const candidate of known) {
    if (Math.abs(candidate.length - id.length) > 2) continue;
    if (editDistance(id, candidate) <= 2) {
      if (match) return null;
      match = candidate;
    }
  }
  return match;
}

/** Levenshtein distance. Ids are short and the catalogue is capped, so plain is fine. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** Keep a model-suggested title short and safe to drop into the builder field. */
function sanitizePlanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.slice(0, 80);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
