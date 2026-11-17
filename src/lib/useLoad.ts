import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load; later reloads keep showing the old data. */
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data when the screen comes into focus and again whenever `deps`
 * change, so going back to a screen always shows fresh data.
 */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await load();
      if (ticket !== latest.current) return; // a newer load finished first
      setData(result);
      setError(null);
    } catch (caught) {
      if (ticket !== latest.current) return;
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, loading, reload };
}

/** Runs an action, tracking whether it is busy and what went wrong. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, clearError: () => setError(null) };
}
