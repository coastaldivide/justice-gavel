/**
 * courtGuide.ts — "Going to court: how to dress and act" (docs/COURT_GUIDE.md).
 *
 * Eight sections, each a list of short items (i18n `cgd_<section>_<n>`, title `cgd_<section>_title`)
 * and the official pages they come from (constants/guideSources.ts). Nothing here is a legal rule,
 * a deadline or a number: it is general advice that court and government pages give, and each
 * court can have its own rules (shown on a court date when backend data/court_rules.js lists the
 * court). No item says clothing changes the outcome of a case.
 */
import type { SourceId } from './guideSources';

export type GuideSectionId = 'wear' | 'bring' | 'security' | 'inside' | 'say' | 'children' | 'late' | 'after';
/** A button under a section that opens another part of the app. */
export type GuideLink = 'rights' | 'missed' | 'court_dates';

export interface GuideSection {
  id: GuideSectionId;
  /** Number of items: cgd_<id>_1 … cgd_<id>_<count>. */
  count: number;
  sources: SourceId[];
  links?: GuideLink[];
  /** An extra note under the items (no source: a suggestion of whom to ask). */
  noteKey?: string;
}

export const COURT_GUIDE: readonly GuideSection[] = Object.freeze([
  { id: 'wear',     count: 6, sources: ['tn_dhs', 'tx_help', 'or_yamhill'], noteKey: 'cgd_wear_help' },
  { id: 'bring',    count: 6, sources: ['nash_gs_security', 'ne_judicial', 'tn_dhs'] },
  { id: 'security', count: 4, sources: ['hamilton_gs', 'nash_gs_security', 'ny_tips'] },
  { id: 'inside',   count: 6, sources: ['or_yamhill', 'tn_dhs', 'tx_help', 'ny_tips', 'ne_judicial'] },
  { id: 'say',      count: 5, sources: ['allegheny_pd', 'de_ocd', 'pinal_pd', 'shelby_da', 'mn_lprb'], links: ['rights'] },
  { id: 'children', count: 2, sources: ['tn_dhs', 'tx_help', 'or_yamhill', 'ne_judicial'] },
  { id: 'late',     count: 3, sources: ['pinal_pd', 'tn_dhs', 'allegheny_pd', 'ny_tips'], links: ['missed'] },
  { id: 'after',    count: 3, sources: ['ny_tips'], links: ['court_dates'] },
]);

export const guideItemKeys = (s: GuideSection): string[] => Array.from({ length: s.count }, (_, i) => `cgd_${s.id}_${i + 1}`);

/** What a court's posted-rules page covers (backend data/court_rules.js COVERS). */
export const COVER_KEYS: Readonly<Record<string, string>> = Object.freeze({
  dress: 'cgd_cover_dress', security: 'cgd_cover_security', phones: 'cgd_cover_phones', food: 'cgd_cover_food', conduct: 'cgd_cover_conduct',
});
export interface CourtRule { id: string; court: string; title: string; covers: string[]; url: string; checked: string }
