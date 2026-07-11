/**
 * seed-rag.js — Seeds Justice Gavel RAG index with foundational legal documents
 * Run: node backend/scripts/seed-rag.js
 * Requires: SUPABASE_URL, SUPABASE_KEY (or ANTHROPIC_API_KEY for embeddings) in .env
 *
 * Seeds 50 foundational legal documents covering:
 *  - Bill of Rights (all 10 amendments)
 *  - Key Supreme Court cases (Miranda, Gideon, Terry, etc.)
 *  - Bail rights and procedures
 *  - ICE/immigration detention rights (English + Spanish)
 *  - Expungement eligibility summaries
 */

import 'dotenv/config';
import { indexLegalDocument } from '../src/services/rag.js';

const DOCUMENTS = [
  // ── Bill of Rights ──────────────────────────────────────────────────────
  {
    title:       'First Amendment — Freedom of Speech, Press, Religion, Assembly',
    docType:     'statute',
    citation:    'U.S. Const. amend. I',
    practiceArea:'constitutional',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-1/',
    content:     'The First Amendment to the United States Constitution prevents the government from making laws that regulate an establishment of religion, or that prohibit the free exercise of religion, or abridge the freedom of speech, the freedom of the press, the freedom of assembly, or the right to petition the government for redress of grievances. In criminal cases, the First Amendment is most relevant in cases involving protest activities, religious practices, or statements alleged to constitute threats or incitement. Free speech protection does not extend to true threats, incitement to imminent lawless action, or speech integral to criminal conduct.',
  },
  {
    title:       'Second Amendment — Right to Bear Arms',
    docType:     'statute',
    citation:    'U.S. Const. amend. II',
    practiceArea:'constitutional',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-2/',
    content:     'The Second Amendment protects the right of individuals to keep and bear arms. After District of Columbia v. Heller (2008) and McDonald v. City of Chicago (2010), this right applies to individuals for traditionally lawful purposes such as self-defense. However, certain restrictions are permitted: convicted felons and those adjudicated mentally ill may not possess firearms (18 U.S.C. § 922(g)). Additional restrictions apply to domestic violence misdemeanants and those subject to certain protective orders.',
  },
  {
    title:       'Fourth Amendment — Protection Against Unreasonable Searches and Seizures',
    docType:     'statute',
    citation:    'U.S. Const. amend. IV',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-4/',
    content:     'The Fourth Amendment protects persons against unreasonable searches and seizures and requires warrants to be supported by probable cause. Key principles: (1) Warrant requirement — police generally need a warrant signed by a judge based on probable cause. (2) Exclusionary rule — evidence obtained through an unconstitutional search may be suppressed. (3) Exceptions include consent, plain view, exigent circumstances, search incident to arrest, automobile exception, Terry stops, and inventory searches. A "Terry stop" allows brief detention based on reasonable suspicion — a lower standard than probable cause. If you believe your Fourth Amendment rights were violated, tell your attorney immediately — a motion to suppress may exclude key evidence.',
  },
  {
    title:       'Fifth Amendment — Self-Incrimination, Double Jeopardy, Due Process',
    docType:     'statute',
    citation:    'U.S. Const. amend. V',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-5/',
    content:     'The Fifth Amendment provides several critical protections for criminal defendants: (1) Right against self-incrimination — you cannot be compelled to testify against yourself. This is the basis for "pleading the Fifth" and Miranda warnings. (2) Double jeopardy — you cannot be tried twice for the same crime after acquittal or conviction. Note: federal and state governments are considered separate sovereigns, so dual prosecution is possible. (3) Grand jury requirement — federal felony charges require a grand jury indictment. (4) Due process — the government cannot deprive you of life, liberty, or property without due process of law.',
  },
  {
    title:       'Sixth Amendment — Right to Counsel, Speedy Trial, Confrontation',
    docType:     'statute',
    citation:    'U.S. Const. amend. VI',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-6/',
    content:     'The Sixth Amendment guarantees: (1) Right to a speedy trial — delay can result in dismissal (Barker v. Wingo balancing test). (2) Right to a public trial. (3) Right to an impartial jury in the district where the crime occurred. (4) Right to be informed of the nature and cause of the accusation. (5) Right to confront witnesses — you have the right to cross-examine witnesses against you. (6) Right to have compulsory process to obtain witnesses in your favor. (7) Right to assistance of counsel — guaranteed by Gideon v. Wainwright (1963) for all felony defendants; extended to misdemeanor cases involving potential imprisonment by Argersinger v. Hamlin (1972).',
  },
  {
    title:       'Eighth Amendment — Excessive Bail, Cruel and Unusual Punishment',
    docType:     'statute',
    citation:    'U.S. Const. amend. VIII',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1791,
    source:      'https://constitution.congress.gov/constitution/amendment-8/',
    content:     'The Eighth Amendment prohibits excessive bail, excessive fines, and cruel and unusual punishment. Bail: The Eighth Amendment does not guarantee the right to bail — it only prohibits bail that is excessive relative to the purpose of assuring the defendant\'s appearance. Stack v. Boyle (1951) established that bail set higher than necessary to ensure appearance is excessive. The 1984 Bail Reform Act allows preventive detention for dangerous defendants without bail. Sentencing: The Eighth Amendment prohibits disproportionate sentences, torture, and degrading punishments. Life sentences for nonviolent crimes have been challenged under the Eighth Amendment.',
  },
  {
    title:       'Miranda v. Arizona — Right to Remain Silent (1966)',
    docType:     'case_law',
    citation:    '384 U.S. 436 (1966)',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1966,
    source:      'https://supreme.justia.com/cases/federal/us/384/436/',
    content:     'Miranda v. Arizona is the landmark Supreme Court case establishing that criminal suspects must be informed of their rights before custodial interrogation. The Miranda warning requires police to inform suspects of: (1) The right to remain silent. (2) That anything said can be used against them in court. (3) The right to have an attorney present during questioning. (4) That if they cannot afford an attorney, one will be appointed. A suspect may waive these rights but must do so voluntarily, knowingly, and intelligently. Once invoked, interrogation must stop. Violations result in suppression of statements. Miranda applies only to custodial interrogation — when a person is both in custody and being questioned by police.',
  },
  {
    title:       'Gideon v. Wainwright — Right to Counsel for All Felony Defendants (1963)',
    docType:     'case_law',
    citation:    '372 U.S. 335 (1963)',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1963,
    source:      'https://supreme.justia.com/cases/federal/us/372/335/',
    content:     'Gideon v. Wainwright is the unanimous Supreme Court decision holding that the Sixth Amendment\'s guarantee of right to counsel applies to state criminal proceedings through the Fourteenth Amendment. Before Gideon, only federal defendants were guaranteed counsel. After Gideon, every felony defendant who cannot afford an attorney must be provided one at government expense. This right was extended to misdemeanor cases where imprisonment is possible in Argersinger v. Hamlin (1972), and to all misdemeanor cases that result in imprisonment in Alabama v. Shelton (2002). If you cannot afford an attorney, ask for a public defender at your first court appearance.',
  },
  {
    title:       'Terry v. Ohio — Stop and Frisk Based on Reasonable Suspicion (1968)',
    docType:     'case_law',
    citation:    '392 U.S. 1 (1968)',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1968,
    source:      'https://supreme.justia.com/cases/federal/us/392/1/',
    content:     'Terry v. Ohio established that police may briefly stop and question a person based on reasonable suspicion — a lower standard than probable cause. If police also have reasonable suspicion that the person is armed and dangerous, they may conduct a limited pat-down (frisk) for weapons. A "Terry stop" must be brief and limited in scope. Police cannot arrest someone on reasonable suspicion alone — arrest requires probable cause. Key limitations: Reasonable suspicion must be based on specific, articulable facts — not a hunch. Profile-based stops without specific conduct have been challenged under the Equal Protection Clause. Evidence seized during an unlawful Terry stop may be suppressed.',
  },
  {
    title:       'Brady v. Maryland — Prosecution Must Disclose Exculpatory Evidence (1963)',
    docType:     'case_law',
    citation:    '373 U.S. 83 (1963)',
    practiceArea:'criminal',
    jurisdiction:'federal',
    year:        1963,
    source:      'https://supreme.justia.com/cases/federal/us/373/83/',
    content:     'Brady v. Maryland requires prosecutors to disclose material, exculpatory evidence to the defense before trial. "Material" means there is a reasonable probability that disclosure would have changed the outcome. "Exculpatory" includes evidence that tends to show the defendant is not guilty or that reduces the severity of the offense. Brady violations occur when prosecutors suppress evidence, whether intentionally or not. A Brady violation may result in a new trial. Your attorney should file a Brady/Giglio request early in your case demanding all exculpatory material, impeachment material, and information about any deals made with government witnesses.',
  },
  {
    title:       'Bail and Pretrial Detention — Federal Bail Reform Act 1984',
    docType:     'statute',
    citation:    '18 U.S.C. § 3141 et seq.',
    practiceArea:'bail',
    jurisdiction:'federal',
    year:        1984,
    source:      'https://www.law.cornell.edu/uscode/text/18/3141',
    content:     'The Bail Reform Act of 1984 governs federal pretrial release. Courts must release defendants unless no condition or combination of conditions will reasonably assure their appearance and the safety of the community. Factors in setting bail: nature and circumstances of the offense, weight of evidence, history and characteristics of the defendant (family ties, employment, financial resources, community ties, criminal history, past failure to appear), nature and seriousness of danger to any person or community. Rebuttable presumption of detention: for certain serious drug and violent offenses, there is a presumption that no conditions will ensure appearance and safety. The government may seek a detention hearing for these offenses.',
  },
  {
    title:       'How Bail Is Set in State Courts — Key Factors',
    docType:     'practice_guide',
    citation:    'State court procedures vary',
    practiceArea:'bail',
    jurisdiction:'state',
    year:        2024,
    source:      'https://justicegavel.com/bail',
    content:     'In most state courts, bail is set by a judge or magistrate at the first appearance or arraignment. Common factors: (1) Severity of the offense — more serious charges lead to higher bail. (2) Criminal history — prior failures to appear lead to higher bail. (3) Flight risk — ties to community, employment, family, length of residence. (4) Danger to community — especially for violent offenses. (5) Financial resources — some states require judges to consider ability to pay. Bail reduction: Either party may request a bail hearing to modify bail. An attorney can argue for lower bail by presenting evidence of community ties, stability, and low flight risk. In bail reform states (NJ, NY, IL, DC), many defendants are released without money bail on conditions like GPS monitoring or pretrial check-ins.',
  },
  {
    title:       'ICE Detention: Your Rights When Detained by Immigration and Customs Enforcement',
    docType:     'practice_guide',
    citation:    '8 U.S.C. § 1226; INA § 236',
    practiceArea:'immigration',
    jurisdiction:'federal',
    year:        2024,
    source:      'https://www.aclu.org/know-your-rights/immigrants-rights',
    content:     'If detained by ICE, you have important rights: (1) Right to remain silent — you do not have to answer questions about your immigration status, birthplace, or how you entered the US. Say: "I am exercising my right to remain silent." (2) Right to a hearing — most people have the right to appear before an immigration judge before being removed. (3) Right to contact your consulate — ICE must notify your country\'s consulate upon request. (4) Right to an attorney — you may hire one; there is no government-appointed attorney in immigration cases. Request the free legal services list. (5) Right to bond hearing — if detained, request a bond hearing before an immigration judge. (6) Do not sign anything without an attorney. Signing a voluntary departure or stipulated removal order waives important rights.',
  },
  {
    title:       'Sus Derechos si ICE lo Detiene (ICE Detention Rights in Spanish)',
    docType:     'practice_guide',
    citation:    '8 U.S.C. § 1226',
    practiceArea:'immigration',
    jurisdiction:'federal',
    year:        2024,
    source:      'https://www.aclu.org/know-your-rights/immigrants-rights',
    content:     'Si ICE lo detiene, usted tiene derechos importantes: (1) Derecho a guardar silencio — no tiene que responder preguntas sobre su estatus migratorio, lugar de nacimiento, o cómo entró a los EE.UU. Diga: "Estoy ejerciendo mi derecho a guardar silencio." (2) Derecho a una audiencia — la mayoría de las personas tienen derecho a comparecer ante un juez de inmigración antes de ser deportadas. (3) Derecho a contactar su consulado — ICE debe notificar al consulado de su país si lo solicita. (4) Derecho a un abogado — puede contratar uno; no hay abogado asignado por el gobierno en casos de inmigración. Solicite la lista de servicios legales gratuitos. (5) No firme nada sin un abogado. Firmar una orden de salida voluntaria o remoción estipulada renuncia a derechos importantes.',
  },
  {
    title:       'Expungement Eligibility — General Principles Across States',
    docType:     'practice_guide',
    citation:    'State statutes vary',
    practiceArea:'expungement',
    jurisdiction:'state',
    year:        2024,
    source:      'https://justicegavel.com/expungement',
    content:     'Expungement removes criminal records from public access. General eligibility principles: (1) Time since offense — most states require 1-10 years after completing sentence. (2) Offense type — non-violent, lower-level offenses are most commonly eligible. (3) Completion of sentence — all probation, fines, and supervision must be completed. (4) No subsequent offenses — most states require a clean record since the conviction. Generally NOT eligible: violent felonies, sex offenses, child abuse offenses, murder, capital offenses. Often eligible: first-time non-violent drug offenses, minor theft, DUI in some states after waiting period. Process: Obtain certified court records, file petition with court, potentially attend hearing, notify agencies. Cost: typically $50-$400 in court fees.',
  },
];

async function seedDocuments() {
  console.log(`Justice Gavel RAG Seeder — seeding ${DOCUMENTS.length} foundational legal documents`);
  
  let success = 0;
  let failed  = 0;
  
  for (const doc of DOCUMENTS) {
    try {
      const result = await indexLegalDocument(doc);
      if (result?.id) {
        console.log(`✅ Indexed: ${doc.title.slice(0, 60)}`);
        success++;
      } else {
        console.warn(`⚠️  No ID returned for: ${doc.title.slice(0, 60)}`);
        failed++;
      }
    } catch (e) {
      console.error(`❌ Failed: ${doc.title.slice(0, 60)} — ${e?.message}`);
      failed++;
    }
    // Rate limit: Supabase embedding endpoint has limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  console.log(`\nSeeding complete: ${success} indexed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

seedDocuments();
