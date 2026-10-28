import type { User } from '../types';
import { canUseGarageHome } from './garageRoles';

// Where a role lands *inside* the Used Car side. Only meaningful once we
// already know the user belongs there — see landingPath for the top-level
// decision (Used Car vs Garage vs the two-door picker).
export function roleHome(role: string) {
  if (role === 'banker') return '/banker-dashboard';
  if (role === 'investor') return '/investor-portal';
  if (role === 'admin') return '/admin-dashboard';
  return '/inventory';
}

// Where a role lands *inside* Garage — mirrors roleHome above. Workshop
// roles, sales, management and authorised finance staff land on Home. A Garage account with no Garage role
// gets the no-access page rather than bouncing between guarded routes.
export function garageHome(role: string) {
  if(canUseGarageHome(role))return '/garage/dashboard';
  return '/garage/no-access';
}

// Top-level landing spot right after login (or when hitting "/").
export function landingPath(user: User): string {
  if (user.businessAccess === 'both') return '/choose-business';
  if (user.businessAccess === 'garage') return garageHome(user.role);
  return roleHome(user.role);
}
