import { useCallback, useEffect, useState } from "react";

export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore bad JSON
    }
  }, [key]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full/denied — state still updates
      }
    },
    [key],
  );

  return [value, set];
}
