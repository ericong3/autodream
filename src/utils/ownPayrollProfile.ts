import type { User } from '../types';

// Supplement the private sign-in identity with only its own payroll fields.
// Public profiles must never change the signed-in role, access or password.
export function ownPayrollProfile(identity: User | null, users: User[]): User | null {
  if (!identity) return null;
  const profile = users.find(user => user.id === identity.id);
  if (!profile) return identity;
  const { employmentType, basicSalary, allowance, salaryIncrement, temporaryBoost,
    temporaryBoostUntil, employeeId, department, joiningDate } = profile;
  return { ...identity, employmentType, basicSalary, allowance, salaryIncrement,
    temporaryBoost, temporaryBoostUntil, employeeId, department, joiningDate };
}
