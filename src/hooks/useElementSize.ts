import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Tracks an element's content-box size with a ResizeObserver. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number, height: number) =>
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
