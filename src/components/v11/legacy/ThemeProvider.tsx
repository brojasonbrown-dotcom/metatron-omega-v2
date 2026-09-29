/**
 * ThemeProvider — hydrates the user's persisted theme/density/glow
 * preferences post-mount. SSR renders default (`matrix`); first client
 * effect reads localStorage and applies the saved selection if different.
 * Renders nothing; pure side-effect component.
 */
import { useEffect } from 'react';
import {
  applyTheme,
  loadTheme,
  applyDensity,
  loadDensity,
  applyGlow,
  loadGlow,
} from '@/lib/themes';

export function ThemeProvider() {
  useEffect(() => {
    applyTheme(loadTheme());
    applyDensity(loadDensity());
    applyGlow(loadGlow());
  }, []);
  return null;
}
