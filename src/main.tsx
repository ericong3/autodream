import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Auto-capitalize first letter of every word in text inputs
document.addEventListener('input', (e) => {
  const target = e.target as HTMLInputElement;
  const skipAutocomplete = ['username', 'email', 'current-password', 'new-password'];
  if (target.dataset.noCapitalize || skipAutocomplete.includes(target.autocomplete)) return;
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
