import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyAppearance, readAppearance } from './appearance';
const { themeMode, fontSize, editorWidth, editorFullWidth } = readAppearance();
applyAppearance(themeMode, fontSize, undefined, editorWidth, editorFullWidth);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
