import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// After a deploy, a page left open still runs the old version and asks for
// page files the new version replaced, which left a blank screen. Reload once
// to pick up the new version; never more than once a minute, so a real outage
// shows its error instead of reloading in a loop.
window.addEventListener('vite:preloadError', (event) => {
  const key = 'autodream-update-reload';
  let last = 0;
  try { last = Number(sessionStorage.getItem(key) || 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return;
  try { sessionStorage.setItem(key, String(Date.now())); } catch { /* storage blocked */ }
  event.preventDefault();
  window.location.reload();
});

// Auto-capitalize first letter of every word in text inputs
document.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement;
  const skipAutocomplete = ['username', 'email', 'current-password', 'new-password'];
  if (target.dataset.noCapitalize || skipAutocomplete.includes(target.autocomplete) || target.getAttribute('autocapitalize') === 'none') return;
  if (
    (target.tagName === 'INPUT' && target.type === 'text') ||
    target.tagName === 'TEXTAREA'
  ) {
    const pos = target.selectionStart ?? 0;
    const capitalized = target.value.replace(/\b\w/g, (c) => c.toUpperCase());
    if (capitalized !== target.value) {
      target.value = capitalized;
      target.setSelectionRange(pos, pos);
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
});

// Scrolling the page while the cursor happens to sit over a focused number input
// silently bumps the value up/down in most browsers — blur it first so a scroll
// never edits an amount by accident. Amounts should only ever change by typing.
document.addEventListener('wheel', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'number' && document.activeElement === target) {
    (target as HTMLInputElement).blur();
  }
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
