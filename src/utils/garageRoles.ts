// Who can do what in Garage — the single source for route guards
// (App.tsx), the landing page (landingPath) and the tab bar (GarageShell),
// so they can't drift apart. Used Car permissions are separate and
// unaffected.
//
//   Managers (director, shareholder, garage head): everything in Garage.
//   Sales (garage salesman): dashboard, sales tools, new work orders,
//     customers/vehicles, calendar, their own work orders.
//   Workshop (installer, plus detailer/spray whose own workflows aren't
//     built yet): the installer Work Flow only.

export function isGarageManager(role?: string): boolean {
  return role === 'director' || role === 'shareholder' || role === 'garage_head';
}

export function isGarageSalesRole(role?: string): boolean {
  return role === 'garage_salesman';
}

export function isGarageWorkshopRole(role?: string): boolean {
  return role === 'garage_installer' || role === 'garage_detailer' || role === 'garage_spray';
}

// Sales workflow: dashboard, sales tools, work-order creation, customers,
// vehicles, calendar, My Pipeline, work-order detail.
export function canUseGarageSales(role?: string): boolean {
  return isGarageManager(role) || isGarageSalesRole(role);
}

// Installer workflow: Work Flow hub, job lists, job detail.
export function canUseGarageWorkshop(role?: string): boolean {
  return isGarageManager(role) || isGarageWorkshopRole(role);
}
