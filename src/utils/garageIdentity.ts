// Legacy public profile updates must not overwrite a private Garage identity.
export function mergeLegacyIdentity<T extends { id: string; authSource?: 'server' }>(current: T | null, id: string, patch: Partial<T>): T | null {
  if (!current || current.id !== id || current.authSource === 'server') return current;
  return { ...current, ...patch };
}
