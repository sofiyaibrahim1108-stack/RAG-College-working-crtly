// Frontend role / department scope helpers.
// Super Admin      = role "admin" with NO departments assigned.
// Department Admin = role "admin" with one or more departments assigned.
// The backend enforces the same rules; this file only decides what to show.

const hasValue = (v) => v !== undefined && v !== null && v !== '';

export function getUserDepartmentIds(user) {
  if (!user) return [];

  const raw =
    Array.isArray(user.departmentIds) && user.departmentIds.length > 0
      ? user.departmentIds
      : hasValue(user.departmentId)
        ? [user.departmentId]
        : [];

  const ids = raw
    .map((v) => (v && typeof v === 'object' ? v._id : v))
    .filter(hasValue)
    .map(String);

  return [...new Set(ids)];
}

export const isAdmin = (user) => !!user && user.role === 'admin';

export const isSuperAdmin = (user) => isAdmin(user) && getUserDepartmentIds(user).length === 0;

export const isDepartmentAdmin = (user) => isAdmin(user) && getUserDepartmentIds(user).length > 0;