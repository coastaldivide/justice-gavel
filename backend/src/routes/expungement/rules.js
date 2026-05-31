/**
 * expungement/rules.js — State expungement eligibility rules data
 *
 * Data-only module. No router. Imported by all expungement sub-routers.
 * Update quarterly from CCRC or after state legislative sessions.
 */

const STATE_RULES = {
  // ── Southeast ─────────────────────────────────────────────────────────────
  TN: {
    name: 'Tennessee',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Class A & B misdemeanors eligible after 5 years. T.C.A. § 40-32-101.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class E felonies (first-time, non-violent) eligible after 5 years. T.C.A. § 40-32-101(g).' },
    dui:         { eligible: 'conditional', waitYears: 5, note: 'First-offense DUI may be eligible after 5 years under T.C.A. § 40-32-101.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible at any time. T.C.A. § 40-32-101(a)(1).' },
    domestic:    { eligible: false,                       note: 'Domestic violence convictions not expungeable in Tennessee.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible for expungement in Tennessee.' },
  },
  FL: {
    name: 'Florida',
    misdemeanor: { eligible: 'conditional', waitYears: 10, note: 'Florida allows sealing after 10 years for first-time offenders with no prior record. F.S. § 943.059.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Only non-violent, first-time felonies may be eligible for sealing. Expungement after sealing requires 10+ years. F.S. § 943.0585.' },
    dui:         { eligible: false,                        note: 'DUI convictions are not eligible for expungement or sealing in Florida.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Charges dismissed without adjudication are eligible for expungement. F.S. § 943.0585.' },
    domestic:    { eligible: false,                        note: 'Domestic violence charges not eligible for sealing or expungement in Florida.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Florida.' },
  },
  GA: {
    name: 'Georgia',
    misdemeanor: { eligible: 'conditional', waitYears: 4, note: 'First offender misdemeanors may be restricted after 4 years. O.C.G.A. § 35-3-37.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'First offender felonies (non-violent, not sex offenses) may be restricted under O.C.G.A. § 42-8-62.' },
    dui:         { eligible: false,                       note: 'DUI convictions are not eligible for expungement or restriction in Georgia.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges are eligible for restriction. O.C.G.A. § 35-3-37.' },
    domestic:    { eligible: false,                       note: 'Family violence offenses not eligible in Georgia.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Georgia.' },
  },
  NC: {
    name: 'North Carolina',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-time misdemeanors eligible after 5 years. G.S. § 15A-145.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Certain non-violent Class H and I felonies eligible after 10 years. G.S. § 15A-145.5.' },
    dui:         { eligible: false,                        note: 'DWI convictions not eligible for expungement in North Carolina.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed charges immediately eligible. G.S. § 15A-146.' },
    domestic:    { eligible: false,                        note: 'Domestic violence offenses not eligible in North Carolina.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in North Carolina.' },
  },
  SC: {
    name: 'South Carolina',
    misdemeanor: { eligible: 'conditional', waitYears: 3, note: 'First-offense misdemeanors eligible after 3 years. S.C. Code § 22-5-910.' },
    felony:      { eligible: false,                       note: 'Felony convictions are generally not eligible for expungement in South Carolina.' },
    dui:         { eligible: false,                       note: 'DUI convictions not eligible in South Carolina.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and nolle prosequi charges eligible immediately. S.C. Code § 17-1-40.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible in South Carolina.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in South Carolina.' },
  },
  VA: {
    name: 'Virginia',
    misdemeanor: { eligible: 'conditional', waitYears: 7, note: 'Virginia Clean Slate Law (VA Code § 19.2-392.12) effective July 1, 2026. Sealing available for misdemeanors after 7 years offense-free. Probation violations no longer bar eligibility per 2025 amendment. Automatic sealing of dismissed charges began July 1, 2025.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Limited non-violent felony sealing after 10 years under 2021 Clean Slate Act. Va. Code § 19.2-392.6.' },
    dui:         { eligible: false,                        note: 'DUI not eligible under Virginia sealing law.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Charges dismissed, nolle prosequi, or acquitted eligible immediately. Va. Code § 19.2-392.2.' },
    domestic:    { eligible: false,                        note: 'Family abuse offenses not eligible in Virginia.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Virginia.' },
  },
  AL: {
    name: 'Alabama',
    misdemeanor: { eligible: 'conditional', waitYears: 5, note: 'First-time misdemeanors may be eligible after 5 years under Ala. Code § 15-27-2.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Certain non-violent Class C felonies may be eligible. Ala. Code § 15-27-2.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Alabama.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. Ala. Code § 15-27-1.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible in Alabama.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Alabama.' },
  },
  MS: {
    name: 'Mississippi',
    misdemeanor: { eligible: 'conditional', waitYears: 5, note: 'First-time misdemeanor offenders may petition after 5 years. Miss. Code § 99-19-71.' },
    felony:      { eligible: false,                       note: 'Felony convictions are not eligible for expungement in Mississippi.' },
    dui:         { eligible: false,                       note: 'DUI not eligible in Mississippi.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Nolle prosequi and dismissed charges eligible. Miss. Code § 99-15-59.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible in Mississippi.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Mississippi.' },
  },
  AR: {
    name: 'Arkansas',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-offense misdemeanors eligible after 5 years. Petition-based expungement available under Ark. Code § 16-90-1417. Arkansas Act 990 of 2021 expanded eligibility; automatic sealing for certain non-convictions began 2023.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class C, D, and unclassified felonies eligible after 5 years for first offenders. Ark. Code § 16-90-1417.' },
    dui:         { eligible: false,                       note: 'DWI not eligible for expungement in Arkansas.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. Ark. Code § 16-90-1417.' },
    domestic:    { eligible: false,                       note: 'Domestic battering offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Arkansas.' },
  },
  LA: {
    name: 'Louisiana',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-offense misdemeanors eligible after 5 years. La. C.Cr.P. art. 977.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Certain non-violent felonies eligible after 10 years. La. C.Cr.P. art. 977.' },
    dui:         { eligible: false,                        note: 'DWI not eligible for expungement in Louisiana.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Charges with no conviction eligible immediately. La. C.Cr.P. art. 976.' },
    domestic:    { eligible: false,                        note: 'Domestic abuse offenses not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Louisiana.' },
  },
  KY: {
    name: 'Kentucky',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Class B misdemeanors eligible after 5 years. KRS § 431.078.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class D felonies (non-violent, non-sexual) eligible after 5 years. KRS § 431.073.' },
    dui:         { eligible: false,                       note: 'DUI convictions not eligible for expungement in Kentucky.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. KRS § 431.076.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible in Kentucky.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Kentucky.' },
  },
  WV: {
    name: 'West Virginia',
    misdemeanor: { eligible: true,          waitYears: 1, note: 'First-offense misdemeanors eligible after 1 year. W. Va. Code § 61-11-26.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'First-offense non-violent felonies may be eligible. W. Va. Code § 61-11-26.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in West Virginia.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. W. Va. Code § 61-11-25.' },
    domestic:    { eligible: false,                       note: 'Domestic violence convictions not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in West Virginia.' },
  },

  // ── Northeast ────────────────────────────────────────────────────────────
  NY: {
    name: 'New York',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Sealed under CPL § 160.59 after 3 years. Sealing (not expungement) limits access by employers.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Up to 2 sealed convictions (max 1 felony) after 10 years. CPL § 160.59.' },
    dui:         { eligible: false,                        note: 'DWI/DUI convictions not eligible for sealing in New York.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed charges sealed automatically or by motion. CPL § 160.50.' },
    domestic:    { eligible: false,                        note: 'Domestic violence offenses listed in CPL § 160.59(3) not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible for sealing in New York.' },
  },
  PA: {
    name: 'Pennsylvania',
    misdemeanor: { eligible: 'conditional', waitYears: 10, note: 'Misdemeanor sealing (limited access) after 10 crime-free years. 18 Pa.C.S. § 9122.1.' },
    felony:      { eligible: false,                        note: 'Felony convictions generally not eligible for sealing or expungement in Pennsylvania.' },
    dui:         { eligible: false,                        note: 'DUI not eligible for sealing or expungement in Pennsylvania.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Charges not resulting in conviction eligible for expungement. 18 Pa.C.S. § 9122.' },
    domestic:    { eligible: false,                        note: 'Domestic violence offenses not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Pennsylvania.' },
  },
  NJ: {
    name: 'New Jersey',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Most disorderly persons offenses eligible after 5 years. N.J.S.A. 2C:52-3.' },
    felony:      { eligible: 'conditional', waitYears: 6, note: 'Most indictable offenses (felonies) eligible after 6 years under N.J.S.A. 2C:52-2.' },
    dui:         { eligible: false,                       note: 'DUI/DWI not eligible for expungement in New Jersey.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and not-guilty charges eligible at any time. N.J.S.A. 2C:52-6.' },
    domestic:    { eligible: false,                       note: 'Domestic violence charges not eligible under N.J.S.A. 2C:52-2.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in New Jersey.' },
  },
  MA: {
    name: 'Massachusetts',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Petition-based sealing after 3 years under M.G.L. c. 276, § 100A. Non-convictions and dismissed charges seal immediately under § 100C. Massachusetts does not use the term expungement — the remedy is sealing, which limits access but does not destroy the record.' },
    felony:      { eligible: true,          waitYears: 7, note: 'Felonies eligible after 7 years. M.G.L. c. 276, § 100A.' },
    dui:         { eligible: false,                       note: 'OUI (DUI) convictions not eligible for expungement in Massachusetts.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible for sealing immediately. M.G.L. c. 276, § 100C.' },
    domestic:    { eligible: false,                       note: 'Domestic assault and battery not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Massachusetts.' },
  },
  CT: {
    name: 'Connecticut',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'First-offense misdemeanors eligible for erasure after 3 years. C.G.S. § 54-142a.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Certain felonies eligible after 5 years under Connecticut Clean Slate Act. C.G.S. § 54-142u.' },
    dui:         { eligible: false,                       note: 'DUI/OUI not eligible for erasure in Connecticut.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Nolle prosequi and dismissed charges automatically erased after 13 months. C.G.S. § 54-142a.' },
    domestic:    { eligible: false,                       note: 'Family violence crimes not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Connecticut.' },
  },
  RI: {
    name: 'Rhode Island',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-offense misdemeanors eligible after 5 years. R.I. Gen. Laws § 12-1.3-2.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Certain non-violent felonies eligible after 5 years. R.I. Gen. Laws § 12-1.3-2.' },
    dui:         { eligible: false,                       note: 'DUI not eligible in Rhode Island.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. R.I. Gen. Laws § 12-1.3-2.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Rhode Island.' },
  },
  VT: {
    name: 'Vermont',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. 13 V.S.A. § 7602.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Non-violent felonies may be eligible after 10 years. 13 V.S.A. § 7602.' },
    dui:         { eligible: false,                        note: 'DUI not eligible in Vermont.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed charges eligible immediately.' },
    domestic:    { eligible: false,                        note: 'Domestic assault not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Vermont.' },
  },
  NH: {
    name: 'New Hampshire',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Class A & B misdemeanors eligible after 3 years. N.H. RSA § 651:5.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class B felonies (first-time, non-violent) may be eligible after 5 years. N.H. RSA § 651:5.' },
    dui:         { eligible: false,                       note: 'DWI not eligible for annulment in New Hampshire.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. N.H. RSA § 651:5.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in New Hampshire.' },
  },
  ME: {
    name: 'Maine',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Class D and E crimes eligible for expungement after 3 years. 15 M.R.S. § 2264-A.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class C crimes (lower-level felonies) may be eligible after 5 years under Maine Clean Slate.' },
    dui:         { eligible: false,                       note: 'OUI not eligible for expungement in Maine.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. 15 M.R.S. § 2264-A.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Maine.' },
  },

  // ── Midwest ──────────────────────────────────────────────────────────────
  IL: {
    name: 'Illinois',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Most misdemeanors eligible after 3 years. 20 ILCS 2630/5.2.' },
    felony:      { eligible: 'conditional', waitYears: 4, note: 'Class 3 and 4 felonies eligible under Illinois Clean Slate Act after 4 years. 20 ILCS 2630/5.2.' },
    dui:         { eligible: false,                       note: 'DUI convictions not eligible for expungement in Illinois.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Arrests not resulting in conviction eligible for immediate expungement. 20 ILCS 2630/5.2.' },
    domestic:    { eligible: false,                       note: 'Domestic battery not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Illinois.' },
  },
  OH: {
    name: 'Ohio',
    misdemeanor: { eligible: true,          waitYears: 1, note: 'First-offense misdemeanors eligible after 1 year. R.C. § 2953.32.' },
    felony:      { eligible: 'conditional', waitYears: 3, note: 'F4 and F5 felonies (first-time) may be eligible after 3 years. R.C. § 2953.32.' },
    dui:         { eligible: false,                       note: 'OVI (DUI) convictions not eligible for sealing in Ohio.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and no-billed charges eligible immediately. R.C. § 2953.52.' },
    domestic:    { eligible: false,                       note: 'Domestic violence convictions not eligible in Ohio.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Ohio.' },
  },
  MI: {
    name: 'Michigan',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years under Michigan Clean Slate. MCL § 780.621.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Most felonies eligible after 7 years under Michigan Clean Slate (2021). MCL § 780.621.' },
    dui:         { eligible: false,                       note: 'OWI (DUI) not eligible for expungement in Michigan.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible for expungement. MCL § 780.621.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible in Michigan.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Michigan.' },
  },
  IN: {
    name: 'Indiana',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. IC § 35-38-9-2.' },
    felony:      { eligible: 'conditional', waitYears: 8, note: 'Level 6 felonies (lowest) eligible after 8 years. IC § 35-38-9-4.' },
    dui:         { eligible: false,                       note: 'OWI (DUI) not eligible for expungement in Indiana.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Arrests without conviction eligible for restricted access. IC § 35-38-9-1.' },
    domestic:    { eligible: false,                       note: 'Domestic battery not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Indiana.' },
  },
  WI: {
    name: 'Wisconsin',
    misdemeanor: { eligible: 'conditional', waitYears: 0, note: 'CRITICAL: Wisconsin expungement must be ordered by the judge AT SENTENCING. Cannot petition later. Offenses committed under age 25 only. If not ordered at sentencing, no expungement is available. Wis. Stat. § 973.015.' },
    felony:      { eligible: 'conditional', waitYears: 0, note: 'CRITICAL: Same rule — must be ordered at sentencing for offenses committed under age 25, max sentence 6 years. No post-sentencing petition available in Wisconsin. Wis. Stat. § 973.015.' },
    dui:         { eligible: false,                       note: 'OWI not eligible for expungement in Wisconsin.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Charges resulting in dismissal or acquittal may be expunged. Wis. Stat. § 973.015.' },
    domestic:    { eligible: false,                       note: 'Domestic abuse offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Wisconsin.' },
  },
  MN: {
    name: 'Minnesota',
    misdemeanor: { eligible: true,          waitYears: 2, note: 'Petty misdemeanors and misdemeanors eligible after 2 years. Minn. Stat. § 609A.02.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Certain felonies eligible under MN Clean Slate Act after 5 years. § 609A.02.' },
    dui:         { eligible: false,                       note: 'DWI not eligible for expungement in Minnesota.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and acquitted charges eligible immediately. § 609A.02.' },
    domestic:    { eligible: false,                       note: 'Domestic assault not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Minnesota.' },
  },
  IA: {
    name: 'Iowa',
    misdemeanor: { eligible: true,          waitYears: 8, note: 'Serious misdemeanors eligible after 8 years. Iowa Code § 901C.2.' },
    felony:      { eligible: 'conditional', waitYears: 8, note: 'Class D felonies eligible after 8 years — BUT requires ZERO prior or subsequent convictions ever (Iowa Code § 907.9). Any other conviction in your lifetime = ineligible. One of strictest felony expungement standards nationally; eligible after 8 years under Iowa deferred judgment. Iowa Code § 901C.2.' },
    dui:         { eligible: false,                       note: 'OWI not eligible for expungement in Iowa.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Deferred judgments and dismissed charges eligible. Iowa Code § 901C.2.' },
    domestic:    { eligible: false,                       note: 'Domestic abuse assault not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Iowa.' },
  },
  MO: {
    name: 'Missouri',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible after 3 years. Mo. Rev. Stat. § 610.140.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Class C, D, and E felonies eligible after 7 years. Mo. Rev. Stat. § 610.140.' },
    dui:         { eligible: false,                       note: 'DWI convictions not eligible for expungement in Missouri.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and acquitted charges immediately eligible. § 610.140.' },
    domestic:    { eligible: false,                       note: 'Domestic assault not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Missouri.' },
  },
  KS: {
    name: 'Kansas',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible after 3 years. K.S.A. § 21-6614.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-person, non-drug felonies may be eligible after 5 years. K.S.A. § 21-6614.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Kansas.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and diversion-completed charges eligible. K.S.A. § 21-6614.' },
    domestic:    { eligible: false,                       note: 'Domestic battery not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Kansas.' },
  },
  NE: {
    name: 'Nebraska',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible for set-aside after 3 years. Neb. Rev. Stat. § 29-2264.' },
    felony:      { eligible: 'conditional', waitYears: 3, note: 'Felony set-asides available after 3 years for non-violent offenses. § 29-2264.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for set-aside in Nebraska.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. § 29-2264.' },
    domestic:    { eligible: false,                       note: 'Domestic assault not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Nebraska.' },
  },
  SD: {
    name: 'South Dakota',
    misdemeanor: { eligible: true,          waitYears: 10, note: 'First-offense Class 1 and 2 misdemeanors eligible after 10 years. SDCL § 23A-3-56.' },
    felony:      { eligible: false,                        note: 'Felony convictions generally not eligible for expungement in South Dakota.' },
    dui:         { eligible: false,                        note: 'DUI not eligible in South Dakota.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed charges eligible. SDCL § 23A-3-56.' },
    domestic:    { eligible: false,                        note: 'Domestic abuse offenses not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in South Dakota.' },
  },
  ND: {
    name: 'North Dakota',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Class B misdemeanors eligible after 3 years. N.D.C.C. § 12.1-32-07.2.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class C felonies eligible after 5 years under North Dakota law. § 12.1-32-07.2.' },
    dui:         { eligible: false,                       note: 'DUI/APC not eligible for expungement in North Dakota.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in North Dakota.' },
  },
  MT: {
    name: 'Montana',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. MCA § 46-18-1102.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-violent felonies may be eligible after 5 years. MCA § 46-18-1102.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Montana.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. MCA § 46-18-1102.' },
    domestic:    { eligible: false,                       note: 'Partner/family member assault not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Montana.' },
  },

  // ── West ─────────────────────────────────────────────────────────────────
  CA: {
    name: 'California',
    misdemeanor: { eligible: true,          waitYears: 1, note: 'PC 1203.4 allows dismissal after completing probation. AB 1793 provides automatic cannabis relief.' },
    felony:      { eligible: 'conditional', waitYears: 3, note: 'Certain felonies eligible under PC 1203.4 after probation. Reduces to misdemeanor first for some charges.' },
    dui:         { eligible: 'conditional', waitYears: 1, note: 'DUI convictions may qualify for PC 1203.4 dismissal after completing probation.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges immediately eligible for petition to seal. PC 851.91.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible for PC 1203.4 relief.' },
    sexual:      { eligible: false,                       note: 'Sex offenses requiring registration not eligible in California.' },
  },
  WA: {
    name: 'Washington',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible after 3 years. RCW § 9.94A.640.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class C felonies eligible after 5 years; Class B after 10 years. RCW § 9.94A.640.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for vacation in Washington.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. RCW § 9.96.060.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offense not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Washington.' },
  },
  OR: {
    name: 'Oregon',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Class A misdemeanors eligible after 3 years. ORS § 137.225.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Class C felonies eligible after 5 years under Oregon law. ORS § 137.225.' },
    dui:         { eligible: false,                       note: 'DUII not eligible for expungement in Oregon.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges immediately eligible. ORS § 137.225.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Oregon.' },
  },
  NV: {
    name: 'Nevada',
    misdemeanor: { eligible: true,          waitYears: 1, note: 'Misdemeanors eligible after 1 year. NRS § 179.245.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Category E felonies eligible after 5 years; Category D after 7 years. NRS § 179.245.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for sealing in Nevada.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. NRS § 179.255.' },
    domestic:    { eligible: false,                       note: 'Domestic violence convictions have extended waiting periods.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Nevada.' },
  },
  AZ: {
    name: 'Arizona',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible for set-aside after 3 years. A.R.S. § 13-907.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-dangerous, non-sexual felonies eligible for set-aside after 5 years. A.R.S. § 13-907.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for set-aside in Arizona.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. A.R.S. § 13-907.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses restricted in Arizona.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Arizona.' },
  },
  CO: {
    name: 'Colorado',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Misdemeanors eligible after 3 years under Colorado HB21-1214. CRS § 24-72-702.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Class 4, 5, 6 felonies eligible after 7 years. CRS § 24-72-702.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for sealing in Colorado.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. CRS § 24-72-702.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Colorado.' },
  },
  UT: {
    name: 'Utah',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Class B and C misdemeanors eligible after 3 years. Utah Code § 77-40a-301.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Third-degree felonies eligible after 7 years under Utah Clean Slate Act. § 77-40a-301.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Utah.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. Utah Code § 77-40a-301.' },
    domestic:    { eligible: false,                       note: 'Domestic violence offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Utah.' },
  },
  ID: {
    name: 'Idaho',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-offense misdemeanors eligible after 5 years. Idaho Code § 67-3004.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-violent felonies may be eligible after 5 years. Idaho Code § 67-3004.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Idaho.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. Idaho Code § 67-3004.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Idaho.' },
  },
  WY: {
    name: 'Wyoming',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. Wyo. Stat. § 7-13-1401.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-violent felonies may be eligible after 5 years. § 7-13-1401.' },
    dui:         { eligible: false,                       note: 'DUI not eligible in Wyoming.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. § 7-13-1401.' },
    domestic:    { eligible: false,                       note: 'Domestic battery not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Wyoming.' },
  },
  NM: {
    name: 'New Mexico',
    misdemeanor: { eligible: true,          waitYears: 1, note: 'Misdemeanors eligible after 1 year. N.M. Stat. § 28-A-4.' },
    felony:      { eligible: 'conditional', waitYears: 4, note: 'Non-violent felonies eligible after 4 years. N.M. Stat. § 28-A-4.' },
    dui:         { eligible: false,                       note: 'DWI not eligible for expungement in New Mexico.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in New Mexico.' },
  },
  TX: {
    name: 'Texas',
    misdemeanor: { eligible: 'conditional', waitYears: 2, note: 'Class C misdemeanors (deferred adjudication) eligible after 2 years. Tex. Code Crim. Proc. art. 55.01.' },
    felony:      { eligible: false,                       note: 'Felony convictions generally not eligible for expunction. Deferred adjudication only. Art. 55.01.' },
    dui:         { eligible: false,                       note: 'DWI convictions not eligible for expunction. Non-disclosure may be available for first offense.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible after statute of limitations passes. Art. 55.01.' },
    domestic:    { eligible: false,                       note: 'Family violence offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Texas.' },
  },
  OK: {
    name: 'Oklahoma',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'First-offense misdemeanors eligible after 5 years. 22 O.S. § 18.' },
    felony:      { eligible: 'conditional', waitYears: 5, note: 'Non-violent felonies may be eligible after 5 years. 22 O.S. § 18.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Oklahoma.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed and acquitted charges eligible. 22 O.S. § 18.' },
    domestic:    { eligible: false,                       note: 'Domestic abuse not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Oklahoma.' },
  },
  HI: {
    name: 'Hawaii',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. HRS § 831-3.2.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Class C felonies may be eligible after 10 years. HRS § 831-3.2.' },
    dui:         { eligible: false,                        note: 'DUI not eligible for expungement in Hawaii.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed and acquitted charges eligible. HRS § 831-3.2.' },
    domestic:    { eligible: false,                        note: 'Abuse of family/household member not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Hawaii.' },
  },
  AK: {
    name: 'Alaska',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible for set-aside after 5 years. AS § 12.55.085.' },
    felony:      { eligible: 'conditional', waitYears: 10, note: 'Non-violent, non-sexual felonies eligible after 10 years. AS § 12.55.085.' },
    dui:         { eligible: false,                        note: 'DUI not eligible for set-aside in Alaska.' },
    dismissed:   { eligible: true,          waitYears: 0,  note: 'Dismissed charges eligible immediately.' },
    domestic:    { eligible: false,                        note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                        note: 'Sex offenses not eligible in Alaska.' },
  },
  // ── Mid-Atlantic ─────────────────────────────────────────────────────────
  MD: {
    name: 'Maryland',
    misdemeanor: { eligible: true,          waitYears: 3, note: 'Maryland Expungement Reform Act of 2025 (effective October 1, 2025). Misdemeanors eligible after 3 years from COMPLETION OF SENTENCE (not from conviction date — this is the key 2025 change). Probation violations no longer automatically bar eligibility.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Non-violent felonies eligible under Maryland Clean Slate Act after 7 years. § 10-301.3.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for expungement in Maryland.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed, nolle prosequi, and acquitted charges eligible immediately. § 10-105.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Maryland.' },
  },
  DE: {
    name: 'Delaware',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'Misdemeanors eligible after 5 years. 11 Del. C. § 4374.' },
    felony:      { eligible: 'conditional', waitYears: 7, note: 'Class G felonies eligible after 7 years. 11 Del. C. § 4374.' },
    dui:         { eligible: false,                       note: 'DUI not eligible in Delaware.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible. 11 Del. C. § 4374.' },
    domestic:    { eligible: false,                       note: 'Domestic violence not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in Delaware.' },
  },
  DC: {
    name: 'District of Columbia',
    misdemeanor: { eligible: true,          waitYears: 5, note: 'DC sealing law (DC Code § 16-803) revised effective February 2025. Misdemeanor convictions eligible after 5 years from completion of sentence. Court must find sealing is in interest of justice. Dismissed charges eligible immediately. D.C. Code § 16-803.' },
    felony:      { eligible: 'conditional', waitYears: 8, note: 'Non-violent felonies eligible after 8 years. D.C. Code § 16-803.' },
    dui:         { eligible: false,                       note: 'DUI not eligible for sealing in DC.' },
    dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges eligible immediately. D.C. Code § 16-803.' },
    domestic:    { eligible: false,                       note: 'Intrafamily offenses not eligible.' },
    sexual:      { eligible: false,                       note: 'Sex offenses not eligible in DC.' },
  },
};

// Default fallback for states not in our list
const DEFAULT_RULES = {
  misdemeanor: { eligible: 'conditional', waitYears: 1, note: 'Most states allow expungement of first-time misdemeanors. Eligibility varies by charge and waiting period.' },
  felony:      { eligible: 'conditional', waitYears: 3, note: 'Felony expungement varies significantly by state. A local attorney can assess your specific situation.' },
  dui:         { eligible: 'conditional', waitYears: 5, note: 'DUI expungement depends on your state and whether it was a first offense. Consult a local attorney.' },
  dismissed:   { eligible: true,          waitYears: 0, note: 'Dismissed charges are typically eligible for expungement or record sealing in most states.' },
  domestic:    { eligible: false,                       note: 'Domestic violence offenses are not eligible for expungement in most states. Consult a local attorney.' },
  sexual:      { eligible: false,                       note: 'Sex offenses are not eligible for expungement in most states. Consult a local attorney.' },
};

function classifyCharge(chargeText = '') {
  // Coerce any input to a safe string — never crash on bad input types
  // In a legal app, a classification error could affect real people.
  // We return 'misdemeanor' as the conservative safe default for any
  // unrecognizable input, rather than throwing an exception.
  const safe  = (chargeText === null || chargeText === undefined)
    ? ''
    : typeof chargeText === 'string'
    ? chargeText
    : String(chargeText);          // handles numbers, booleans, objects, arrays
  if (!safe.trim()) return 'misdemeanor';
  const lower = safe.toLowerCase();
  // Dismissals first — override everything else
  if (/dismiss|not guilty|acquit|dropped|no charge/.test(lower)) return 'dismissed';
  // DUI/DWI before domestic (drunk driving + domestic overlap is rare)
  if (/dui|dwi|\bowi\b|\boui\b|drunk.driv|impaired driv|driv.*impair|operating while intox|operating under.{0,5}influ/.test(lower)) return 'dui';
  // Domestic violence — check before generic assault
  if (/domestic|intimate partner|family violence/.test(lower)) return 'domestic';
  // Sexual offenses
  if (/sex offense|sexual batt|sexual conduct|sexual assault|rape|molest|indecent|indecency|lewd|child abuse|child sex|child exploit/.test(lower)) return 'sexual';
  // Explicit felony classifications
  if (/felony|felonious|class [a-f] felony|felon in possess/.test(lower)) return 'felony';
  // Violent crimes — always felony
  if (/murder|manslaughter|homicide|killing/.test(lower)) return 'felony';
  if (/robbery/.test(lower)) return 'felony';
  if (/burglary|breaking and enter/.test(lower)) return 'felony';
  if (/assault with.*weapon|aggravated assault|agg.*assault|aggravated battery|agg.*batt/.test(lower)) return 'felony';
  if (/kidnap|abduct/.test(lower)) return 'felony';
  if (/strangulation|strangling/.test(lower)) return 'felony';
  if (/arson/.test(lower)) return 'felony';
  if (/witness tamper|tamper.*witness|obstruct.*justice/.test(lower)) return 'felony';
  if (/trafficking|distribution.*drug|manufacture.*drug/.test(lower)) return 'felony';
  // ── Federal white-collar crimes ── always felony under federal statute ────
  // These were previously falling through to misdemeanor — corrected per firm feedback
  if (/tax evasion|tax fraud|tax.{0,10}26 u\.s\.c\.|internal revenue/.test(lower)) return 'felony';
  if (/money launder|launder.*proceed|smurfing/.test(lower)) return 'felony';
  if (/rico|racketeer|continuing criminal enterprise|\bcce\b|\b21 u\.s\.c.*848/.test(lower)) return 'felony';
  if (/bank fraud|mortgage fraud|loan fraud|insurance fraud.*federal/.test(lower)) return 'felony';
  if (/identity theft|\b18 u\.s\.c.*1028/.test(lower)) return 'felony';
  if (/conspiracy.*defraud|mail fraud|wire fraud|\b18 u\.s\.c.*134[3-4]/.test(lower)) return 'felony';
  if (/bribery|kickback|honest services|\b18 u\.s\.c.*666/.test(lower)) return 'felony';
  if (/securities fraud|insider trading|\b15 u\.s\.c|\bsec\b.*fraud/.test(lower)) return 'felony';
  if (/computer fraud|cfaa|\b18 u\.s\.c.*1030/.test(lower)) return 'felony';
  if (/healthcare fraud|medicare fraud|medicaid fraud/.test(lower)) return 'felony';
  if (/drug trafficking|federal.*drug|\b21 u\.s\.c.*841/.test(lower)) return 'felony';
  if (/counterfeiting|forgery.*federal|currency/.test(lower)) return 'felony';
  // Property crimes at felony thresholds
  if (/grand theft|grand larceny|grand auto/.test(lower)) return 'felony';
  if (/embezzlement/.test(lower)) return 'felony';
  if (/carjacking/.test(lower)) return 'felony';
  if (/extortion|blackmail/.test(lower)) return 'felony';
  if (/hate crime/.test(lower)) return 'felony';

  // ── Additional state-specific felonies ─────────────────────────────────────
  if (/grand jury.*obstruct|perjury.*federal|subornation/i.test(lower)) return 'felony';
  if (/human trafficking|sex trafficking|labor trafficking/.test(lower)) return 'felony';
  if (/child pornography|child.*sexual.*material|CSAM/.test(lower)) return 'sexual';
  if (/stalking.*felony|aggravated.*stalking/.test(lower)) return 'felony';
  if (/terroris|weapon.*mass|WMD|biological.*weapon/.test(lower)) return 'felony';
  if (/elder abuse.*felony|financial.*elder/.test(lower)) return 'felony';
  if (/gang enhancement|street gang|criminal street gang/.test(lower)) return 'felony';
  if (/cartel|narco.*trafficking|fentanyl.*distribution/.test(lower)) return 'felony';
  if (/revenge porn|nonconsensual.*intimate|intimate.*image/.test(lower)) return 'felony';
  if (/deepfake.*nonconsensual|synthetic.*intimate/.test(lower)) return 'felony';
  if (/AI.*fraud|synthetic.*identity.*federal/.test(lower)) return 'felony';
  if (/crypto.*fraud|NFT.*fraud|blockchain.*fraud/.test(lower)) return 'felony';
  if (/ransomware|cyberextortion/.test(lower)) return 'felony';
  if (/public official.*bribe|quid.*pro.*quo.*official/.test(lower)) return 'felony';
  if (/espionage|18 u\.s\.c.*794|national security/.test(lower)) return 'felony';

  return 'misdemeanor';
}

/**
 * Get expungement eligibility for a charge in a state.
 * @param {string} state - 2-letter state code
 * @param {string} chargeType - one of felony/misdemeanor/dui/domestic/sexual/dismissed
 * @returns {{ eligible: boolean|'conditional', waiting_years: number, notes: string[] }}
 *   eligible: true = eligible, false = not eligible, 'conditional' = depends on factors
 *   Never throws — returns default rules if state not found.
 */
function getEligibility(state, chargeType, status) {
  // Coerce inputs — never crash on bad state or charge type
  const safeState  = (state  == null) ? '' : String(state).trim().toUpperCase().slice(0,2);
  const safeCharge = (chargeType == null) ? 'misdemeanor' : String(chargeType).trim().toLowerCase();

  // Dismissed always overrides charge type
  const lookupType = (status === 'Dismissed') ? 'dismissed' : chargeType;
  const rules = STATE_RULES[state] || DEFAULT_RULES;
  const rule  = rules[lookupType] || rules.misdemeanor || DEFAULT_RULES.misdemeanor;
  return { chargeType: lookupType, ...rule };
}

export { STATE_RULES, DEFAULT_RULES, classifyCharge, getEligibility };
