import { useTranslation } from 'react-i18next';
import '../../styles/mood.css';

/** How the user felt, 1 (awful) to 5 (great). Null when they didn't say. */
export type Mood = 1 | 2 | 3 | 4 | 5;
export const MOODS: Mood[] = [1, 2, 3, 4, 5];

// The mouth for each level, from a deep frown to a wide smile, in a 24×24 box.
const MOUTHS: Record<Mood, string> = {
  1: 'M8 17 Q12 12.5 16 17',
  2: 'M8.5 16.2 Q12 14 15.5 16.2',
  3: 'M8.5 15.5 L15.5 15.5',
  4: 'M8.5 14.5 Q12 17.5 15.5 14.5',
  5: 'M7.5 13.5 Q12 19.5 16.5 13.5 Z',
};

/** A line-drawn face in the current text colour. */
export function MoodFace({ level, size = 20, className }: { level: Mood; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="9" cy="9.8" r="0.6" fill="currentColor" strokeWidth={1.4} />
      <circle cx="15" cy="9.8" r="0.6" fill="currentColor" strokeWidth={1.4} />
      <path d={MOUTHS[level]} fill={level === 5 ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function useMoodLabel() {
  const { t } = useTranslation();
  return (level: Mood) => t(`mood.level_${level}`);
}

export function asMood(value: unknown): Mood | null {
  return typeof value === 'number' && value >= 1 && value <= 5 ? (value as Mood) : null;
}

/**
 * Five faces in a row; one tap picks, tapping the picked one again clears it.
 * Nothing here is required — leaving it alone is always fine.
 */
export function MoodPicker({
  value, onChange, label, size = 'md', disabled,
}: {
  value: Mood | null;
  onChange: (mood: Mood | null) => void;
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
}) {
  const moodLabel = useMoodLabel();
  return (
    <div className={`mood-picker mood-picker--${size}`} role="radiogroup" aria-label={label}>
      {MOODS.map(level => {
        const on = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={moodLabel(level)}
            title={moodLabel(level)}
            className={`mood-face mood-face--${level}${on ? ' is-on' : ''}`}
            disabled={disabled}
            onClick={() => onChange(on ? null : level)}
          >
            <MoodFace level={level} size={size === 'sm' ? 20 : 24} />
          </button>
        );
      })}
    </div>
  );
}

/** How the user felt after a workout, as one small face (the Log calendar). */
export function MoodBadge({ mood, size = 16, className = '' }: { mood: Mood; size?: number; className?: string }) {
  const { t } = useTranslation();
  const moodLabel = useMoodLabel();
  const label = t('mood.summary', { mood: moodLabel(mood) });
  return (
    <span className={`mood-badge ${className}`} role="img" aria-label={label} title={label}>
      <MoodFace level={mood} size={size} />
    </span>
  );
}
