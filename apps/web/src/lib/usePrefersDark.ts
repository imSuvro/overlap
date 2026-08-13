import { useEffect, useState } from 'react';

/** Tracks the viewer's colour-scheme preference for the few places JS has to know it. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      setDark(event.matches);
    };
    media.addEventListener('change', onChange);
    setDark(media.matches);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, []);

  return dark;
}
