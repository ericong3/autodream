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

// Where a role lands *inside* Garage — mirrors roleHome above. Installers go
// straight to their Work Flow; everyone else lands on the Dashboard, where
// the top tab bar (role-aware, see GarageShell) reaches every module.
export function garageHome(role: string) {
  if (role === 'garage_installer') return '/garage/installer';
  return '/garage/dashboard';
}

// Top-level landing spot right after login (or when hitting "/").
export function landingPath(user: User): string {
  if (user.businessAccess === 'both') return '/choose-business';
  if (user.businessAccess === 'garage') return garageHome(user.role);
  return roleHome(user.role);
}
