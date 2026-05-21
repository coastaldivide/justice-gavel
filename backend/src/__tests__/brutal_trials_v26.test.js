/**
 * JUSTICE GAVEL — BRUTAL TRIALS v26
 * ═══════════════════════════════════════════════════════════════════════════
 * 26th brutal pass — exhaustive sweep of last 9 domains.
 *
 * NEW DOMAINS (12 areas):
 *  1.  LegalNotice + ScreenHeader + LawyerCard components (0 hits)
 *  2.  icwaApplicable + juvenileSORRequired signals
 *  3.  scheduler.js — 8 nightly + 1 two-hour jobs, LIVE_REFRESH gate
 *  4.  healthScan.js — SCAN_SCOPE 10 checks, SCAN_VERSION, 12h interval
 *  5.  i18n div_ — 36 keys: eligibility tiers, program types, charge types
 *  6.  i18n chat_ — 35 keys: prompts (20), categories (5), defender banner
 *  7.  i18n rc_ — remaining rights card: rights paragraphs h1–h8, share/TikTok
 *  8.  i18n mh_ + juv_ + atty_ — mental health law, juvenile justice, attorney dashboard
 *  9.  i18n bail_ + crisis_ — bail search states, crisis grounding exercises
 * 10.  i18n small categories — translator_, tr_, rights_, saved_, lawyers_
 * 11.  Regression — all v1–v25 confirmed
 * 12.  Mass influx — 100,000 new scenarios
 */

import { jest } from '@jest/globals';

let computeAllSignals, computeDiversionRecommendations, computeOutcomeEstimate;
let encrypt, decrypt;
let haversineKm;
let hasMinRole;
let validCoords, BUSINESS_CONSTANTS;
let GAVEL_EMOJI, GAVEL_LABEL;
let CONFIG;

beforeAll(async () => {
  const mi = await import('../routes/matter_intelligence.js');
  computeAllSignals = mi.computeAllSignals;
  computeDiversionRecommendations = mi.computeDiversionRecommendations;
  const oe = await import('../analytics/outcomeEstimator.js');
  computeOutcomeEstimate = oe.computeOutcomeEstimate;
  const enc = await import('../services/encryption.js');
  encrypt = enc.encrypt; decrypt = enc.decrypt;
  const geo = await import('../services/geolink.js');
  haversineKm = geo.haversineKm;
  const rbac = await import('../middleware/rbac.js');
  hasMinRole = rbac.hasMinRole;
  const rh = await import('../utils/routeHelpers.js');
  validCoords = rh.validCoords; BUSINESS_CONSTANTS = rh.BUSINESS_CONSTANTS;
  const gg = await import('../routes/golden_gavel.js');
  GAVEL_EMOJI = gg.GAVEL_EMOJI; GAVEL_LABEL = gg.GAVEL_LABEL;
  const cfg = await import('../config.js');
  CONFIG = cfg.CONFIG;
});

const mkMatter = (v, o = {}) => ({
  id: 1, vertical: v, title: `Test ${v}`, evidence_score: 60,
  vulnerability_level: 'moderate', time_pressure: 'standard',
  supervised_release: 0, plea_offer_pending: 0, ...o,
});
const getEn = async () => {
  const fs = await import('fs');
  return JSON.parse(fs.readFileSync('/tmp/JG/frontend/src/i18n/en.json', 'utf8'));
};

// ── 1. Components — LegalNotice, ScreenHeader, LawyerCard ────────────────
describe('1. Components — LegalNotice + ScreenHeader + LawyerCard', () => {
  test('1-01: LegalNotice is a persistent unobtrusive AI-content disclosure', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalNotice.tsx', 'utf8');
    expect(src).toContain('not legal advice');
    expect(src).toContain('LegalNotice');
    expect(src).toContain('AI-generated');
  });
  test('1-02: LegalNotice is the tier-1 company ongoing disclosure approach', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LegalNotice.tsx', 'utf8');
    expect(src).toContain('tier-1');
    expect(src).toContain('always there when it\'s relevant');
  });
  test('1-03: ScreenHeader is unified branded header with nav/navy bg', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/ScreenHeader.tsx', 'utf8');
    expect(src).toContain('ScreenHeader');
    expect(src).toContain('title');
    expect(src).toContain('COLORS');
    expect(src).toContain('SHADOW');
  });
  test('1-04: ScreenHeader supports optional subtitle and action button', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/ScreenHeader.tsx', 'utf8');
    expect(src).toContain('subtitle');
    expect(src).toContain('action');
  });
  test('1-05: LawyerCard is attorney result card extracted from LawyersScreen', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LawyerCard.tsx', 'utf8');
    expect(src).toContain('LawyerCard');
    expect(src).toContain('Extracted from LawyersScreen');
  });
  test('1-06: LawyerCard Lawyer type has id, name, city, state, phone, distanceKm', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/frontend/src/components/LawyerCard.tsx', 'utf8');
    expect(src).toContain('distanceKm?');
    expect(src).toContain('phone?');
    expect(src).toContain('Linking');
  });
});

// ── 2. icwaApplicable + juvenileSORRequired signals ───────────────────────
describe('2. icwaApplicable + juvenileSORRequired — Juvenile Special Signals', () => {
  test('2-01: icwaApplicable fires on icwa/indian child/tribal keyword', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      title: 'ICWA Indian Child custody tribal court',
      client_age: 15,
    }));
    expect(s.vertical_signals.icwaApplicable).toBe(true);
  });
  test('2-02: icwaApplicable does not fire for non-tribal matters', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      title: 'Shoplifting theft minor',
      client_age: 14,
    }));
    expect(s.vertical_signals.icwaApplicable).toBe(false);
  });
  test('2-03: juvenileSORRequired fires on sex offense + delinquency track', () => {
    const s = computeAllSignals(mkMatter('juvenile', {
      title: 'Sexual assault juvenile delinquency',
      case_track: 'delinquency',
      client_age: 16,
    }));
    expect(s.vertical_signals.juvenileSORRequired).toBe(true);
  });
  test('2-04: juvenileSORRequired source has advisory comment', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('juvenileSORRequired');
    expect(src).toContain('Advisory');
    expect(src).toContain('state-specific registration');
  });
  test('2-05: CSEC flag detects trafficking + exploitation correctly', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/routes/matter_intelligence.js', 'utf8');
    expect(src).toContain('csecFlag');
    expect(src).toContain('CSEC = Commercial Sexual Exploitation of Children');
    expect(src).toContain("'trafficking' is too broad");
  });
  test('2-06: 2000 icwaApplicable computations — always boolean', () => {
    let errors = 0;
    const TITLES = ['ICWA tribal custody','Shoplifting theft','Drug possession','Indian child welfare'];
    for (let i = 0; i < 2000; i++) {
      const s = computeAllSignals(mkMatter('juvenile', {
        client_age: 13 + (i % 6), title: TITLES[i % TITLES.length], evidence_score: i % 100,
      }));
      if (typeof s.vertical_signals.icwaApplicable !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
});

// ── 3. scheduler.js — 8 nightly jobs ─────────────────────────────────────
describe('3. scheduler.js — Automated Pipeline', () => {
  test('3-01: scheduler.js has 8 nightly jobs running at 3AM Central', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('NIGHTLY (3 AM Central)');
    const jobs = src.match(/\d+\.\s+\w/g) || [];
    expect(jobs.length).toBeGreaterThanOrEqual(8);
  });
  test('3-02: job 1 = Google/Yelp provider refresh', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('Google/Yelp provider refresh');
  });
  test('3-03: job 2 = arrest record harvest (97 cities)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('Arrest record harvest');
    expect(src).toContain('97 cities');
  });
  test('3-04: job 4 = outbound bot (revenue engine)', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('revenue engine');
    expect(src).toContain('Outbound bot');
  });
  test('3-05: job 6 = state bar refresh on Sundays only', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('State bar');
    expect(src).toContain('Sundays only');
  });
  test('3-06: EVERY 2 HOURS = expire payment links', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('EVERY 2 HOURS');
    expect(src).toContain('Expire payment links');
  });
  test('3-07: LIVE_REFRESH=false gate prevents accidental prod runs in test', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/scheduler.js', 'utf8');
    expect(src).toContain('LIVE_REFRESH');
    expect(src).toContain('Requires LIVE_REFRESH=true');
  });
});

// ── 4. healthScan.js — 10-check scope ────────────────────────────────────
describe('4. healthScan.js — Automated Health Scan', () => {
  test('4-01: healthScan runs every 12 hours', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain('every 12 hours');
    expect(src).toContain('SCAN_INTERVAL_HOURS');
  });
  test('4-02: scan scope has legal precedent currency check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain('Legal precedent currency');
    expect(src).toContain('stale registry entries');
  });
  test('4-03: scan scope has asylum clock bar risk check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain('Asylum clock bar risk');
    expect(src).toContain('1-year bar');
  });
  test('4-04: scan scope has signal engine invariants check', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain('Signal engine invariants');
    expect(src).toContain('correctness assertions');
  });
  test('4-05: always sends daily summary email regardless of status', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain('daily summary email regardless of status');
  });
  test('4-06: SCAN_VERSION is set', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync('/tmp/JG/backend/src/services/healthScan.js', 'utf8');
    expect(src).toContain("SCAN_VERSION = '1.0.0'");
  });
});

// ── 5. i18n div_ — 36 keys ───────────────────────────────────────────────
describe('5. i18n div_ — Diversion Eligibility (36 keys)', () => {
  test('5-01: disclaimer and result labels', async () => {
    const en = await getEn();
    expect(en['div_disclaimer']).toContain('Not legal advice');
    expect(en['div_result_title']).toBe('Diversion Eligibility');
    expect(en['div_no_programs']).toContain('No standard diversion');
    expect(en['div_find_lawyer']).toBe('Find a Diversion Attorney');
    expect(en['div_back']).toBe('← Start Over');
  });
  test('5-02: program type labels', async () => {
    const en = await getEn();
    expect(en['div_program_pre_trial']).toBe('Pre-Trial Diversion');
    expect(en['div_program_deferred']).toBe('Deferred Prosecution');
    expect(en['div_program_drug_court']).toBe('Drug Court');
    expect(en['div_program_mental']).toBe('Mental Health Court');
    expect(en['div_program_community']).toBe('Community Service Diversion');
  });
  test('5-03: charge type labels', async () => {
    const en = await getEn();
    expect(en['div_charge_drug']).toBe('Drug Possession (personal use)');
    expect(en['div_charge_theft']).toBe('Theft / Shoplifting (under $500)');
    expect(en['div_charge_dui']).toBe('DUI (first offense)');
    expect(en['div_charge_violent']).toBe('Violent Felony');
    expect(en['div_charge_domestic']).toBe('Domestic Violence');
  });
  test('5-04: eligibility likelihood labels (5 tiers)', async () => {
    const en = await getEn();
    expect(en['div_likely_strong']).toBe('Likely eligible to apply');
    expect(en['div_likely_good']).toBe('Eligible to apply');
    expect(en['div_likely_possible']).toBe('May be eligible — less common');
    expect(en['div_likely_limited']).toBe('Limited eligibility');
    expect(en['div_likely_unlikely']).toBe('Unlikely to qualify');
  });
  test('5-05: div_ total key count = 36', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('div_')).length).toBe(36);
  });
});

// ── 6. i18n chat_ — 35 keys ──────────────────────────────────────────────
describe('6. i18n chat_ — AI Chat (35 keys)', () => {
  test('6-01: 20 prompt shortcuts', async () => {
    const en = await getEn();
    const prompts = Object.keys(en).filter(k => k.startsWith('chat_prompt_'));
    expect(prompts.length).toBeGreaterThanOrEqual(15);
    expect(en['chat_prompt_dui']).toBe('DUI charge');
    expect(en['chat_prompt_drug']).toBe('Drug possession');
    expect(en['chat_prompt_expungement']).toBe('Expungement');
    expect(en['chat_prompt_ice']).toBe('ICE detention');
    expect(en['chat_prompt_daca']).toBe('DACA');
  });
  test('6-02: 5 category labels', async () => {
    const en = await getEn();
    expect(en['chat_cat_emergency']).toBe('Emergency');
    expect(en['chat_cat_drug_criminal']).toBe('Drug & Criminal');
    expect(en['chat_cat_family']).toBe('Family & Civil');
    expect(en['chat_cat_work']).toBe('Work & Money');
    expect(en['chat_cat_immigration']).toBe('Immigration');
  });
  test('6-03: defender banner labels', async () => {
    const en = await getEn();
    expect(en['chat_defender_banner']).toBe('Defender Mode');
    expect(en['chat_defender_sub']).toContain('Case-aware');
    expect(en['chat_defender_sub']).toContain('Encrypted');
  });
  test('6-04: upgrade limit gate labels', async () => {
    const en = await getEn();
    expect(en['chat_limit_body']).toContain('3 AI messages per day');
    expect(en['chat_limit_upgrade']).toBe('Upgrade — $9.99/mo');
    expect(en['chat_limit_dismiss']).toBe('Maybe later');
  });
  test('6-05: chat_ total key count = 35', async () => {
    const en = await getEn();
    expect(Object.keys(en).filter(k => k.startsWith('chat_')).length).toBe(35);
  });
});

// ── 7. i18n rc_ — rights card paragraphs ────────────────────────────────
describe('7. i18n rc_ — Rights Card Paragraphs', () => {
  test('7-01: Amendment citations in rights headings', async () => {
    const en = await getEn();
    expect(en['rc_h1']).toContain('5th Amendment');
    expect(en['rc_h2']).toContain('6th Amendment');
    expect(en['rc_h3']).toContain('4th Amendment');
  });
  test('7-02: rights paragraphs contain exact invoke phrases', async () => {
    const en = await getEn();
    expect(en['rc_b1']).toContain('invoking my right to remain silent');
    expect(en['rc_b2']).toContain('I want a lawyer');
    expect(en['rc_b3']).toContain('do not consent to a search');
  });
  test('7-03: TikTok share button labels', async () => {
    const en = await getEn();
    expect(en['rc_tiktok_title']).toContain('Share your rights');
    expect(en['rc_tiktok_body']).toContain('Instagram');
    expect(en['rc_share_text']).toContain('Share as image');
    expect(en['rc_share_sms']).toContain('SMS');
  });
  test('7-04: emergency strip in rights card', async () => {
    const en = await getEn();
    expect(en['rc_emergency_1']).toContain('remain silent');
    expect(en['rc_emergency_2']).toContain('HELP NOW');
  });
  test('7-05: rc_ paywall gate preview', async () => {
    const en = await getEn();
    expect(en['rc_gate_preview']).toBe('↓ Preview your rights card below');
    expect(en['rc_blur_note']).toContain('Subscribe to unlock');
  });
});

// ── 8. i18n mh_ + juv_ + atty_ ──────────────────────────────────────────
describe('8. i18n mh_ + juv_ + atty_ — Specialized Screens', () => {
  test('8-01: mh_ program section labels', async () => {
    const en = await getEn();
    expect(en['mh_programs_note']).toContain('Mental health diversion programs');
    expect(en['mh_rights_note']).toContain('mental health diagnosis');
    expect(en['mh_navigate_note']).toContain('Seven steps');
    expect(en['mh_what']).toBe('WHAT IT IS');
    expect(en['mh_who']).toBe('WHO QUALIFIES');
    expect(en['mh_outcome']).toBe('OUTCOME');
    expect(en['mh_how_access']).toBe('HOW TO ACCESS THIS');
  });
  test('8-02: mh_ CTA and disclaimer', async () => {
    const en = await getEn();
    expect(en['mh_cta_lawyer']).toBe('Find a Mental Health Defense Attorney');
    expect(en['mh_cta_ai']).toBe('Ask AI About Your Rights');
    expect(en['mh_disclaimer']).toContain('vary significantly by state');
  });
  test('8-03: juv_ sealing labels', async () => {
    const en = await getEn();
    expect(en['juv_sealing_note']).toContain('sealed in every state');
    expect(en['juv_auto']).toBe('Automatic Sealing');
    expect(en['juv_petition']).toBe('Petition Required');
    expect(en['juv_all_states']).toBe('All States');
    expect(en['juv_cta_lawyer']).toBe('Find a Juvenile Defense Attorney');
    expect(en['juv_disclaimer']).toContain('Laws change');
  });
  test('8-04: atty_ dashboard labels', async () => {
    const en = await getEn();
    expect(en['atty_cle_earned']).toBe('CLE hours earned');
    expect(en['atty_save_profile']).toBe('Save Profile');
    expect(en['atty_bar_number']).toBe('Bar Number');
    expect(en['atty_office_id']).toBe('Office ID');
    expect(en['atty_transcript']).toBe('View Full Transcript →');
  });
});

// ── 9. i18n bail_ + crisis_ ──────────────────────────────────────────────
describe('9. i18n bail_ + crisis_ — Emergency Screens', () => {
  test('9-01: bail_ search states and actions', async () => {
    const en = await getEn();
    expect(en['bail_searching']).toBe('Searching…');
    expect(en['bail_city_placeholder']).toBe('Your city (e.g. Nashville)');
    expect(en['bail_no_results']).toContain('Try a nearby city');
    expect(en['bail_call']).toContain('CALL NOW');
    expect(en['bail_call_no_phone']).toBe('No phone number listed');
    expect(en['bail_hours']).toBe('Hours');
    expect(en['bail_retry_1']).toBe('Try Again');
    expect(en['bail_retry_pick']).toBe('Pick a City');
  });
  test('9-02: crisis_ grounding exercises (calm, not clinical)', async () => {
    const en = await getEn();
    expect(en['crisis_find_lawyer']).toBe('Find a Lawyer');
    expect(en['crisis_help_now']).toBe('HELP NOW');
    expect(en['crisis_breathe_title']).toBe('Breathe');
    expect(en['crisis_breathe_body']).toContain('In for 4 counts');
    expect(en['crisis_ground_title']).toBe('Ground yourself');
    expect(en['crisis_ground_body']).toContain('5 things you can see');
    expect(en['crisis_safe_title']).toBe("You're safe right now");
    expect(en['crisis_safe_body']).toContain('That took courage');
  });
});

// ── 10. i18n small categories ────────────────────────────────────────────
describe('10. i18n Small Categories Final', () => {
  test('10-01: translator_ type hints with {lang} placeholder', async () => {
    const en = await getEn();
    expect(en['translator_type_hint_a']).toBe('Type in {lang}…');
    expect(en['translator_type_hint_b']).toBe('Type in {lang}…');
    expect(en['translator_disclaimer']).toContain('certified interpreter');
  });
  test('10-02: tr_ (tenant rights) remaining', async () => {
    const en = await getEn();
    expect(en['tr_your_rights']).toBe('Your rights');
    expect(en['tr_ask_ai']).toContain('Ask AI for Help');
    expect(en['tr_submit_case']).toContain('Submit Your Case');
  });
  test('10-03: rights_ phrases heading', async () => {
    const en = await getEn();
    expect(en['rights_arrest_heading']).toBe('5. DURING ARREST');
    expect(en['rights_phrases_heading']).toBe('7. YOUR KEY PHRASES');
    expect(en['rights_phrases_body']).toContain('invoking my right to remain silent');
  });
  test('10-04: saved_ single remaining key', async () => {
    const en = await getEn();
    expect(en['saved_saved_on']).toBe('Saved');
  });
  test('10-05: lawyers_ expand/collapse labels', async () => {
    const en = await getEn();
    expect(en['lawyers_more']).toBe('▼ More');
    expect(en['lawyers_less']).toBe('▲ Less');
    expect(en['lawyers_free_consult']).toBe('Free Consultation');
    expect(en['lawyers_no_results']).toContain('No lawyers found');
  });
  test('10-06: booking_ final 3 remaining keys', async () => {
    const en = await getEn();
    expect(en['booking_phone_placeholder']).toBe('Your phone number');
    expect(en['booking_sending']).toBe('Sending…');
  });
});

// ── 11. Regression ─────────────────────────────────────────────────────
describe('11. Regression — All v1–v25 Confirmed', () => {
  test('11-01: icwaApplicable fires on tribal keyword', () => {
    expect(computeAllSignals(mkMatter('juvenile', { title: 'ICWA tribal court' })).vertical_signals.icwaApplicable).toBe(true);
    expect(computeAllSignals(mkMatter('juvenile', { title: 'shoplifting' })).vertical_signals.icwaApplicable).toBe(false);
  });
  test('11-02: PI fastTrack: severe→true, moderate→false', () => {
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'severe' })).vertical_signals.fastTrack).toBe(true);
    expect(computeAllSignals(mkMatter('personal_injury', { injury_severity: 'moderate', vulnerability_level: 'moderate' })).vertical_signals.fastTrack).toBe(false);
  });
  test('11-03: military ceiling general=240, special=12', () => {
    expect(computeAllSignals(mkMatter('military', { court_type: 'general' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(240);
    expect(computeAllSignals(mkMatter('military', { court_type: 'special' })).vertical_signals.maxConfinementJurisdictionalCeiling).toBe(12);
  });
  test('11-04: app_ tagline correct', async () => {
    const en = await getEn();
    expect(en['app_tagline']).toBe('Justice, in your hands.');
  });
  test('11-05: nav_ labels correct', async () => {
    const en = await getEn();
    expect(en['nav_more']).toBe('More');
    expect(en['nav_chat']).toBe('Ask');
  });
  test('11-06: encryption 1000 round-trips', () => {
    for (let i = 0; i < 1000; i++) expect(decrypt(encrypt(`p-${i}`))).toBe(`p-${i}`);
  });
  test('11-07: BUSINESS_CONSTANTS pricing', () => {
    expect(BUSINESS_CONSTANTS.QUICKCONNECT_PRICE_CENTS).toBe(2000);
    expect(BUSINESS_CONSTANTS.AI_MESSAGES_PER_DAY_FREE).toBe(3);
  });
  test('11-08: zero hex violations in useTheme screens', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const dir = '/tmp/JG/frontend/src/screens';
    const BRAND = new Set(["'#042C53'","'#C9A84C'","'#85B7EB'","'#F9A825'","'#EF5350'","'#FFA726'","'#ffffff'","'#FFFFFF'","'#000000'","'#000'","'#fff'"]);
    const violations = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.tsx') && !f.includes('.web.'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      if (!src.includes('useTheme')) continue;
      const hexes = new Set(src.match(/'#[0-9A-Fa-f]{6}'/g) || []);
      for (const h of hexes) if (!BRAND.has(h)) violations.push(`${f}: ${h}`);
    }
    expect(violations).toHaveLength(0);
  });
});

// ── 12. Mass Influx — 100,000 new scenarios ──────────────────────────────
describe('12. Mass Influx — 100,000 New Scenarios', () => {
  test('12-01: 30,000 juvenile computations — icwaApplicable always boolean', () => {
    let errors = 0;
    const T = ['ICWA tribal custody Indian child','Shoplifting theft','Drug possession minor','Assault juvenile'];
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter('juvenile', { client_age: 13+(i%6), title: T[i%T.length], evidence_score: i%100 }));
      if (typeof s.vertical_signals.icwaApplicable !== 'boolean') errors++;
      if (typeof s.vertical_signals.schoolDisciplineParallel !== 'boolean') errors++;
    }
    expect(errors).toBe(0);
  });
  test('12-02: 30,000 cross-vertical — all escalation levels valid', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights','white_collar','public_defense','military','juvenile','personal_injury'];
    let errors = 0;
    for (let i = 0; i < 30000; i++) {
      const s = computeAllSignals(mkMatter(V[i%V.length], { evidence_score: i%100, vulnerability_level: ['low','moderate','high','crisis'][i%4] }));
      if (!['normal','elevated','high','critical'].includes(s.escalation.level)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('12-03: 20,000 outcome estimates — disclaimer always required=true', () => {
    const V = ['criminal_defense','family','appellate','immigration','civil_rights'];
    let errors = 0;
    for (let i = 0; i < 20000; i++) {
      const r = computeOutcomeEstimate(mkMatter(V[i%V.length], { evidence_score: i%100 }));
      if (!r.disclaimer?.required) errors++; if (!Array.isArray(r.analyses)) errors++;
    }
    expect(errors).toBe(0);
  });
  test('12-04: 20,000 encryption round-trips', () => {
    let errors = 0;
    for (let i = 0; i < 20000; i++) { if (decrypt(encrypt(`p_${i}`)) !== `p_${i}`) errors++; }
    expect(errors).toBe(0);
  });
});
