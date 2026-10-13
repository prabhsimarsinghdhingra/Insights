// Role-based access control. Roles accumulate: analyst includes everything a
// viewer can do, admin includes everything an analyst can do.

export const ROLES = ['viewer', 'analyst', 'admin'];

const VIEWER = ['health:read', 'alerts:read'];
const ANALYST = [...VIEWER, 'reports:read', 'dq:read', 'costs:read'];
const ADMIN = [...ANALYST, 'alerts:ack', 'reports:assign', 'telemetry:control'];

export const PERMISSIONS = {
  viewer: new Set(VIEWER),
  analyst: new Set(ANALYST),
  admin: new Set(ADMIN),
};

export function can(role, permission) {
  return PERMISSIONS[role]?.has(permission) ?? false;
}

export const ALL_PERMISSIONS = [...new Set(ADMIN)];
