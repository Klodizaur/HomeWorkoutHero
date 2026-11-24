/**
 * A text day: a workout day with a note and no videos. Either a placeholder
 * (videos still to come) or an activity of its own (swimming). Shown like a rest day — an icon and text, nothing to
 * play — but it still counts as a workout, so it can be marked done.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Check, StickyNote } from 'lucide-react';

/** 'activity': a workout of its own (swimming). 'placeholder': videos still to come. */
export type NoteKind = 'placeholder' | 'activity';

/** The icon for a text day of this kind. */
export const NoteIcon = ({ kind, size }: { kind?: NoteKind | null; size: number }) =>
  kind === 'activity' ? <Activity size={size} /> : <StickyNote size={size} />;

/** Marks a placeholder day done, or undoes it. Resolves once saved. */
export async function togglePlaceholderDone(workoutId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/schedule/toggle-done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workoutId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The compact version for calendar cells: icon over the note, a tick when done. */
export function NoteBlock({ text, done, className, size = 20, minutes, kind }: { text: string; done: boolean; className: string; size?: number; minutes?: number | null; kind?: NoteKind | null }) {
  const { t } = useTranslation();
  return (
    <div className={`${className} is-note`}>
      {done ? <Check size={size} /> : <NoteIcon kind={kind} size={size} />}
      <span className="cal-note-text">{text}</span>
      {minutes ? <span className="cal-note-min">{t('calendar.note_minutes', { count: minutes })}</span> : null}
    </div>
  );
}

/** The full version for the day sheet, the tape and Today: note, status and a done toggle. */
export function NoteEntry({ text, done, onToggle, iconSize = 20, minutes, kind }: {
  text: string;
  done: boolean;
  /** The planned length, when the plan gave one. */
  minutes?: number | null;
  kind?: NoteKind | null;
  /** Absent where marking isn't offered. */
  onToggle?: () => Promise<unknown> | void;
  iconSize?: number;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="cal-sd-rest cal-note">
      <div className={`cal-rest-icon is-note${done ? ' is-done' : ''}`}>
        {done ? <Check size={iconSize} /> : <NoteIcon kind={kind} size={iconSize} />}
      </div>
      <div className="cal-rest-text">
        <div className="cal-rest-title">{text}</div>
        <div className="cal-rest-note">
          {done ? t('calendar.note_done') : t(kind === 'activity' ? 'calendar.activity_day' : 'calendar.note_day')}
          {minutes ? <> · {t('calendar.note_minutes', { count: minutes })}</> : null}
        </div>
      </div>
      {onToggle && (
        <button
          type="button"
          className="cal-ghost-btn"
          disabled={busy}
          onClick={async e => {
            e.stopPropagation();
            setBusy(true);
            try { await onToggle(); } finally { setBusy(false); }
          }}
        >
          {done ? t('calendar.note_undo') : t('calendar.note_mark_done')}
        </button>
      )}
    </div>
  );
}
