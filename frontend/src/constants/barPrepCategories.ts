/**
 * barPrepCategories.ts — names of the MBE question categories (quiz_questions.category).
 * Unknown codes read as words ("ucc_article_2" → "Ucc article 2").
 */
import { t, perLang } from '../i18n';

export const CATEGORY_LABELS = perLang((): Record<string, string> => ({
  // Criminal Law
  homicide:             t('x_bar_prep_home_homicide'),
  theft_property:       t('x_bar_prep_home_theft_property'),
  defenses:             t('x_bar_prep_home_defenses'),
  criminal_procedure:   t('x_bar_prep_home_crim_procedure'),
  // Constitutional Law
  fourth_amendment:     t('x_bar_prep_home_4th_amendment'),
  fifth_sixth_amendment:t('x_bar_prep_home_5th_6th_amendment'),
  due_process:          t('x_bar_prep_home_due_process'),
  equal_protection:     t('x_bar_prep_home_equal_protection'),
  first_amendment:      t('x_bar_prep_home_1st_amendment'),
  incorporation_14th:   t('x_bar_prep_home_incorporation_14th'),
  commerce_clause:      t('x_bar_prep_home_commerce_clause'),
  executive_power:      t('x_bar_prep_home_executive_power'),
  takings_clause:       t('x_bar_prep_home_takings_clause'),
  // Contracts
  formation:            t('x_bar_prep_home_contract_formation'),
  consideration:        t('x_bar_prep_home_consideration'),
  performance_breach:   t('x_bar_prep_home_performance_breach'),
  remedies:             t('x_bar_prep_home_remedies'),
  contract_defenses:    t('x_bar_prep_home_contract_defenses'),
  ucc_article_2:        t('x_bar_prep_home_ucc_article_2'),
  // Civil Procedure
  jurisdiction:         t('x_bar_prep_home_jurisdiction'),
  pleading:             t('x_bar_prep_home_pleading'),
  discovery_civ_pro:    t('x_motion_type_badge_discovery'),
  summary_judgment:     t('x_bar_prep_home_summary_judgment'),
  trial:                t('hearing_trial'),
  preclusion:           t('x_bar_prep_home_preclusion'),
  venue:                t('x_bar_prep_home_venue'),
  class_actions:        t('x_bar_prep_home_class_actions'),
  appeals:              t('x_bar_prep_home_appeals'),
  // Evidence
  relevance:            t('x_bar_prep_home_relevance'),
  character_evidence:   t('x_bar_prep_home_character_evidence'),
  hearsay:              t('x_bar_prep_home_hearsay'),
  hearsay_exceptions:   t('x_bar_prep_home_hearsay_exceptions'),
  impeachment:          t('x_bar_prep_home_impeachment'),
  privileges:           t('x_bar_prep_home_privileges'),
  expert_witnesses:     t('x_bar_prep_home_expert_witnesses'),
  authentication:       t('x_bar_prep_home_authentication'),
  // Real Property
  ownership:            t('x_bar_prep_home_ownership'),
  concurrent_ownership: t('x_bar_prep_home_concurrent_ownership'),
  landlord_tenant:      t('x_bar_prep_home_landlord_tenant'),
  recording_acts:       t('x_bar_prep_home_recording_acts'),
  adverse_possession:   t('x_bar_prep_home_adverse_possession'),
  easements:            t('x_bar_prep_home_easements'),
  covenants:            t('x_bar_prep_home_covenants'),
  mortgages:            t('x_bar_prep_home_mortgages'),
  // Torts
  intentional_torts:    t('x_bar_prep_home_intentional_torts'),
  negligence:           t('x_bar_prep_home_negligence'),
  strict_liability:     t('x_bar_prep_home_strict_liability'),
  products_liability:   t('x_bar_prep_home_products_liability'),
  defamation:           t('x_bar_prep_home_defamation'),
  nuisance:             t('x_bar_prep_home_nuisance'),
  damages_torts:        t('x_bar_prep_home_damages'),
}));

export function categoryLabel(code: string | null | undefined): string {
  const c = String(code || '');
  const known = CATEGORY_LABELS()[c];
  if (known) return known;
  const words = c.replace(/_/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}
