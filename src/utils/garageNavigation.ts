// Garage destinations only; route guards remain the authority for access.
export type GarageSection = 'Home' | 'Sales' | 'Jobs' | 'Manage';
export function garageSection(path: string): GarageSection {
  if (/^\/garage\/(team|tint-pricing)(\/|$)/.test(path)) return 'Manage';
  if (/^\/garage\/(installer|calendar)(\/|$)/.test(path)) return 'Jobs';
  if (/^\/garage\/(sales-tools|work-order|building)(\/|$)/.test(path)) return 'Sales';
  return 'Home';
}
export function garageNavigation(role?: string) {
  const manager = ['director', 'shareholder', 'garage_head'].includes(role ?? '');
  const sales = manager || role === 'garage_salesman';
  const workshop = ['garage_installer', 'garage_detailer', 'garage_spray'].includes(role ?? '');
  if (!sales && !workshop) return [];
  return [
    ...(sales ? [{ label: 'Home' as GarageSection, path: '/garage/dashboard' }, { label: 'Sales' as GarageSection, path: '/garage/sales-tools' }] : []),
    { label: 'Jobs' as GarageSection, path: manager || workshop ? '/garage/installer' : '/garage/calendar' },
    ...(manager ? [{ label: 'Manage' as GarageSection, path: '/garage/team' }] : []),
  ];
}
export function garageSecondaryNavigation(role: string | undefined, section: GarageSection) {
  const manager = ['director', 'shareholder', 'garage_head'].includes(role ?? '');
  if (section === 'Jobs') return manager ? [{ label: 'Workshop', path: '/garage/installer' }, { label: 'Calendar', path: '/garage/calendar' }] : [];
  if (section === 'Manage' && manager) return [{ label: 'Team', path: '/garage/team' }, { label: 'Pricing & films', path: '/garage/tint-pricing' }];
  if (section === 'Home' && manager) return [{ label: 'My work', path: '/garage/dashboard' }, { label: 'Team orders', path: '/garage/work-order-tracking' }];
  return [];
}
