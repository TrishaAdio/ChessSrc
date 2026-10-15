import { useEffect, useState } from 'react';
import { getBackdrop, type Backdrop } from '@/lib/platform/window';

/** Native material behind the webview ('none' in a browser / non-Windows dev). */
export function useBackdrop(): Backdrop {
  const [backdrop, setBackdrop] = useState<Backdrop>('none');
  useEffect(() => {
    let alive = true;
    void getBackdrop().then((b) => alive && setBackdrop(b));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.backdrop = backdrop;
  }, [backdrop]);
  return backdrop;
}
