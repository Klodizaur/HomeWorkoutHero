import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { addTag, TagKind } from '../lib/tagCatalog';

/**
 * The small "+" at the end of a tag group. Opens into a small
 * field in place; Enter adds the tag to the shared list and hands its stored
 * value back (an existing tag's, if the name only differs in case).
 */
export default function TagAdder({ kind, onAdded }: { kind: TagKind; onAdded?: (value: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const close = () => { setOpen(false); setLabel(''); setError(''); };

  const submit = async () => {
    if (!label.trim() || busy) return;
    setBusy(true);
    const result = await addTag(kind, label);
    setBusy(false);
    if (result.value) {
      onAdded?.(result.value);
      close();
    } else {
      setError(result.error || t('tags.add_failed'));
    }
  };

  if (!open) {
    return (
      <button type="button" className="md-chip md-chip--add md-chip--plus" onClick={() => setOpen(true)} title={t('tags.add_own')} aria-label={t('tags.add_own')}>
        <Plus size={16} />
      </button>
    );
  }

  return (
    <span className="md-tag-add">
      <input
        ref={inputRef}
        className="md-tag-input"
        value={label}
        maxLength={32}
        placeholder={t('tags.name_placeholder')}
        onChange={e => { setLabel(e.target.value); setError(''); }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }}
        onBlur={() => { if (!label.trim()) close(); }}
      />
      <button type="button" className="md-chip md-chip--add is-on" onMouseDown={e => e.preventDefault()} onClick={() => void submit()} disabled={busy || !label.trim()}>
        {t('tags.add')}
      </button>
      {error && <span className="md-tag-error">{error}</span>}
    </span>
  );
}
