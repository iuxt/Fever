import { useEffect, useLayoutEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export const fontSizes = [12, 14, 16, 18, 20, 22, 24];
const defaultFontSize = 16;
export const editorWidths = { min: 600, max: 1600, step: 20, default: 960 };
const systemThemeQuery = '(prefers-color-scheme: dark)';

export function readAppearance() {
 let themeMode: ThemeMode = 'system', fontSize = defaultFontSize, editorWidth = editorWidths.default, editorFullWidth = false;
 try {
  const storedTheme = localStorage.getItem('fever-theme');
  if (storedTheme === 'light' || storedTheme === 'dark') themeMode = storedTheme;
  const storedSize = Number(localStorage.getItem('fever-font-size'));
  if (fontSizes.includes(storedSize)) fontSize = storedSize;
  const storedWidth = Number(localStorage.getItem('fever-editor-width'));
  if (Number.isFinite(storedWidth) && storedWidth >= editorWidths.min && storedWidth <= editorWidths.max && storedWidth % editorWidths.step === 0) editorWidth = storedWidth;
  editorFullWidth = localStorage.getItem('fever-editor-full-width') === 'true';
 } catch { /* Keep defaults when browser storage is unavailable. */ }
 return { themeMode, fontSize, editorWidth, editorFullWidth };
}

export function applyAppearance(themeMode: ThemeMode, fontSize: number, systemDark = window.matchMedia(systemThemeQuery).matches, editorWidth = editorWidths.default, editorFullWidth = false) {
 document.documentElement.dataset.theme = (themeMode === 'system' ? systemDark : themeMode === 'dark') ? 'dark' : 'light';
 document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
 document.documentElement.style.setProperty('--editor-width', editorFullWidth ? '100%' : `${editorWidth}px`);
}

export function useAppearance() {
 const [{ themeMode, fontSize, editorWidth, editorFullWidth }, setAppearance] = useState(readAppearance);
 const [systemDark, setSystemDark] = useState(() => window.matchMedia(systemThemeQuery).matches);
 const dark = themeMode === 'system' ? systemDark : themeMode === 'dark';
 useEffect(() => {
  const media = window.matchMedia(systemThemeQuery);
  const update = () => setSystemDark(media.matches);
  media.addEventListener('change', update);
  update();
  return () => media.removeEventListener('change', update);
 }, []);
 useLayoutEffect(() => applyAppearance(themeMode, fontSize, systemDark, editorWidth, editorFullWidth), [themeMode, fontSize, systemDark, editorWidth, editorFullWidth]);
 useEffect(() => {
  try {
   localStorage.setItem('fever-theme', themeMode);
   localStorage.setItem('fever-font-size', String(fontSize));
   localStorage.setItem('fever-editor-width', String(editorWidth));
   localStorage.setItem('fever-editor-full-width', String(editorFullWidth));
  } catch { /* Appearance still applies for this session. */ }
 }, [themeMode, fontSize, editorWidth, editorFullWidth]);
 return {
  dark, themeMode, fontSize, editorWidth, editorFullWidth,
  setThemeMode: (value: ThemeMode) => setAppearance(previous => ({ ...previous, themeMode: value })),
  setFontSize: (value: number) => setAppearance(previous => ({ ...previous, fontSize: value })),
  setEditorWidth: (value: number) => setAppearance(previous => ({ ...previous, editorWidth: value })),
  setEditorFullWidth: (value: boolean) => setAppearance(previous => ({ ...previous, editorFullWidth: value })),
 };
}
