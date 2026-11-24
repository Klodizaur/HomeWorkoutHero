import { useEffect, useState } from 'react';

/**
 * Whether this profile wants mood prompts and faces (Settings → Workouts).
 * False until the setting has loaded, so the mood UI never flashes up for a
 * profile that switched it off. Off only hides it; logged moods are kept.
 */
export function useMoodTracking(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => { if (!cancelled) setOn(data?.mood_tracking !== false); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return on;
}
