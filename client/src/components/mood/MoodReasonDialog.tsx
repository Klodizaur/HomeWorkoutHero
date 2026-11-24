/**
 * Asked only after a low (or dropped) after-workout mood, and only once: what
 * made it rough? Picking a reason saves it with the workout and shows a tip or
 * two for next time, worked out from the workout's own tags and the log.
 * Skipping is always fine.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Lightbulb } from 'lucide-react';
import Modal, { CloseButton } from '../modal/Modal';
import { useMetaLabels } from '../../lib/labels';
import { MOOD_REASONS, MoodEntry, MoodReason, MoodWorkout, moodHints } from '../../lib/moodInsights';
import { inLibrary, Video } from '../../types/video';
import '../../styles/mood.css';

const SHORTER_SUGGESTIONS = 3;

export default function MoodReasonDialog({ workout, history, onSave, onClose }: {
  workout: MoodWorkout;
  /** The whole log, to point at what has felt good before. */
  history: MoodEntry[];
  /** Saves the reason; false when it couldn't be saved. */
  onSave: (reason: MoodReason) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const navigate = useNavigate();
  const [reason, setReason] = useState<MoodReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shorter, setShorter] = useState<Video[]>([]);

  const hints = useMemo(() => (reason ? moodHints(reason, workout, history) : []), [reason, workout, history]);

  // "Too long": real videos from the library, like this one but shorter.
  useEffect(() => {
    if (reason !== 'too_long' || workout.durationSeconds < 10 * 60) return;
    let cancelled = false;
    const limit = workout.durationSeconds * 0.75;
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((videos: Video[]) => {
        if (cancelled) return;
        const fits = (v: Video) => {
          const d = v.duration_seconds || 0;
          if (!inLibrary(v) || d < 5 * 60 || d > limit) return false;
          if (workout.trainingType.length === 0) return true;
          return (v.training_type || []).some(tt => workout.trainingType.includes(tt));
        };
        // Closest to the length just done first: shorter, but still a workout.
        setShorter(videos.filter(fits).sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0)).slice(0, SHORTER_SUGGESTIONS));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [reason, workout]);

  const pick = async (next: MoodReason) => {
    setBusy(true);
    setFailed(false);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) setReason(next);
    else setFailed(true);
  };

  const hintText = (key: string, values?: Record<string, string | number>) =>
    t(`mood_reason.hint_${key}`, key === 'best_type' && values ? { ...values, type: labels.trainingType(String(values.type)) } : values);

  return (
    <Modal width={480} onClose={onClose} busy={busy} label={t('mood_reason.title')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title">{reason ? t('mood_reason.next_time') : t('mood_reason.title')}</h2>
          {!reason && <p className="md-text">{t('mood_reason.subtitle')}</p>}
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </div>

      <div className="md-body">
        {!reason ? (
          <div className="mood-reasons">
            {MOOD_REASONS.map(r => (
              <button key={r} type="button" className="mood-reason" disabled={busy} onClick={() => pick(r)}>
                {t(`mood_reason.${r}`)}
              </button>
            ))}
            {failed && <p className="mood-reason-error">{t('mood_reason.failed')}</p>}
          </div>
        ) : (
          <>
            <p className="mood-reason-picked">{t(`mood_reason.${reason}`)}</p>
            <ul className="mood-hints">
              {hints.map(h => (
                <li key={h.key}><Lightbulb size={16} /><span>{hintText(h.key, h.values)}</span></li>
              ))}
            </ul>
            {shorter.length > 0 && (
              <div className="mood-shorter">
                <div className="mood-shorter-label">{t('mood_reason.try_these')}</div>
                {shorter.map(v => (
                  <button key={v.id} type="button" className="mood-shorter-item" onClick={() => { onClose(); navigate(`/player/${v.id}`); }}>
                    <span className="mood-shorter-name">{v.filename.replace(/\.[^.]+$/, '')}</span>
                    <span className="mood-shorter-len">{t('mood_reason.minutes', { count: Math.round((v.duration_seconds || 0) / 60) })}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="md-foot">
        {reason ? (
          <>
            <button type="button" className="md-btn" onClick={() => setReason(null)}>{t('mood_reason.change')}</button>
            <button type="button" className="md-btn md-btn--primary" onClick={onClose}>{t('mood_reason.done')}</button>
          </>
        ) : (
          <button type="button" className="md-btn" onClick={onClose} disabled={busy}>{t('mood_reason.skip')}</button>
        )}
      </div>
    </Modal>
  );
}
