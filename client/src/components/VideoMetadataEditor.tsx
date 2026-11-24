import { useEffect, useRef, useState } from 'react';
import {
  Bold, Check, Code, Heading, Italic, Link as LinkIcon, List, ListOrdered, Quote, Sparkles, Strikethrough,
  SignalHigh, SignalLow, SignalMedium, X,
} from 'lucide-react';
import { LEVELS, trainingTypeGroup, TRAINING_TYPE_GROUPS } from '../lib/metadata';
import { removeTag, TagKind, useTagCatalog } from '../lib/tagCatalog';
import { confirmDialog } from '../lib/confirm';
import TagAdder from './TagAdder';
import { useMetaLabels } from '../lib/labels';
import { useAiAvailable } from '../lib/useAiAvailable';
import { useTranslation } from 'react-i18next';
import { Video } from '../types/video';
import Modal, { CloseButton } from './modal/Modal';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
};

const INTENSITY_ICONS = { low: SignalLow, medium: SignalMedium, high: SignalHigh } as const;

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter(v => v !== value) : [...list, value];

/**
 * The details form: header, body and pinned footer, meant to sit inside a
 * <Modal>. Shared by the standalone editor and by the details dialog, which
 * swaps to it in place.
 */
export function VideoEditForm({ video, onCancel, onSaved }: { video: Video; onCancel: () => void; onSaved: (video: Video) => void }) {
  const [description, setDescription] = useState(video.description || '');
  const [equipment, setEquipment] = useState<string[]>(video.equipment || []);
  const [trainingType, setTrainingType] = useState<string[]>(video.training_type || []);
  const [bodyParts, setBodyParts] = useState<string[]>(video.body_parts || []);
  const [intensity, setIntensity] = useState<string>(video.intensity || '');
  const [level, setLevel] = useState<string>(video.level || '');
  const catalog = useTagCatalog();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = useMetaLabels();
  const { t } = useTranslation();

  // Optional AI clean-up. Hidden unless the server reports a configured model.
  const aiAvailable = useAiAvailable();
  const [cleaning, setCleaning] = useState(false);
  // The text as it was before the last clean-up, so a result the user dislikes
  // is one click away from being undone rather than gone.
  const [beforeClean, setBeforeClean] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    setDescription(video.description || '');
    setEquipment(video.equipment || []);
    setTrainingType(video.training_type || []);
    setBodyParts(video.body_parts || []);
    setIntensity(video.intensity || '');
    setLevel(video.level || '');
  }, [video]);

  // Restore the caret/selection after a formatting action mutates the value.
  useEffect(() => {
    if (pendingSelection.current && textareaRef.current) {
      const [start, end] = pendingSelection.current;
      pendingSelection.current = null;
      const ta = textareaRef.current;
      ta.focus();
      ta.setSelectionRange(start, end);
    }
  });

  // Wrap the current selection with inline markers (e.g. **bold**).
  const applyWrap = (prefix: string, suffix: string, placeholder: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = end > start ? description.slice(start, end) : placeholder;
    setDescription(description.slice(0, start) + prefix + selected + suffix + description.slice(end));
    const selStart = start + prefix.length;
    pendingSelection.current = [selStart, selStart + selected.length];
  };

  // Prefix each selected line (e.g. "- ", "> ", "1. ") for block formatting.
  const applyLinePrefix = (prefixFor: (index: number) => string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = description.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = description.indexOf('\n', end);
    if (lineEnd === -1) lineEnd = description.length;
    const transformed = description
      .slice(lineStart, lineEnd)
      .split('\n')
      .map((line, i) => prefixFor(i) + line)
      .join('\n');
    setDescription(description.slice(0, lineStart) + transformed + description.slice(lineEnd));
    pendingSelection.current = [lineStart, lineStart + transformed.length];
  };

  // Insert a markdown link, selecting the "url" placeholder for quick editing.
  const insertLink = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const label = end > start ? description.slice(start, end) : 'text';
    setDescription(description.slice(0, start) + `[${label}](url)` + description.slice(end));
    const urlStart = start + label.length + 3;
    pendingSelection.current = [urlStart, urlStart + 3];
  };

  /**
   * Replace the description with a cleaned-up version.
   *
   * Nothing is saved here — the result lands in the textarea for the user to
   * read, edit or undo, and only reaches the library through the same Save
   * button as any hand-written description. Tags are untouched.
   */
  const handleClean = async () => {
    if (!description.trim()) return;
    setCleaning(true);
    setError(null);
    try {
      const res = await fetch('/api/ai/clean-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: description }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Clean-up failed');
      setBeforeClean(description);
      setDescription(data.description || '');
    } catch (err: any) {
      setError(err.message || 'Clean-up failed');
    } finally {
      setCleaning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/library/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, equipment, training_type: trainingType, body_parts: bodyParts, intensity, level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      // Keep what the edit response doesn't carry (the completion count).
      onSaved({ ...video, ...data });
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const tools: ({ sep: true } | { title: string; Icon: typeof Bold; run: () => void })[] = [
    { title: t('editor.bold'), Icon: Bold, run: () => applyWrap('**', '**', 'bold text') },
    { title: t('editor.italic'), Icon: Italic, run: () => applyWrap('*', '*', 'italic text') },
    { title: t('editor.strike'), Icon: Strikethrough, run: () => applyWrap('~~', '~~', 'strikethrough') },
    { title: t('editor.code'), Icon: Code, run: () => applyWrap('`', '`', 'code') },
    { sep: true },
    { title: t('editor.heading'), Icon: Heading, run: () => applyLinePrefix(() => '## ') },
    { title: t('editor.bullets'), Icon: List, run: () => applyLinePrefix(() => '- ') },
    { title: t('editor.numbers'), Icon: ListOrdered, run: () => applyLinePrefix(i => `${i + 1}. `) },
    { title: t('editor.quote'), Icon: Quote, run: () => applyLinePrefix(() => '> ') },
    { sep: true },
    { title: t('editor.link'), Icon: LinkIcon, run: insertLink },
  ];

  /**
   * Delete a tag someone added, everywhere. It's shared and on other videos
   * too, so this asks first; built-in tags have no delete.
   */
  const deleteCustom = async (kind: TagKind, value: string, selected: string[], set: (next: string[]) => void) => {
    const ok = await confirmDialog({
      title: t('tags.delete_title', { name: value }),
      message: t('tags.delete_message'),
      confirmLabel: t('tags.delete'),
      danger: true,
    });
    if (!ok) return;
    const removed = await removeTag(kind, value);
    if (removed !== null) set(selected.filter(v => v !== value));
  };

  const chips = (
    category: 'gear' | 'type' | 'body',
    kind: TagKind,
    items: { value: string; label: string }[],
    selected: string[],
    set: (next: string[]) => void
  ) => items.map(item => {
    const on = selected.includes(item.value);
    const chip = (
      <button key={item.value} type="button" className={`md-chip md-chip--${category}${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => set(toggle(selected, item.value))}>
        {on && <Check size={14} />}
        {item.label}
      </button>
    );
    if (!catalog.custom[kind].includes(item.value)) return chip;
    // A tag someone added: the same chip, plus a small × to delete it.
    return (
      <span key={item.value} className="md-chip-custom">
        {chip}
        <button
          type="button"
          className="md-chip-delete"
          title={t('tags.delete_title', { name: item.value })}
          aria-label={t('tags.delete_title', { name: item.value })}
          onClick={() => void deleteCustom(kind, item.value, selected, set)}
        >
          <X size={12} />
        </button>
      </span>
    );
  });

  const chipGroup = (
    label: string,
    category: 'gear' | 'type' | 'body',
    kind: TagKind,
    items: { value: string; label: string }[],
    selected: string[],
    set: (next: string[]) => void
  ) => (
    <div className="md-group">
      <div className="md-group-head">
        <div className="md-label">{label}</div>
        {selected.length > 0 && <div className="md-count">{t('editor.n_selected', { count: selected.length })}</div>}
      </div>
      <div className="md-chips">
        {chips(category, kind, items, selected, set)}
        {/* A new tag is picked for this video straight away. */}
        <TagAdder kind={kind} onAdded={value => set(selected.includes(value) ? selected : [...selected, value])} />
      </div>
    </div>
  );

  // Training types in their three groups, with tags people added among the
  // workout types.
  const typeGroups = (Object.keys(TRAINING_TYPE_GROUPS) as (keyof typeof TRAINING_TYPE_GROUPS)[]).map(group => ({
    group,
    items: catalog.trainingTypes.filter(v => trainingTypeGroup(v) === group).map(v => ({ value: v, label: labels.trainingType(v) })),
  }));

  return (
    <>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title">{t('editor.title')}</h2>
          <div className="md-sub">{video.filename}</div>
        </div>
        <CloseButton onClick={onCancel} />
      </div>

      <div className="md-body" style={{ gap: 26 }}>
        <div className="md-group">
          <div className="md-label">{t('editor.description')}</div>
          <div className="md-editor">
            <div className="md-toolbar">
              {tools.map((tool, i) => 'sep' in tool
                ? <span key={i} className="md-tool-sep" />
                : (
                  <button key={tool.title} type="button" className="md-tool" title={tool.title} aria-label={tool.title} onMouseDown={e => e.preventDefault()} onClick={tool.run}>
                    <tool.Icon size={16} />
                  </button>
                ))}
              <span className="md-tool-spacer" />
              {/* At the end of the toolbar because it rewrites the whole field
                  rather than formatting a selection. */}
              {aiAvailable && (
                <>
                  {beforeClean !== null && !cleaning && (
                    <button type="button" className="md-clean" onClick={() => { setDescription(beforeClean); setBeforeClean(null); }}>{t('ai.clean_undo')}</button>
                  )}
                  <button type="button" className="md-clean" title={t('ai.clean_hint')} onClick={handleClean} disabled={cleaning || !description.trim()}>
                    <Sparkles size={13} />
                    {cleaning ? t('ai.cleaning') : t('ai.clean_btn')}
                  </button>
                </>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && !e.altKey) {
                  const key = e.key.toLowerCase();
                  if (key === 'b') { e.preventDefault(); applyWrap('**', '**', 'bold text'); }
                  else if (key === 'i') { e.preventDefault(); applyWrap('*', '*', 'italic text'); }
                }
              }}
              placeholder={t('editor.description_placeholder')}
              rows={6}
            />
          </div>
          <div className="md-help">{t('editor.markdown_hint')}</div>
        </div>

        {chipGroup(labels.sections.equipment, 'gear', 'equipment', catalog.equipment.map(id => ({ value: id, label: labels.equipment(id) })), equipment, setEquipment)}

        <div className="md-group">
          <div className="md-group-head">
            <div className="md-label">{labels.sections.trainingType}</div>
            {trainingType.length > 0 && <div className="md-count">{t('editor.n_selected', { count: trainingType.length })}</div>}
          </div>
          {typeGroups.map(({ group, items }) => (
            <div key={group} className="md-subgroup">
              <div className="md-sublabel">{labels.typeGroup(group)}</div>
              <div className="md-chips">
                {chips('type', 'training_type', items, trainingType, setTrainingType)}
                {group === 'type' && (
                  <TagAdder kind="training_type" onAdded={value => setTrainingType(trainingType.includes(value) ? trainingType : [...trainingType, value])} />
                )}
              </div>
            </div>
          ))}
        </div>

        {chipGroup(labels.sections.bodyParts, 'body', 'body_part', catalog.bodyParts.map(v => ({ value: v, label: labels.bodyPart(v) })), bodyParts, setBodyParts)}

        <div className="md-group">
          <div className="md-label">{labels.sections.intensity}</div>
          <div className="rx-seg md-seg--wide">
            {(['low', 'medium', 'high'] as const).map(level => {
              const Icon = INTENSITY_ICONS[level];
              return (
                <button key={level} type="button" className={intensity === level ? 'is-on' : ''} onClick={() => setIntensity(intensity === level ? '' : level)}>
                  <Icon size={16} />
                  {labels.intensity(level)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="md-group">
          <div className="md-label">{labels.sections.level}</div>
          <div className="rx-seg md-seg--wide md-seg--wrap">
            {LEVELS.map(value => (
              <button key={value} type="button" className={level === value ? 'is-on' : ''} onClick={() => setLevel(level === value ? '' : value)}>
                {labels.level(value)}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="md-error">{error}</div>}
      </div>

      <div className="md-foot md-foot--line">
        <button type="button" className="md-btn" onClick={onCancel} disabled={saving}>{t('editor.cancel')}</button>
        <button type="button" className="md-btn md-btn--primary" onClick={handleSave} disabled={saving} style={{ padding: '0 26px' }}>
          {saving ? t('editor.saving') : t('editor.save')}
        </button>
      </div>
    </>
  );
}

/** The editor as its own dialog — the Log opens it straight from a logged video. */
export default function VideoMetadataEditor({ video, onClose, onSaved }: Props) {
  return (
    <Modal width={780} onClose={onClose} label="Video info">
      <VideoEditForm video={video} onCancel={onClose} onSaved={updated => { onSaved(updated); onClose(); }} />
    </Modal>
  );
}
