import { useEffect, useState } from "react";

type StickyStateOptions<T> = {
  parse?: (raw: string) => T;
  serialize?: (value: T) => string;
};

export const useStickyState = <T,>(
  key: string,
  defaultValue: T,
  options: StickyStateOptions<T> = {}
) => {
  const { parse, serialize } = options;
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") {
      return defaultValue;
    }

    const stored = window.localStorage.getItem(key);
    if (stored === null) {
      return defaultValue;
    }

    try {
      return parse ? parse(stored) : (JSON.parse(stored) as T);
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const serialized = serialize ? serialize(state) : JSON.stringify(state);
    window.localStorage.setItem(key, serialized);
  }, [key, serialize, state]);

  return [state, setState] as const;
};
