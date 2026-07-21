import bcrypt from 'bcryptjs';

const BCRYPT_PREFIX = /^\$2[aby]\$/;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

// Accepts both bcrypt hashes and legacy plaintext rows so existing accounts
// keep working right up until the one-time DB migration hashes them.
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (BCRYPT_PREFIX.test(stored)) return bcrypt.compare(plain, stored);
  return plain === stored;
}
