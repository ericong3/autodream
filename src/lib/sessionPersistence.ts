const STORE_KEY = 'autodream-session';

/**
 * The app still uses the legacy users table for authentication in Phase 1.
 * Until Phase 2 moves authentication to Supabase Auth, only keep the minimum
 * identity fields required to restore a session across a browser refresh.
 *
 * Do not add payroll, password/hash, bank-account, customer, payment, loan or
 * accounting data here. Those values belong in memory only after login.
 */
export function sanitizeSessionUser(user: any) {
  if (!user?.id || !user?.role) return null;

  return {
    id: user.id,
    name: user.name ?? '',
    username: user.username ?? '',
    role: user.role,
    avatar: user.avatar ?? undefined,
    position: user.position ?? undefined,
  };
}

export function safePersistedState(state: any) {
  return {
    currentUser: sanitizeSessionUser(state?.currentUser),
    viewPreference: state?.viewPreference ?? {},
  };
}

/**
 * Older app versions cached the entire Zustand working set in localStorage.
 * Scrub that legacy snapshot before the store module is imported/hydrated so
 * sensitive rows are not restored into memory on the login screen.
 */
export function scrubLegacyPersistedState() {
  if (typeof window === 'undefined') return;

  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    const next = {
      ...parsed,
      state: safePersistedState(parsed?.state),
    };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    // A malformed session should never block the app from starting.
    window.localStorage.removeItem(STORE_KEY);
  }
}
