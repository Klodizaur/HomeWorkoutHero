import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMetaLabels } from '../lib/labels';
import { confirmDialog } from '../lib/confirm';
import { removeTag, TagKind, useTagCatalog } from '../lib/tagCatalog';
import TagAdder from './TagAdder';
import '../styles/modals.css';

/**
 * The tags people added on top of the built-in lists, by kind, with a small
 * "+" to add another and an × to delete one. The video editor offers the same,
 * one video at a time; this is the overview.
 */
export default function CustomTagsSection() {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const { custom } = useTagCatalog();

  const kinds: { kind: TagKind; label: string; category: string }[] = [
    { kind: 'training_type', label: labels.sections.trainingType, category: 'type' },
    { kind: 'body_part', label: labels.sections.bodyParts, category: 'body' },
    { kind: 'equipment', label: labels.sections.equipment, category: 'gear' },
  ];

  const remove = async (kind: TagKind, value: string) => {
    const ok = await confirmDialog({
      title: t('tags.delete_title', { name: value }),
      message: t('tags.delete_message'),
      confirmLabel: t('tags.delete'),
      danger: true,
    });
    if (ok) await removeTag(kind, value);
  };

  return (
    <section className="st-card">
      <header>
        <h2>{t('tags.settings_title')}</h2>
        <p>{t('tags.settings_msg')}</p>
      </header>
      {kinds.map(({ kind, label, category }) => (
        <div key={kind} className="md-group">
          <div className="md-label">{label}</div>
          <div className="md-chips">
            {custom[kind].map(value => (
              <span key={value} className="md-chip-custom">
                <span className={`md-chip md-chip--${category}`}>{value}</span>
                <button
                  type="button"
                  className="md-chip-delete"
                  title={t('tags.delete_title', { name: value })}
                  aria-label={t('tags.delete_title', { name: value })}
                  onClick={() => void remove(kind, value)}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <TagAdder kind={kind} />
          </div>
        </div>
      ))}
    </section>
  );
}
