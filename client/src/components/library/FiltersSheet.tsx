import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { INTENSITIES, LEVELS, trainingTypeGroup, TRAINING_TYPE_GROUPS } from '../../lib/metadata';
import { useTagCatalog } from '../../lib/tagCatalog';
import { useMetaLabels } from '../../lib/labels';
import { LengthRange, MatchMode } from '../../lib/filters';
import LengthFilter from './LengthFilter';
import { TagCategory } from '../../lib/videoTags';

interface Props {
  open: boolean;
  onClose: () => void;
  equipment: string[];
  onEquipment: (next: string[]) => void;
  trainingType: string[];
  onTrainingType: (next: string[]) => void;
  bodyParts: string[];
  onBodyParts: (next: string[]) => void;
  intensity: string[];
  onIntensity: (next: string[]) => void;
  /** Levels to keep. Optional so screens without the filter still work. */
  level?: string[];
  onLevel?: (next: string[]) => void;
  length: LengthRange;
  onLength: (next: LengthRange) => void;
  matchMode: MatchMode;
  onMatchMode: (mode: MatchMode) => void;
  onClearAll: () => void;
  /** How many videos the current filters leave, shown on the confirm button. */
  resultCount: number;
}

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter(v => v !== value) : [...list, value];

/**
 * The filters panel: a bottom sheet on mobile, a right-hand panel on desktop.
 *
 * Its chips are the *selectable* kind — same uppercase wording as the read-only
 * tags, but taller, and when picked they invert to a solid fill with a check.
 * Keeping the two visibly different is what stops a card's tags looking like
 * something you can click.
 */
export default function FiltersSheet(props: Props) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const catalog = useTagCatalog();
  if (!props.open) return null;

  const groups: {
    key: string;
    label: string;
    category: TagCategory;
    items: { value: string; label: string }[];
    selected: string[];
    onToggle: (value: string) => void;
    hasMatch?: boolean;
  }[] = [
    {
      key: 'equipment',
      label: labels.sections.equipment,
      category: 'gear',
      items: catalog.equipment.map(id => ({ value: id, label: labels.equipment(id) })),
      selected: props.equipment,
      onToggle: v => props.onEquipment(toggle(props.equipment, v)),
      hasMatch: true,
    },
    {
      key: 'type',
      label: labels.sections.trainingType,
      category: 'type',
      // Grouped the same way as everywhere they're picked: workout type,
      // session part, then who it suits.
      items: (Object.keys(TRAINING_TYPE_GROUPS) as (keyof typeof TRAINING_TYPE_GROUPS)[])
        .flatMap(group => catalog.trainingTypes.filter(v => trainingTypeGroup(v) === group))
        .map(v => ({ value: v, label: labels.trainingType(v) })),
      selected: props.trainingType,
      onToggle: v => props.onTrainingType(toggle(props.trainingType, v)),
    },
    {
      key: 'body',
      label: labels.sections.bodyParts,
      category: 'body',
      items: catalog.bodyParts.map(v => ({ value: v, label: labels.bodyPart(v) })),
      selected: props.bodyParts,
      onToggle: v => props.onBodyParts(toggle(props.bodyParts, v)),
    },
    {
      key: 'intensity',
      label: labels.sections.intensity,
      category: 'intensity',
      items: [...INTENSITIES].map(v => ({ value: v, label: labels.intensity(v) })),
      selected: props.intensity,
      onToggle: v => props.onIntensity(toggle(props.intensity, v)),
    },
    ...(props.level && props.onLevel ? [{
      key: 'level',
      label: labels.sections.level,
      category: 'intensity' as TagCategory,
      items: [...LEVELS].map(v => ({ value: v, label: labels.level(v) })),
      selected: props.level,
      onToggle: (v: string) => props.onLevel!(toggle(props.level!, v)),
    }] : []),
  ];

  return createPortal(
    <>
      <div className="lib-sheet-backdrop" onClick={props.onClose} />
      <div className="lib-sheet" role="dialog" aria-label={t('library.filters')}>
        <div className="lib-sheet-head">
          <div className="lib-sheet-title">{t('library.filters')}</div>
          <button type="button" className="lib-sheet-clear" onClick={props.onClearAll}>
            {t('library.clear')}
          </button>
          <button type="button" className="lib-sheet-close" aria-label={t('library.close')} onClick={props.onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="lib-sheet-body">
          {groups.map(group => (
            <div key={group.key}>
              <div className="lib-group-head">
                <div className="lib-group-title">{group.label}</div>
                {group.hasMatch && (
                  <>
                    <span className="lib-group-match-label">{t('library.match')}</span>
                    <div className="rx-seg rx-seg--sm">
                      <button type="button" className={props.matchMode === 'any' ? 'is-on' : ''} onClick={() => props.onMatchMode('any')}>
                        {t('library.match_any')}
                      </button>
                      <button type="button" className={props.matchMode === 'all' ? 'is-on' : ''} onClick={() => props.onMatchMode('all')}>
                        {t('library.match_all')}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className="lib-chips">
                {group.items.map(item => {
                  const on = group.selected.includes(item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`lib-chip lib-chip--${group.category}${on ? ' is-on' : ''}`}
                      onClick={() => group.onToggle(item.value)}
                    >
                      {on && <Check size={13} />}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <div className="lib-group-head">
              <div className="lib-group-title">{t('library.length')}</div>
            </div>
            <LengthFilter value={props.length} onChange={props.onLength} />
          </div>
        </div>

        <div className="lib-sheet-foot">
          <button type="button" className="rx-btn rx-btn--primary lib-sheet-apply" onClick={props.onClose}>
            {t('library.show_n_videos', { count: props.resultCount })}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
