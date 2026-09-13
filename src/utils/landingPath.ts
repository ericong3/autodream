import type { User } from '../types';

// Where a role lands *inside* the Used Car side. Only meaningful once we
// already know the user belongs there — see landingPath for the top-level
// decision (Used Car vs Garage vs the two-door picker).
export function roleHome(role: string) {
  if (role === 'banker') return '/banker-dashboard';
  if (role === 'investor') return '/investor-portal';
  if (role === 'admin') return '/admin-dashboard';
  return '/inventory';
}

// Top-level landing spot right after login (or when hitting "/"). Garage has
// no pages of its own yet beyond the placeholder home — this just needs to
// route people to the right side of the business.
export function landingPath(user: User): string {
  if (user.businessAccess === 'both') return '/choose-business';
  if (user.businessAccess === 'garage') return '/garage';
  return roleHome(user.role);
}
