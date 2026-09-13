import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useStore } from './store'
import {
  safePersistedState,
  sanitizeSessionUser,
  scrubLegacyPersistedState,
} from './lib/sessionPersistence'

// Phase 1 security hardening:
// Older versions persisted the full working dataset (customers, payments,
// payslips, loan records, user password hashes, etc.) in localStorage. Keep
// persistence limited to a minimal session identity + UI preference from now on.
useStore.persist.setOptions({
  partialize: (state) => safePersistedState(state) as Partial<typeof state>,
})

// The store may already have hydrated an older full snapshot by the time this
// entry module runs. Scrub both browser storage and hydrated memory before React
// renders, then let App/loadAll fetch fresh company data only for a logged-in user.
scrubLegacyPersistedState()
const hydratedState = useStore.getState()
useStore.setState({
  currentUser: sanitizeSessionUser(hydratedState.currentUser),
  users: [],
  cars: [],
  repairs: [],
  quotations: [],
  instructions: [],
  customers: [],
  testDrives: [],
  personalReminders: [],
  kanbanColumns: [],
  dealers: [],
  workshops: [],
  suppliers: [],
  merchants: [],
  claimCategories: [],
  ledgerAccounts: [],
  journalEntries: [],
  externalSalesmen: [],
  bankers: [],
  shipments: [],
  carMovements: [],
  loanCases: [],
  loanCaseDocuments: [],
  loanCaseActivities: [],
  payments: [],
  investorTransactions: [],
  payslips: [],
  notifications: [],
  toastQueue: [],
  bankerOpenCaseId: null,
  loaded: false,
  phase2Loaded: false,
  lastFetched: null,
})

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
