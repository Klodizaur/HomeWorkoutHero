/**
 * Breakdown's "Workouts and your mood": how often a workout left you feeling
 * better than before, the better / same / worse split, and — once there's
 * enough logged — which kinds of workout and equipment lift your mood most.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useMetaLabels } from '../../lib/labels';
import { MoodEntry, moodSummary } from '../../lib/moodInsights';
import '../../styles/mood.css';

export default function MoodSummaryCard({ entries, rangeLabel }: { entries: MoodEntry[]; rangeLabel: string }) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const s = useMemo(() => moodSummary(entries), [entries]);

  const pct = (n: number) => (s.counted ? (n / s.counted) * 100 : 0);
  const rate = (label: string, better: number, total: number) => t('mood_insights.rate', { label, better, total });

  return (
    <section className="lg-mix mood-sum">
      <div className="lg-mix-head">
        <h2>{t('mood_insights.heading')}</h2>
        <span className="lg-cloud-range">{rangeLabel}</span>
      </div>

      {s.counted === 0 ? (
        <p className="lg-empty">{t('mood_insights.empty')}</p>
      ) : (
        <>
          <p className="mood-sum-head">
            {t('mood_insights.headline_before')}{' '}
            <strong>{t('mood_insights.headline_count', { better: s.better, count: s.counted })}</strong>
          </p>

          <div className="mood-sum-bar" role="img" aria-label={t('mood_insights.split', { better: s.better, same: s.same, worse: s.worse })}>
            {s.better > 0 && <span className="is-better" style={{ width: `${pct(s.better)}%` }} />}
            {s.same > 0 && <span className="is-same" style={{ width: `${pct(s.same)}%` }} />}
            {s.worse > 0 && <span className="is-worse" style={{ width: `${pct(s.worse)}%` }} />}
          </div>
          <div className="mood-sum-legend">
            <span><i className="is-better" />{t('mood_insights.better', { count: s.better })}</span>
            <span><i className="is-same" />{t('mood_insights.same', { count: s.same })}</span>
            <span><i className="is-worse" />{t('mood_insights.worse', { count: s.worse })}</span>
          </div>

          {(s.bestTypes.length > 0 || s.bestEquipment.length > 0) && (
            <dl className="mood-sum-facts">
              {s.bestTypes.length > 0 && (
                <div>
                  <dt>{t('mood_insights.best_types')}</dt>
                  <dd>{s.bestTypes.map(r => rate(labels.trainingType(r.key), r.better, r.total)).join(', ')}</dd>
                </div>
              )}
              {s.bestEquipment.length > 0 && (
                <div>
                  <dt>{t('mood_insights.best_equipment')}</dt>
                  <dd>{s.bestEquipment.map(r => rate(labels.equipment(r.key), r.better, r.total)).join(', ')}</dd>
                </div>
              )}
            </dl>
          )}
          {s.counted > 0 && s.counted < 5 && (
            <p className="mood-sum-note">{t('mood_insights.need_more', { count: 5 - s.counted })}</p>
          )}
        </>
      )}

      {s.reasons.length > 0 && (
        <p className="mood-sum-note">
          {t('mood_insights.reasons', {
            reasons: s.reasons.slice(0, 2).map(r => `${t(`mood_reason.short_${r.reason}`)} (${r.count})`).join(', '),
          })}
        </p>
      )}
    </section>
  );
}
