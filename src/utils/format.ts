export function formatRM(amount: number): string {
  return `RM ${amount.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRMDecimal(amount: number): string {
  return formatRM(amount);
}

export function formatMileage(mileage: number): string {
  return `${mileage.toLocaleString('en-MY')} km`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function shortName(name: string): string {
  return name.split(' ').slice(0, 2).join(' ');
}
