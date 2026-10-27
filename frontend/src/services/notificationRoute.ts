/**
 * notificationRoute.ts — where a tapped push notification opens.
 *
 * The server says where in `data.screen` (+ ids such as case_id, court_date_id,
 * enrollment_id); older pushes only carry `data.type`. A screen name is used
 * only when the app really has it (the MoreTab screens of the linking config),
 * so a stale or unknown name never crashes navigation — it opens nothing.
 */
import { linking } from '../navigation/linking';

export interface NotificationTarget { tab?: string; screen?: string; params?: Record<string, unknown> }

const MORE_SCREENS: ReadonlySet<string> = new Set(Object.keys(
  ((linking.config?.screens as any)?.MainTabs?.screens?.MoreTab?.screens) || {},
));
const TABS: Record<string, string> = { Home: 'HomeTab', HomeTab: 'HomeTab', ChatTab: 'ChatTab', LawyersTab: 'LawyersTab', BailTab: 'BailTab' };

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

/** Older pushes: type → screen. */
const BY_TYPE: Record<string, string> = {
  court_reminder: 'Cases', follower_court_reminder: 'CourtDates', follower_court_update: 'CourtDates', // i18n-exempt: screen names
  court_checkin: 'CourtDateDetail', court_missed_followup: 'CourtDates', bd_court_alert: 'BondDetail', // i18n-exempt: screen names
  checkin_reminder: 'CheckIn', checkin_submitted: 'CheckInManager',
  message: 'Messages', case_update: 'Cases', arrest_alert: 'ArrestMonitor', expungement_eligible: 'Expungement', // i18n-exempt: screen names
  expungement: 'Expungement', lead_accepted: 'AttorneyDashboard', new_lead: 'AttorneyDashboard', cle_reminder: 'AttorneyDashboard', // i18n-exempt: screen names
  case_invite: 'AttorneyInbox', direct_message: 'AttorneyInbox', video_invite: 'VideoConsultation', // i18n-exempt: screen names
};
/** Names the server uses that are not screen names. */
const ALIASES: Record<string, string> = { Following: 'CourtDates', CasesTab: 'Cases' }; // i18n-exempt: screen names

export function notificationTarget(data: Record<string, unknown> | null | undefined): NotificationTarget | null {
  if (!data || typeof data !== 'object') return null;
  const type = typeof data.type === 'string' ? data.type : '';
  let screen = typeof data.screen === 'string' ? data.screen : '';
  screen = ALIASES[screen] || screen;
  if (TABS[screen]) return { tab: TABS[screen] };
  if (!MORE_SCREENS.has(screen)) screen = BY_TYPE[type] || '';
  if (!screen || !MORE_SCREENS.has(screen)) return null;

  const caseId = num(data.case_id ?? data.caseId);
  const courtDateId = num(data.court_date_id);
  // a court reminder opens its hearing
  if ((type === 'court_reminder' || screen === 'Cases') && courtDateId) return { screen: 'CourtDateDetail', params: { id: courtDateId } }; // i18n-exempt: screen names
  if (screen === 'Messages') {
    const directWith = num(data.directWith);
    return { screen, params: caseId ? { caseId } : directWith ? { directWith } : undefined }; // i18n-exempt: screen names
  }
  if (screen === 'CheckIn') {
    const enrollmentId = num(data.enrollment_id ?? data.enrollmentId);
    return { screen, params: enrollmentId ? { enrollmentId } : undefined };
  }
  // "Did you make it to court today?" opens the hearing with the one-tap answer
  if (screen === 'CourtDateDetail') return courtDateId ? { screen, params: { id: courtDateId, ...(type === 'court_checkin' ? { ask: 1 } : {}) } } : { screen: 'CourtDates' };
  // the morning-after message opens the missed-court guidance
  if (screen === 'CourtDates' && data.guidance === 'missed') return { screen, params: { guidance: 'missed' } };
  if (screen === 'BondDetail') {
    const bondId = num(data.bond_id);
    return bondId ? { screen, params: { bondId, tab: 'court' } } : { screen: 'BondDesk' }; // i18n-exempt: screen names
  }
  if (screen === 'VideoConsultation') {
    const room = typeof data.room === 'string' && /^jg-\d+-\d+$/.test(data.room) ? data.room : undefined;
    return { screen, params: room ? { room } : undefined };
  }
  return { screen };
}

/** Navigate a ready navigation container to the push's target. */
export function openNotification(nav: { navigate: (...a: any[]) => void } | null | undefined, data: Record<string, unknown> | null | undefined): boolean {
  const target = notificationTarget(data);
  if (!nav || !target) return false;
  if (target.tab) nav.navigate(target.tab);
  else nav.navigate('MoreTab', { screen: target.screen, params: target.params });
  return true;
}
