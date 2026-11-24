/**
 * Small pop-up for a library scan running in the background — started from
 * the Library page, from Settings (once you leave that page) or by auto-scan —
 * so it's clear why new videos are turning up. Closing it only hides it; the
 * scan carries on. A finished scan says what changed, then goes away by itself.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, RefreshCw, X } from 'lucide-react';
import { LIBRARY_SCANNED_EVENT, useScanStatus } from '../lib/scanStatus';

/** How long a clean result stays up before the pop-up closes itself. */
const DONE_MS = 8000;

export default function ScanProgress() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const scan = useScanStatus();
  // Only scans seen running (or finishing) while the app is open get a
  // pop-up — never the leftover result of one that ended before.
  const [seenId, setSeenId] = useState<number | null>(null);
  const [closedId, setClosedId] = useState<number | null>(null);

  useEffect(() => {
    if (scan?.mine && scan.active) setSeenId(scan.id);
  }, [scan?.mine, scan?.active, scan?.id]);

  // A scan with nothing new can start and finish between two polls; this
  // still brings up its result.
  useEffect(() => {
    const onScanned = (e: Event) => {
      const id = (e as CustomEvent<{ id: number }>).detail?.id;
      if (typeof id === 'number') setSeenId(id);
    };
    window.addEventListener(LIBRARY_SCANNED_EVENT, onScanned);
    return () => window.removeEventListener(LIBRARY_SCANNED_EVENT, onScanned);
  }, []);

  const finished = !!scan && !scan.active;
  const result = scan?.result ?? null;
  const problem = finished && !!result && (!!result.error || result.skippedCleanup);

  // A clean finish closes itself; a problem stays until it has been read.
  useEffect(() => {
    if (!scan || !finished || problem || seenId !== scan.id) return;
    const id = scan.id;
    const timer = setTimeout(() => setClosedId(id), DONE_MS);
    return () => clearTimeout(timer);
  }, [scan, finished, problem, seenId]);

  if (!scan || !scan.mine || seenId !== scan.id || closedId === scan.id) return null;
  // Settings shows its own scan inline while you're on it.
  if (scan.trigger === 'settings' && pathname.startsWith('/settings')) return null;

  const percent = scan.total > 0 ? Math.round((scan.processed / scan.total) * 100) : 0;

  let title: string;
  let line: string;
  if (!finished) {
    title = t('scan.title_running');
    line = scan.phase === 'processing' && scan.total > 0
      ? t('scan.progress', { processed: scan.processed, total: scan.total })
      : t('scan.discovering');
  } else if (result?.error) {
    title = t('scan.title_failed');
    line = result.error;
  } else {
    title = t('scan.title_done');
    const parts: string[] = [];
    if (result && result.added > 0) parts.push(t('scan.added', { count: result.added }));
    if (result && result.removed > 0) parts.push(t('scan.removed', { count: result.removed }));
    line = parts.length ? parts.join(' · ') : t('scan.nothing_new');
  }

  const Icon = problem ? CircleAlert : finished ? Check : RefreshCw;

  return createPortal(
    <div className={`job job--scan${problem ? ' is-error' : ''}`} role="status" aria-live="polite">
      <div className="job-head">
        <span className={`job-icon${finished ? '' : ' job-icon--spin'}`}><Icon size={18} /></span>
        <div className="job-title">
          <strong>{title}</strong>
          {scan.trigger === 'auto'
            ? <span>{t('scan.auto')}</span>
            : !finished && <span>{t('scan.background')}</span>}
        </div>
        <button type="button" className="job-btn" onClick={() => setClosedId(scan.id)} title={t('scan.close')} aria-label={t('scan.close')}>
          <X size={16} />
        </button>
      </div>
      {!finished && (
        <div className={`job-bar${scan.total > 0 ? '' : ' is-indeterminate'}`}>
          <span style={scan.total > 0 ? { width: `${percent}%` } : undefined} />
        </div>
      )}
      <div className="job-count">{line}</div>
      {finished && result?.skippedCleanup && !result.error && <div className="job-error">{t('scan.incomplete')}</div>}
    </div>,
    document.body
  );
}
