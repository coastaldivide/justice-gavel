/**
 * features.ts — which screens the app shows (Oct 26 2026: core-path focus).
 *
 * The consumer app is the core path: "Just arrested?" → rights → help → court
 * reminders, plus record clearing. Everything else is either
 *   - PRO: shown only to professional accounts (attorneys, defenders, bail agents, staff), or
 *   - PARKED: hidden for everyone until it is reviewed, sourced or rebuilt.
 *
 * Nothing is deleted: screens stay registered, so links and tests keep working,
 * and a parked or pro screen opened by a consumer shows a "not available" card
 * (navigation/CoreOnlyGate.tsx). Build with EXPO_PUBLIC_FULL_APP=1 to show everything.
 */

export const CORE_ONLY: boolean = process.env.EXPO_PUBLIC_FULL_APP !== '1';

/** Professional roles (backend middleware/rbac.js). */
export const PRO_ROLES: readonly string[] = Object.freeze(['attorney', 'defender', 'bail_agent', 'admin', 'super_admin', 'staff']);

/** Hidden for everyone in CORE_ONLY builds: unreviewed, unsourced or off-mission. */
export const PARKED_SCREENS: ReadonlySet<string> = new Set([
  // Bar prep: 548 unreviewed questions (MONETIZATION_PLAN.md §3E)
  'BarPrepHome', 'BarPrepQuiz', 'BarPrepExplanation', 'BarPrepProgress', 'BarPrepSchedule', 'BarPrepResults',
  // Firm tools: a separate product
  'FirmAcquisition', 'FirmVertical', 'FirmDiscovery', 'FirmPublicProfile', 'MatterIntelligence',
  // No product or no source behind them (docs/OWNER_DECISIONS.md)
  'GoldenGavel', 'Insurance', 'ChildSupport', 'HagueContact', 'Advocacy',
  // Paused until counsel clears arrest-data use
  'ArrestMonitor',
  // Off the core path for launch
  'FamilyCourt', 'TenantRights', 'HousingRights',
]);

/** Shown only to professional accounts. */
export const PRO_SCREENS: ReadonlySet<string> = new Set([
  'AttorneyDashboard', 'AttorneyInbox', 'Subscription', 'ConflictCheck', 'Matter', 'MotionLibrary',
  'Discovery', 'LegalResearch', 'DeadlineCalculator',
  'BondsmanDashboard', 'BondDesk', 'BondDetail', 'BondForms', 'BondPowers', 'BondReports', 'CheckInManager',
  'AdminVerification', 'AdminResults',
]);

export const isProRole = (role?: string | null): boolean => PRO_ROLES.includes(String(role || ''));

/** May this account open `screen`? Always true in full builds. */
export function isScreenEnabled(screen: string, role?: string | null): boolean {
  if (!CORE_ONLY) return true;
  if (PARKED_SCREENS.has(screen)) return false;
  if (PRO_SCREENS.has(screen)) return isProRole(role);
  return true;
}

/** A Home tile's target ('More:Screen' or a tab name) → its screen name. */
export const tileScreen = (nav: string): string => (nav.startsWith('More:') ? nav.slice(5) : nav);
