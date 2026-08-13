import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root — index.html and main.tsx have drifted apart');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Production only. In development the worker would sit between Vite and the browser and serve
 * stale modules straight through hot reloads, which costs more than the offline reload it buys
 * while developing.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline reload is an enhancement; the app is fully usable without it.
    });
  });
}
