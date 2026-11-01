/**
 * caseSteps.ts — "Your case, step by step: from arrest to clearing your record"
 * (docs/COURT_GUIDE.md). Nine stages, each with a plain explanation (`cst_<stage>_body`), the
 * official pages it comes from, 3–6 items the person can tick (`cst_<stage>_<item>`) and buttons
 * to the parts of the app that help at that stage.
 *
 * The stage and item ids are caseStepsCatalog.json — the same list the server validates
 * (backend services/caseSteps.js; a backend test checks they match). Two items are ticked by the
 * case's court dates (`AUTO_ITEMS`), never by hand. No stage claims to know a case's status:
 * the stage is what the person picks.
 */
import catalog from './caseStepsCatalog.json';
import type { SourceId } from './guideSources';

export type StageId = 'arrest' | 'release' | 'first' | 'lawyer' | 'pretrial' | 'plea' | 'sentence' | 'probation' | 'record';
export type StepAction =
  | 'rights' | 'family' | 'help' | 'bail' | 'custody' | 'court_dates' | 'add_court_date' | 'guide'
  | 'checkin' | 'missed' | 'lawyers' | 'expungement';

export interface StageDef { id: StageId; items: string[]; sources: SourceId[]; actions: StepAction[] }

const SOURCES: Record<StageId, SourceId[]> = {
  arrest:    ['jg_rights', 'pinal_pd'],
  release:   ['usao_mn', 'az_steps', 'tned_pretrial'],
  first:     ['az_steps', 'ny_steps', 'ca_overview'],
  lawyer:    ['usao_mn', 'ny_steps', 'az_steps', 'de_ocd'],
  pretrial:  ['pinal_pd', 'allegheny_pd', 'tned_pretrial'],
  plea:      ['ca_overview', 'az_steps', 'ny_steps'],
  sentence:  ['ca_overview', 'usao_mn', 'nj_probation', 'ny_tips'],
  probation: ['nj_probation'],
  record:    ['ca_overview', 'jg_expungement'],
};
const ACTIONS: Record<StageId, StepAction[]> = {
  arrest:    ['rights', 'family'],
  release:   ['help', 'bail', 'family', 'custody'],
  first:     ['add_court_date', 'guide', 'help'],
  lawyer:    ['lawyers', 'help'],
  pretrial:  ['court_dates', 'checkin', 'guide', 'missed'],
  plea:      ['lawyers', 'guide', 'court_dates'],
  sentence:  ['court_dates', 'guide', 'lawyers'],
  probation: ['checkin', 'court_dates'],
  record:    ['expungement', 'lawyers'],
};

export const CASE_STAGES: readonly StageDef[] = Object.freeze(
  (catalog.stages as { id: StageId; items: string[] }[]).map(s => ({ id: s.id, items: s.items, sources: SOURCES[s.id], actions: ACTIONS[s.id] })),
);
export const STAGE_IDS: readonly StageId[] = CASE_STAGES.map(s => s.id);
export const AUTO_ITEMS: readonly string[] = Object.freeze([...catalog.auto]);
export const itemId = (stage: StageId, item: string): string => `${stage}.${item}`;
export const ALL_ITEM_IDS: readonly string[] = CASE_STAGES.flatMap(s => s.items.map(i => itemId(s.id, i)));

/** Where each button goes (a MoreTab screen, or a tab) and its label / icon. */
export const ACTION_TARGETS: Readonly<Record<StepAction, { screen: string; params?: Record<string, unknown>; tab?: boolean; label: string; flag?: 'custody' }>> = Object.freeze({
  rights:         { screen: 'RightsCard', label: 'cst_act_rights' },
  family:         { screen: 'FamilyConnect', label: 'cst_act_family' },
  help:           { screen: 'HelpNow', label: 'cst_act_help' },
  bail:           { screen: 'Bail', label: 'cst_act_bail' },
  custody:        { screen: 'CustodyAlerts', label: 'cst_act_custody', flag: 'custody' },
  court_dates:    { screen: 'CourtDates', label: 'cst_act_court_dates' },
  add_court_date: { screen: 'CourtDates', params: { add: true }, label: 'cst_act_add_court_date' },
  guide:          { screen: 'CourtGuide', label: 'cst_act_guide' },
  checkin:        { screen: 'CheckIn', label: 'cst_act_checkin' },
  missed:         { screen: 'CourtDates', params: { guidance: 'missed' }, label: 'cst_act_missed' },
  lawyers:        { screen: 'LawyersTab', tab: true, label: 'cst_act_lawyers' },
  expungement:    { screen: 'Expungement', label: 'cst_act_expungement' },
});
