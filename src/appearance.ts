import { useEffect, useLayoutEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export const fontSizes = [12, 14, 16, 18, 20, 22, 24];
const defaultFontSize = 16;
const systemThemeQuery = '(prefers-color-scheme: dark)';

export function readAppearance() {
 let themeMode: ThemeMode = 'system', fontSize = defaultFontSize;
 try {
  const storedTheme = localStorage.getItem('fever-theme');
  if (storedTheme === 'light' || storedTheme === 'dark') themeMode = storedTheme;
  const storedSize = Number(localStorage.getItem('fever-font-size'));
  if (fontSizes.includes(storedSize)) fontSize = storedSize;
 } catch { /* Keep defaults when browser storage is unavailable. */ }
 return { themeMode, fontSize };
}

export function applyAppearance(themeMode: ThemeMode, fontSize: number, systemDark = window.matchMedia(systemThemeQuery).matches) {
 document.documentElement.dataset.theme = (themeMode === 'system' ? systemDark : themeMode === 'dark') ? 'dark' : 'light';
 document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
}

export function useAppearance() {
 const [{ themeMode, fontSize }, setAppearance] = useState(readAppearance);
 const [systemDark, setSystemDark] = useState(() => window.matchMedia(systemThemeQuery).matches);
 const dark = themeMode === 'system' ? systemDark : themeMode === 'dark';
 useEffect(() => {
  const media = window.matchMedia(systemThemeQuery);
  const update = () => setSystemDark(media.matches);
  media.addEventListener('change', update);
  update();
  return () => media.removeEventListener('change', update);
 }, []);
 useLayoutEffect(() => applyAppearance(themeMode, fontSize, systemDark), [themeMode, fontSize, systemDark]);
 useEffect(() => {
  try {
   localStorage.setItem('fever-theme', themeMode);
   localStorage.setItem('fever-font-size', String(fontSize));
  } catch { /* Appearance still applies for this session. */ }
 }, [themeMode, fontSize]);
 return {
  dark, themeMode, fontSize,
  setThemeMode: (value: ThemeMode) => setAppearance(previous => ({ ...previous, themeMode: value })),
  setFontSize: (value: number) => setAppearance(previous => ({ ...previous, fontSize: value })),
 };
}
