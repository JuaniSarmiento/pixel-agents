/**
 * Role detection and fixed visual identity for sub-agents the orchestrator
 * spawns (OPSX role specialists, adversarial-review passes, etc.).
 *
 * Detection prefers the Task/Agent tool's `subagent_type` (e.g. "role-dba"),
 * falling back to keywords in its `description` (e.g. "Rompedor pass: ...").
 * Each detected role gets a FIXED hue shift, so the same role always wears
 * the same color across every agent and every session -- unlike the random
 * diversity hue assigned to ordinary agents (see paletteUtils.ts).
 *
 * Pure functions with no DOM/sprite dependencies -- safe for use in both the
 * server (detection, from tool_use input) and the webview (visual lookup).
 */

export type RoleKey =
  | 'architect'
  | 'backend'
  | 'frontend'
  | 'dba'
  | 'qa'
  | 'analyst'
  | 'senior'
  | 'auditor'
  | 'devops'
  | 'breaker'
  | 'builder';

export interface RoleVisual {
  /** Short tag shown in the character's cartel (e.g. "DBA", "Rompedor"). */
  label: string;
  /** Fixed hue shift in degrees (0-360) -- same role, same color, always. */
  hueShift: number;
}

/** One fixed identity per role, evenly spaced around the hue wheel so any two
 *  roles are easy to tell apart at a glance. */
export const ROLE_VISUALS: Record<RoleKey, RoleVisual> = {
  dba: { label: 'DBA', hueShift: 0 },
  qa: { label: 'QA', hueShift: 33 },
  auditor: { label: 'Auditor', hueShift: 66 },
  architect: { label: 'Arquitecto', hueShift: 99 },
  backend: { label: 'Backend', hueShift: 132 },
  frontend: { label: 'Frontend', hueShift: 165 },
  analyst: { label: 'Analista', hueShift: 198 },
  senior: { label: 'Senior', hueShift: 231 },
  devops: { label: 'DevOps', hueShift: 264 },
  breaker: { label: 'Rompedor', hueShift: 297 },
  builder: { label: 'Constructor', hueShift: 330 },
};

/** Look up a role's fixed visual identity. Returns undefined for an
 *  unrecognized or absent role -- callers keep whatever default they had. */
export function getRoleVisual(role: string | undefined | null): RoleVisual | undefined {
  if (!role) return undefined;
  return ROLE_VISUALS[role as RoleKey];
}

/** `subagent_type` -> RoleKey, after stripping a leading "role-". Generic
 *  launch types (general-purpose, Explore, fork) map to nothing here: a fork
 *  inherits its caller's identity, and the other two are catch-alls with no
 *  role of their own -- they fall through to the description keywords. */
const SUBAGENT_TYPE_ROLES: Record<string, RoleKey> = {
  dba: 'dba',
  qa: 'qa',
  auditor: 'auditor',
  architect: 'architect',
  backend: 'backend',
  frontend: 'frontend',
  analyst: 'analyst',
  senior: 'senior',
  devops: 'devops',
  // role-implementer is the one role-* type that writes code; visually it's
  // the same "Constructor" identity a generic builder description gets.
  implementer: 'builder',
};

/** description keyword -> RoleKey fallback, checked only when subagent_type
 *  didn't resolve to a role. Word-boundary, case-insensitive; first match wins. */
const DESCRIPTION_KEYWORD_ROLES: ReadonlyArray<readonly [RegExp, RoleKey]> = [
  [/\brompedor(?:a)?\b/i, 'breaker'],
  [/\bconstructor(?:a)?\b/i, 'builder'],
  [/\bauditor(?:a)?\b/i, 'auditor'],
  [/\bdba\b/i, 'dba'],
  [/\bqa\b/i, 'qa'],
  [/\barquitect[oa]\b/i, 'architect'],
  [/\barchitect\b/i, 'architect'],
  [/\banalista\b/i, 'analyst'],
  [/\banalyst\b/i, 'analyst'],
  [/\bdevops\b/i, 'devops'],
  [/\bbackend\b/i, 'backend'],
  [/\bfrontend\b/i, 'frontend'],
  [/\bsenior\b/i, 'senior'],
];

/**
 * Detect the role a spawned sub-agent is playing, for a fixed visual identity
 * in the office. Prefers `subagent_type` (role-dba, role-qa, ...); falls back
 * to keywords in `description` (e.g. "Rompedor", "Auditor", "DBA", "QA",
 * "Arquitecto", "Analista"). Returns null when neither signal maps to a known
 * role -- a generic sub-agent gets no badge, not a wrong one.
 */
export function detectRole(
  subagentType: string | undefined | null,
  description: string | undefined | null,
): RoleKey | null {
  if (subagentType) {
    const normalized = subagentType
      .trim()
      .toLowerCase()
      .replace(/^role-/, '');
    const role = SUBAGENT_TYPE_ROLES[normalized];
    if (role) return role;
  }
  if (description) {
    for (const [pattern, role] of DESCRIPTION_KEYWORD_ROLES) {
      if (pattern.test(description)) return role;
    }
  }
  return null;
}
