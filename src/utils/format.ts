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

// Malaysian IC — ######-##-#### (birth date, state code, serial). Strips
// anything typed that isn't a digit and re-inserts the dashes as you go, so
// it can be wired straight to an input's onChange.
export function formatMalaysianIc(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 12);
  const parts = [digits.slice(0, 6), digits.slice(6, 8), digits.slice(8, 12)].filter(Boolean);
  return parts.join('-');
}

export function isValidMalaysianIc(value: string): boolean {
  return /^\d{6}-\d{2}-\d{4}$/.test(value);
}
