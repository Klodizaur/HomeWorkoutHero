/**
 * Pick a plan for the empty Extra slot without scrolling the whole page:
 * favourites and the newest plans up front, or type to find any plan.
 * Picking one hands over to the usual start sheet (slot and start date).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Heart, Search } from 'lucide-react';
import Modal, { CloseButton } from '../modal/Modal';
import '../../styles/plans.css';

export interface QuickPlan {
  id: string;
  name: string;
  cover: string | null;
  blur: boolean;
  workoutCount: number;
  favorite: boolean;
  /** When it was added, for "Recently added". */
  addedAt: string;
}

const SECTION_SIZE = 6;

export default function QuickPlanPicker({ plans, onPick, onClose }: {
  plans: QuickPlan[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (needle) {
      return [{ key: 'results', title: t('plans.quick_results'), items: plans.filter(p => p.name.toLowerCase().includes(needle)) }];
    }
    const favorites = plans.filter(p => p.favorite).slice(0, SECTION_SIZE);
    const recent = [...plans]
      .filter(p => !p.favorite)
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''))
      .slice(0, SECTION_SIZE);
    return [
      { key: 'fav', title: t('plans.favorites'), items: favorites },
      { key: 'recent', title: t('plans.quick_recent'), items: recent },
    ].filter(s => s.items.length > 0);
  }, [plans, needle, t]);

  return (
    <Modal width={520} onClose={onClose} label={t('plans.quick_title')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title">{t('plans.quick_title')}</h2>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="md-body pl-quick">
        <label className="pl-search">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('plans.search_placeholder')}
            aria-label={t('plans.search_placeholder')}
          />
        </label>
        {sections.length === 0 && <p className="pl-quick-none">{t('plans.no_match')}</p>}
        {sections.map(section => (
          <section key={section.key} className="pl-quick-section">
            <h3>{section.title}</h3>
            <div className="pl-quick-list">
              {section.items.map(p => (
                <button key={p.id} type="button" className="pl-quick-item" onClick={() => onPick(p.id)}>
                  <span className={`pl-quick-thumb${p.cover ? '' : ' is-empty'}`}>
                    <img src={p.cover || '/logo.png'} alt="" className={p.cover && p.blur ? 'is-blurred' : undefined} />
                  </span>
                  <span className="pl-quick-text">
                    <span className="pl-quick-name">{p.name}</span>
                    <span className="pl-quick-meta">{t('plans.workout_count', { count: p.workoutCount })}</span>
                  </span>
                  {p.favorite && <Heart size={15} className="pl-quick-heart" aria-hidden />}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
