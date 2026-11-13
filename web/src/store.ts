import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyData, parseData, type Data } from './model';

/**
 * The fridge's records live on this device (the reception computer or tablet). Every change is
 * saved immediately; the Settings tab downloads a backup file and restores one.
 */
const KEY = 'reception-fridge-v1';

export function loadData(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseData(JSON.parse(raw)) : emptyData();
  } catch {
    return emptyData();
  }
}

function saveData(d: Data): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

export function useFridge() {
  const [data, setData] = useState<Data>(loadData);
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef(data);
  latest.current = data;

  // Ask the browser not to clear these records when space runs low.
  useEffect(() => {
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  // Another tab on the same device changed the records.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setData(loadData());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /** Apply a change. Throws the rule's message (RuleError) for the caller to show. */
  const update = useCallback((change: (d: Data) => Data) => {
    // Run the rule now, so a refusal reaches the caller instead of failing inside React.
    const next = change(latest.current);
    latest.current = next;
    setSaveFailed(!saveData(next));
    setData(next);
  }, []);

  return { data, update, saveFailed };
}
