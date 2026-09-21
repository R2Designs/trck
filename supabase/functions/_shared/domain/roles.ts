/**
 * The permission matrix.
 *
 * This is the *client* copy: it decides what to render, and nothing more.
 * Every permission here has a matching server-side rule in an RLS policy or an
 * RPC guard. A user who deletes the `disabled` attribute in devtools gets a
 * button that produces a 401, not a privilege escalation.
 */

import type { AppRole } from './types.ts';

export const PERMISSIONS = [
  'org.view',
  'org.settings.manage',
  'depot.manage',
  'manager.create',
  'manager.deactivate',
  'manager.assignDepot',
  'employee.view',
  'employee.create',
  'employee.update',
  'employee.deactivate',
  'employee.enrolFace',
  'employee.deleteBiometrics',
  'bus.view',
  'bus.create',
  'bus.update',
  'route.view',
  'route.create',
  'route.update',
  'attendance.view',
  'attendance.record',
  'attendance.override',
  'trip.view',
  'trip.create',
  'trip.complete',
  'trip.overrideCompletion',
  'capture.create',
  'reading.correct',
  'anomaly.view',
  'anomaly.review',
  'report.view',
  'report.export',
  'audit.view',
  'analytics.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MANAGER_PERMISSIONS: readonly Permission[] = [
  'employee.view',
  'employee.create',
  'employee.update',
  'employee.deactivate',
  'employee.enrolFace',
  'employee.deleteBiometrics',
  'bus.view',
  'bus.create',
  'bus.update',
  'route.view',
  'route.create',
  'route.update',
  'attendance.view',
  'attendance.record',
  'attendance.override',
  'trip.view',
  'trip.create',
  'trip.complete',
  'trip.overrideCompletion',
  'capture.create',
  'reading.correct',
  'anomaly.view',
  'anomaly.review',
  'report.view',
  'report.export',
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...PERMISSIONS.filter((p) => p !== 'attendance.record'),
  // Administrators oversee; they do not stand at the bus recording attendance.
  // (They can still review and override, which is what oversight needs.)
];

export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  // Drivers have no application login in V1. The role exists so that adding
  // one later is a data change rather than a redesign.
  DRIVER: [],
};

export function can(role: AppRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function canAny(
  role: AppRole | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(role, permission));
}

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function isManagerRole(role: AppRole | null | undefined): boolean {
  return role === 'MANAGER';
}

export function isStaffRole(role: AppRole | null | undefined): boolean {
  return isAdminRole(role) || isManagerRole(role);
}
