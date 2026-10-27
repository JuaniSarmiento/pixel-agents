import { describe, expect, it } from 'vitest';

import { detectRole, getRoleVisual, ROLE_VISUALS } from '../../core/src/roles.js';

describe('detectRole', () => {
  it('detects a role from a role-* subagent_type', () => {
    expect(detectRole('role-dba', undefined)).toBe('dba');
    expect(detectRole('role-qa', undefined)).toBe('qa');
    expect(detectRole('role-auditor', undefined)).toBe('auditor');
  });

  it('is case-insensitive on subagent_type', () => {
    expect(detectRole('Role-DBA', undefined)).toBe('dba');
  });

  it('maps role-implementer to the builder (Constructor) identity', () => {
    expect(detectRole('role-implementer', undefined)).toBe('builder');
  });

  it('falls back to description keywords when subagent_type is generic', () => {
    expect(detectRole('general-purpose', 'Rompedor pass: find edge cases in auth')).toBe('breaker');
    expect(detectRole('Explore', 'Auditor: read the verify reports')).toBe('auditor');
    expect(detectRole('fork', 'Constructor de la tarea 3')).toBe('builder');
  });

  it('falls back to description keywords when subagent_type is absent', () => {
    expect(detectRole(undefined, 'QA pass on the login flow')).toBe('qa');
    expect(detectRole(undefined, 'Arquitecto: revisar el boundary nuevo')).toBe('architect');
    expect(detectRole(undefined, 'Analista funcional de la propuesta')).toBe('analyst');
  });

  it('does not match a keyword embedded in a larger word', () => {
    // "Qatar" contains "qa" but is not the QA role.
    expect(detectRole(undefined, 'Research trip to Qatar')).toBeNull();
  });

  it('prefers subagent_type over a conflicting description keyword', () => {
    expect(detectRole('role-backend', 'Rompedor de la nueva feature')).toBe('backend');
  });

  it('returns null when nothing matches', () => {
    expect(detectRole('general-purpose', 'Summarize the changelog')).toBeNull();
    expect(detectRole(undefined, undefined)).toBeNull();
  });
});

describe('getRoleVisual', () => {
  it('returns a fixed visual for every known role', () => {
    for (const role of Object.keys(ROLE_VISUALS)) {
      expect(getRoleVisual(role)).toBe(ROLE_VISUALS[role as keyof typeof ROLE_VISUALS]);
    }
  });

  it('returns undefined for an unknown or missing role', () => {
    expect(getRoleVisual('not-a-role')).toBeUndefined();
    expect(getRoleVisual(undefined)).toBeUndefined();
    expect(getRoleVisual(null)).toBeUndefined();
  });

  it('gives every role a distinct hue shift', () => {
    const shifts = Object.values(ROLE_VISUALS).map((v) => v.hueShift);
    expect(new Set(shifts).size).toBe(shifts.length);
  });
});
