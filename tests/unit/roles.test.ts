import { describe, expect, it } from 'vitest';
import {
  can,
  canAny,
  isAdminRole,
  isManagerRole,
  isStaffRole,
  ROLE_PERMISSIONS,
} from '@domain/roles.ts';

describe('permission matrix', () => {
  it('lets managers run day-to-day operations', () => {
    expect(can('MANAGER', 'attendance.record')).toBe(true);
    expect(can('MANAGER', 'trip.create')).toBe(true);
    expect(can('MANAGER', 'employee.create')).toBe(true);
    expect(can('MANAGER', 'reading.correct')).toBe(true);
  });

  it('keeps managers out of organisation administration', () => {
    expect(can('MANAGER', 'manager.create')).toBe(false);
    expect(can('MANAGER', 'audit.view')).toBe(false);
    expect(can('MANAGER', 'org.settings.manage')).toBe(false);
    expect(can('MANAGER', 'depot.manage')).toBe(false);
  });

  it('gives administrators oversight including the audit log', () => {
    expect(can('ADMIN', 'audit.view')).toBe(true);
    expect(can('ADMIN', 'manager.create')).toBe(true);
    expect(can('ADMIN', 'anomaly.review')).toBe(true);
    expect(can('ADMIN', 'org.settings.manage')).toBe(true);
    expect(can('ADMIN', 'attendance.record')).toBe(true);
  });

  it('gives drivers no application permissions in V1', () => {
    expect(ROLE_PERMISSIONS.DRIVER).toHaveLength(0);
    expect(can('DRIVER', 'attendance.view')).toBe(false);
  });

  it('treats an unknown or missing role as having nothing', () => {
    expect(can(null, 'trip.view')).toBe(false);
    expect(can(undefined, 'trip.view')).toBe(false);
    expect(canAny(null, ['trip.view', 'bus.view'])).toBe(false);
  });

  it('classifies roles for navigation decisions', () => {
    expect(isAdminRole('SUPER_ADMIN')).toBe(true);
    expect(isAdminRole('MANAGER')).toBe(false);
    expect(isManagerRole('MANAGER')).toBe(true);
    expect(isStaffRole('ADMIN')).toBe(true);
    expect(isStaffRole('DRIVER')).toBe(false);
  });
});
