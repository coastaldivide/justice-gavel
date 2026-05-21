import { initDb, db } from '../db/index.js';

const RESOURCES = [
  { title: 'Your rights during a traffic stop', category: 'General', body: 'When pulled over, provide your license, registration, and insurance. You do not have to answer questions about where you are going. Politely say "I prefer not to answer." Do not physically resist even an unlawful stop — address it in court.' },
  { title: 'Miranda rights explained', category: 'Criminal', body: 'Miranda rights apply once you are in custody AND being questioned. Invoke them clearly: "I am invoking my right to remain silent and I want a lawyer." After invoking, all questioning must stop.' },
  { title: 'What to do after a DUI arrest', category: 'DUI', body: 'Do not admit to drinking. Request an attorney immediately. You typically have 10 days to contest license suspension at a DMV hearing. Document everything about the stop.' },
  { title: 'Understanding bail', category: 'Criminal', body: 'Bail secures your release while awaiting trial. A bail bondsman can post it for ~10% non-refundable. Factors: severity of charge, criminal history, flight risk, community ties.' },
  { title: 'How to find a public defender', category: 'Criminal', body: 'Request a public defender at arraignment. Bring proof of income. You have the right to communicate privately with your attorney and be informed about your case.' },
  { title: 'Expungement: clearing your record', category: 'Criminal', body: 'Expungement seals or erases a record. Eligibility depends on state, charge type, and time elapsed. Most states allow it for first-time, low-level offenses after completing your sentence.' },
  { title: 'Drug charge basics', category: 'Criminal', body: 'Charges range from possession to trafficking. Key defenses include unlawful search and seizure and lack of knowledge. An attorney can evaluate whether the search was constitutional.' },
  { title: 'Tenant rights when facing eviction', category: 'Housing', body: 'Your landlord must give written notice before eviction. You have the right to a court hearing. No lockouts, utility shutoffs, or removal of belongings without a court order.' },
  { title: 'Domestic violence charges', category: 'Criminal', body: 'Charges can result in mandatory arrest, restraining orders, and loss of firearm rights. An attorney can help navigate protective orders and explore dismissal options.' },
  { title: 'Juvenile rights', category: 'Criminal', body: 'Minors have most adult rights in criminal proceedings including right to counsel. Do not let a minor speak to police without an attorney present.' },
];

const LESSONS = [
  { title: 'Traffic stop: what to do', category: 'General', content: 'Stay calm. Keep your hands visible. Provide ID, registration, and insurance when asked. You do not have to answer questions about your destination. Do not consent to searches. Calmly say: "I do not consent to a search." Do not physically resist — challenge any unlawful action in court. You can ask: "Am I free to go?" If the answer is yes, calmly leave.', points: 10 },
  { title: 'After arrest: the first 24 hours', category: 'Criminal', content: 'Invoke your rights immediately: "I am invoking my right to remain silent. I want a lawyer." Do not answer any questions — not even casual conversation (jail calls are recorded). During booking you will be photographed and fingerprinted. You have the right to a phone call — use it for family or attorney, not to discuss your case. A bail hearing usually happens within 24–72 hours.', points: 10 },
  { title: 'What is arraignment?', category: 'Criminal', content: 'Arraignment is your first formal court appearance, usually within 48–72 hours of arrest. You will be told the charges against you and asked to enter a plea (guilty, not guilty, or no contest). Almost always plead not guilty at arraignment — this preserves all your options. A bail amount is set or reviewed. Your attorney will advise you on strategy going forward.', points: 10 },
  { title: 'Search and seizure rights', category: 'Criminal', content: 'The 4th Amendment protects you from unreasonable searches. Police can search if: (1) you consent, (2) they have a warrant, (3) there is probable cause with exigent circumstances, or (4) you are being lawfully arrested. For your car: do not consent. For your home: ask to see the warrant before letting anyone in. For your phone: Riley v. California established police need a warrant to search your phone after arrest.', points: 10 },
  { title: 'Understanding your charges', category: 'Criminal', content: 'Criminal charges are either misdemeanors (less serious, up to 1 year in jail) or felonies (more serious, more than 1 year in prison). A charge is not a conviction — it is an accusation. You are innocent until proven guilty. The prosecutor must prove guilt beyond a reasonable doubt, which is a high standard. Many charges are reduced or dismissed before trial through plea negotiations.', points: 15 },
  { title: 'Working with your attorney', category: 'General', content: 'Be completely honest with your attorney — attorney-client privilege protects everything you tell them. Provide all documents and information they request promptly. Do not discuss your case with anyone except your attorney. Ask questions if you do not understand something. Your attorney works for you — you have the right to be informed about all decisions in your case.', points: 10 },
];

(async () => {
  await initDb();

  // Resources
  const rCount = await db.get('SELECT COUNT(*) as c FROM resources');
  if (rCount.c < 5) {
    await db.run('DELETE FROM resources');
    for (const r of RESOURCES) {
      await db.run('INSERT INTO resources (title,category,body) VALUES (?,?,?)', [r.title, r.category, r.body]);
    }
    console.log('Resources seeded:', RESOURCES.length);
  }

  // Lessons
  const lCount = await db.get('SELECT COUNT(*) as c FROM lessons');
  if (lCount.c === 0) {
    for (const l of LESSONS) {
      await db.run('INSERT INTO lessons (title,category,content,points) VALUES (?,?,?,?)', [l.title, l.category, l.content, l.points]);
    }
    console.log('Lessons seeded:', LESSONS.length);
  }

  // Demo user
  const u = await db.get("SELECT * FROM users WHERE email='demo@justicegavel.app'");
  if (!u) {
    const bcrypt = (await import('bcryptjs')).default;
    const hash = bcrypt.hashSync('password', 10);
    await db.run('INSERT INTO users (email,password_hash,name,display_name,login_identifier,is_premium) VALUES (?,?,?,?,?,?)',
      ['demo@justicegavel.app', hash, 'Demo User', 'Demo User', 'demo@justicegavel.app', 0]);
    console.log('Demo user created: demo@justicegavel.app / password');
  }

  console.log('Demo seed complete.');
  process.exit(0);
})().catch(e => { console.error(e); process.exi
  // ── Forum Posts Seed (20 posts — 5 categories) ──────────────────────────────
  const forumPosts = [
    // DUI category
    { category:'dui', title:'What happens at a DUI checkpoint?', body:'Officers check for signs of impairment. You must show license/registration but can decline field sobriety tests in most states. Politely say "I decline" — do not argue. Call an attorney before any statement.', is_ai:1 },
    { category:'dui', title:'Can I refuse a breathalyzer?', body:'Yes, but refusal triggers automatic license suspension in most states under implied consent laws. Suspension ranges from 90 days to 1 year for first refusal. Weigh the suspension against a high BAC reading — consult an attorney quickly.', is_ai:1 },
    { category:'dui', title:'DUI with no prior record — what to expect', body:'First-offense DUI typically means: fines $500-$2000, license suspension 3-12 months, probation 1-3 years, possible ignition interlock device. Jail is rare for first offense with BAC under 0.15. An attorney can often negotiate reduced charges.', is_ai:1 },
    { category:'dui', title:'Expungement after DUI — is it possible?', body:'Many states allow DUI expungement after completing probation and waiting period (1-7 years). California, Texas, Florida all allow it. A few states (Virginia, New Jersey) do not. Check your state's eligibility using the Expungement tool.', is_ai:1 },
    // Bail category
    { category:'bail', title:'How does bail work?', body:'Bail is money deposited to guarantee you appear for court. A bondsman charges 10-15% of bail (nonrefundable) and covers the rest. If you miss court, the bondsman loses the full amount and may hire a recovery agent to find you. Call a bondsman immediately after arrest.', is_ai:1 },
    { category:'bail', title:'Can bail be reduced?', body:'Yes. At a bail hearing, your attorney argues for reduction based on: ties to community, employment, family, no prior record, low flight risk. In most states you have a right to a bail hearing within 48-72 hours. Request one immediately.', is_ai:1 },
    { category:'bail', title:'What if I can't afford bail?', body:'Options: (1) Bondsman — 10% fee, (2) Property bond — use real estate as collateral, (3) Own recognizance release — judge releases you on your promise to appear, (4) Bail reform programs — many counties have nonprofit bail funds. Your attorney can request OR release.', is_ai:1 },
    { category:'bail', title:'What is a bail schedule?', body:'Most counties have a preset bail schedule — fixed amounts for common charges. Example: simple assault = $5,000, DUI = $10,000. You can pay the scheduled amount immediately without waiting for a judge. For felonies, always request a bail hearing for individualized consideration.', is_ai:1 },
    // Rights category
    { category:'rights', title:'Miranda rights — when do they apply?', body:'Miranda rights ("You have the right to remain silent...") must be read before custodial interrogation — when you are arrested AND officers want to question you. If you are detained but not questioned, Miranda doesn't apply. Regardless: say "I want a lawyer" and stop talking.', is_ai:1 },
    { category:'rights', title:'Can police search my phone?', body:'No, not without a warrant. Riley v. California (2014) — the Supreme Court ruled unanimously that police need a warrant to search your cell phone. Lock your phone before any police encounter. Do not provide your passcode. Say: "I do not consent to searches."', is_ai:1 },
    { category:'rights', title:'What are my rights during a traffic stop?', body:'You must: provide license, registration, proof of insurance. You may: stay in your car, decline to answer questions, decline consent to search. You must not: lie to officers, flee, physically resist. Record the encounter if safe. Note badge number and patrol car number.', is_ai:1 },
    { category:'rights', title:'Can I film police?', body:'Yes. The First Amendment protects your right to record police in public performing their duties. You must: stay out of their way, not interfere. Officers cannot legally order you to stop filming or delete footage. If they try, say "I am exercising my First Amendment right."', is_ai:1 },
    // Drug charges category
    { category:'drug_charges', title:'Difference between possession and intent to distribute', body:'Possession = personal use amount, typically under 1-2 grams depending on substance. Intent to distribute = larger quantity, packaging (bags/scales), large cash, text evidence. Prosecutors use these factors to elevate charges. The distinction is crucial — distribution carries 2-5x the sentence.', is_ai:1 },
    { category:'drug_charges', title:'Drug court vs regular court — which is better?', body:'Drug court is almost always better for substance-related charges. You get: treatment instead of incarceration, charges dismissed upon successful completion, no felony conviction on your record. Eligibility requires: nonviolent offense, substance use disorder diagnosis, willingness to participate. Ask your attorney immediately.', is_ai:1 },
    { category:'drug_charges', title:'Can drug charges be expunged?', body:'In most states, yes — after completing sentence and waiting period. Federal drug convictions are harder to expunge. States like California (Prop 47) retroactively reduced many drug felonies to misdemeanors. Your state's expungement tool will show your exact eligibility.', is_ai:1 },
    { category:'drug_charges', title:'What is a controlled buy?', body:'A controlled buy is when law enforcement uses an informant to purchase drugs from a suspect under surveillance. Evidence includes: audio/video recording, pre-marked buy money, officer testimony. Your attorney should request all informant agreements and payment records — paid informants have credibility issues.', is_ai:1 },
    // Assault category
    { category:'assault', title:'Difference between assault and battery', body:'Assault = intentional threat that causes reasonable fear of harm. Battery = actual physical contact. Many states have combined them into "assault" statutes. Simple assault is typically a misdemeanor; aggravated assault (weapon, serious injury) is a felony. Self-defense is the most common defense.', is_ai:1 },
    { category:'assault', title:'What is self-defense?', body:'Self-defense requires: reasonable belief of imminent harm, proportional force, no ability to safely retreat (in non-stand-your-ground states). You cannot claim self-defense if you were the initial aggressor. Your attorney must gather: witness statements, surveillance footage, 911 calls, medical records immediately.', is_ai:1 },
    { category:'assault', title:'Domestic violence charges — what happens next', body:'DV charges involve mandatory arrest policies in most states — even if the alleged victim recants. A no-contact order is typically issued automatically. Violation of the order is a separate crime. Your attorney can work to modify the order for cohabitating couples. Do not contact the alleged victim without attorney guidance.', is_ai:1 },
    { category:'assault', title:'Assault expungement eligibility', body:'Misdemeanor assault is expungeable in most states after completing probation and waiting period (1-5 years). Felony assault is harder — some states allow it after 7-10 years, others never. Domestic violence convictions are specifically excluded from expungement in many states due to federal gun rights implications.', is_ai:1 },
  ];

  const forumStmt = db.prepare(`
    INSERT OR IGNORE INTO forum_posts (category, title, body, is_ai, upvotes, is_pinned)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  let forumCount = 0;
  for (const p of forumPosts) {
    try {
      forumStmt.run(p.category, p.title, p.body, p.is_ai || 0, Math.floor(Math.random()*47)+3, 0);
      forumCount++;
    } catch(e) { /* table may not exist yet */ }
  }
  if (forumCount > 0) console.log(`  ✓ Forum posts: ${forumCount} seeded`);

  // ── Specialty Courts Seed (30 courts — veteran, drug, mental health) ─────────
  const specialtyCourts = [
    // Veterans Treatment Courts
    { name:'Buffalo Veterans Treatment Court', court_type:'veteran', state:'NY', city:'Buffalo', county:'Erie', phone:'(716) 845-2560', eligibility:'Veterans with service-connected condition', notes:'First VTC in the nation (2008)' },
    { name:'Los Angeles Veterans Court', court_type:'veteran', state:'CA', city:'Los Angeles', county:'Los Angeles', phone:'(213) 974-5738', eligibility:'Any veteran charged with non-violent offense', notes:'Largest VTC by volume' },
    { name:'Houston Veterans Treatment Court', court_type:'veteran', state:'TX', city:'Houston', county:'Harris', phone:'(713) 274-0440', eligibility:'Veterans/active duty, any offense except sex crimes', notes:'Handles both misdemeanor and felony' },
    { name:'Nashville Veterans Treatment Court', court_type:'veteran', state:'TN', city:'Nashville', county:'Davidson', phone:'(615) 862-5600', eligibility:'Veterans with documented service connection', notes:'Partners with VA Medical Center' },
    { name:'Phoenix Veterans Court', court_type:'veteran', state:'AZ', city:'Phoenix', county:'Maricopa', phone:'(602) 506-7538', eligibility:'Military veterans, all charges considered', notes:'Mentor program with peer veterans' },
    { name:'Chicago Veterans Treatment Court', court_type:'veteran', state:'IL', city:'Chicago', county:'Cook', phone:'(312) 603-5373', eligibility:'Combat veterans with PTSD/TBI diagnosis', notes:'Weekly check-ins, VA case management' },
    { name:'Atlanta Veterans Court', court_type:'veteran', state:'GA', city:'Atlanta', county:'Fulton', phone:'(404) 612-4500', eligibility:'Honorable discharge or general under honorable', notes:'18-24 month program' },
    { name:'Seattle Veterans Court', court_type:'veteran', state:'WA', city:'Seattle', county:'King', phone:'(206) 477-2400', eligibility:'Any veteran, non-violent preferred', notes:'Graduation ceremony with family' },
    { name:'Denver Veterans Court', court_type:'veteran', state:'CO', city:'Denver', county:'Denver', phone:'(720) 865-8301', eligibility:'Veterans with service-connected mental health/substance', notes:'Connects to Colorado VetCorps' },
    { name:'Miami Veterans Treatment Court', court_type:'veteran', state:'FL', city:'Miami', county:'Miami-Dade', phone:'(305) 349-7400', eligibility:'Veterans charged with felony or misdemeanor', notes:'Spanish-language services available' },
    // Drug Courts
    { name:'New York City Drug Court', court_type:'drug', state:'NY', city:'New York', county:'New York', phone:'(646) 386-4000', eligibility:'Non-violent drug offense, assessed substance disorder', notes:'Multiple locations across boroughs' },
    { name:'Los Angeles Drug Court', court_type:'drug', state:'CA', city:'Los Angeles', county:'Los Angeles', phone:'(213) 974-6000', eligibility:'Drug possession, sales considered case-by-case', notes:'18-month program minimum' },
    { name:'Cook County Drug Court', court_type:'drug', state:'IL', city:'Chicago', county:'Cook', phone:'(312) 603-6000', eligibility:'Non-violent drug offenses, no prior violent felony', notes:'Residential treatment available' },
    { name:'Harris County Drug Court', court_type:'drug', state:'TX', city:'Houston', county:'Harris', phone:'(713) 274-4600', eligibility:'Drug possession or DWI with drug involvement', notes:'Three tracks: adult, DWI, family' },
    { name:'Maricopa County Drug Court', court_type:'drug', state:'AZ', city:'Phoenix', county:'Maricopa', phone:'(602) 506-8575', eligibility:'Felony drug possession only', notes:'Mandatory treatment, UA testing twice weekly' },
    { name:'Davidson County Drug Court', court_type:'drug', state:'TN', city:'Nashville', county:'Davidson', phone:'(615) 862-5600', eligibility:'Non-violent felony drug offense', notes:'12-18 month program, charges dismissed upon completion' },
    // Mental Health Courts
    { name:'Los Angeles Mental Health Court', court_type:'mental_health', state:'CA', city:'Los Angeles', county:'Los Angeles', phone:'(213) 974-0280', eligibility:'Serious mental illness, any charge except murder/sex crimes', notes:'Largest MHC by case volume' },
    { name:'King County Mental Health Court', court_type:'mental_health', state:'WA', city:'Seattle', county:'King', phone:'(206) 477-1777', eligibility:'Diagnosed Axis I disorder, non-violent charge', notes:'Founded 1999, model program nationally' },
    { name:'Broward County Mental Health Court', court_type:'mental_health', state:'FL', city:'Fort Lauderdale', county:'Broward', phone:'(954) 831-7850', eligibility:'Mental illness or co-occurring disorder', notes:'Civil and criminal tracks available' },
    { name:'Franklin County Mental Health Court', court_type:'mental_health', state:'OH', city:'Columbus', county:'Franklin', phone:'(614) 525-5000', eligibility:'Serious and persistent mental illness, misdemeanor/felony', notes:'ACT team wraparound services' },
    { name:'Travis County Mental Health Court', court_type:'mental_health', state:'TX', city:'Austin', county:'Travis', phone:'(512) 854-9306', eligibility:'Axis I or II diagnosis, non-violent offense', notes:'18-month average program length' },
    { name:'Hennepin County Mental Health Court', court_type:'mental_health', state:'MN', city:'Minneapolis', county:'Hennepin', phone:'(612) 348-6000', eligibility:'Serious mental illness, felony charges', notes:'Integrated with county crisis services' },
    { name:'Clark County Mental Health Court', court_type:'mental_health', state:'NV', city:'Las Vegas', county:'Clark', phone:'(702) 671-4502', eligibility:'Any mental health diagnosis, any charge except murder', notes:'Weekly compliance hearings' },
    { name:'Sacramento County Mental Health Court', court_type:'mental_health', state:'CA', city:'Sacramento', county:'Sacramento', phone:'(916) 875-3600', eligibility:'Mental illness primary factor in offense', notes:'Diversion from jail to treatment' },
    { name:'Multnomah County Mental Health Court', court_type:'mental_health', state:'OR', city:'Portland', county:'Multnomah', phone:'(503) 988-5000', eligibility:'Axis I diagnosis, misdemeanor offenses', notes:'Housing-first integrated model' },
    { name:'Dallas County Mental Health Court', court_type:'mental_health', state:'TX', city:'Dallas', county:'Dallas', phone:'(214) 653-5600', eligibility:'Serious mental illness, felony or misdemeanor', notes:'Partnered with Parkland Hospital' },
    // DUI Courts
    { name:'Fulton County DUI Court', court_type:'DUI', state:'GA', city:'Atlanta', county:'Fulton', phone:'(404) 612-4600', eligibility:'Repeat DUI offense or high BAC first offense', notes:'24-month intensive supervision program' },
    { name:'Johnson County DUI Court', court_type:'DUI', state:'KS', city:'Olathe', county:'Johnson', phone:'(913) 715-3400', eligibility:'2nd or subsequent DUI conviction', notes:'Ignition interlock required, random UA testing' },
    { name:'Ramsey County DUI Court', court_type:'DUI', state:'MN', city:'Saint Paul', county:'Ramsey', phone:'(651) 266-8266', eligibility:'Third or subsequent DWI, or second with aggravating factors', notes:'Sobriety court model, 24/7 monitoring' },
    { name:'Bernalillo County DWI Court', court_type:'DUI', state:'NM', city:'Albuquerque', county:'Bernalillo', phone:'(505) 841-7425', eligibility:'Felony DWI, 3rd or subsequent offense', notes:'18-month program, housing assistance available' },
  ];

  const courtStmt = db.prepare(`
    INSERT OR IGNORE INTO specialty_courts (name, court_type, state, city, county, phone, eligibility, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let courtCount = 0;
  for (const c of specialtyCourts) {
    try {
      courtStmt.run(c.name, c.court_type, c.state, c.city, c.county||null, c.phone||null, c.eligibility||null, c.notes||null);
      courtCount++;
    } catch(e) { /* table may not exist */ }
  }
  if (courtCount > 0) console.log(`  ✓ Specialty courts: ${courtCount} seeded`);

t(1); });


// ── Forum seed posts (TODO 3J) ──────────────────────────────────────────────
const FORUM_POSTS = [
  { category:'dui',         title:'First DUI — what actually happens at arraignment?',        body:'Got arrested for DUI last night, blew 0.09. Have a court date in 3 weeks. What should I expect at arraignment? Do I need to bring anything? Can I just plead not guilty and get a continuance?', is_ai:0 },
  { category:'dui',         title:'DUI with no prior record — will I go to jail?',             body:'First offense DUI in Tennessee, .12 BAC. No prior record, steady job, family. Public defender says I might be eligible for diversion. Has anyone done the DUI diversion program in TN? How long does it take?', is_ai:0 },
  { category:'drug',        title:'Simple possession of marijuana — felony or misdemeanor?',  body:'Got caught with about 30 grams in a state where recreational is still illegal. Officer said I could be charged with felony possession. I thought under an ounce was misdemeanor. What determines whether it is felony or not?', is_ai:0 },
  { category:'drug',        title:'Drug court vs. regular probation — worth it?',             body:'DA offered me either 3 years probation or drug court. Drug court sounds more intense but my attorney says it will get dismissed at the end. Anyone done drug court? Is the random testing and check-ins as bad as it sounds?', is_ai:0 },
  { category:'assault',     title:'Charged with assault — alleged victim is not pressing charges', body:'The person involved told police they do not want to press charges. My attorney says the state can still prosecute. How is that possible? Does it matter what the victim says if they do not want to pursue it?', is_ai:0 },
  { category:'assault',     title:'Self-defense claim — how do I prove it?',                  body:'I was charged with assault after a fight that I did not start. I have a witness who saw the other guy come at me first. How does a self-defense claim actually work? Does the prosecution have to disprove self-defense?', is_ai:0 },
  { category:'bail',        title:'Bond agent is asking for collateral — is that normal?',    body:'My bondsman wants my car title as collateral for a $15,000 bond. He is charging me 10% which I understand. But taking my car title on top of that seems excessive. Is that standard practice or is he trying to take advantage?', is_ai:0 },
  { category:'bail',        title:'Can bail be reduced after it is set?',                     body:'Judge set bail at $50,000 which my family cannot afford. Public defender says we can ask for a bail reduction hearing. How long does that take and what does the judge look at? What are the best arguments for reducing bail?', is_ai:0 },
  { category:'rights',      title:'Can police search my phone without a warrant?',            body:'During a traffic stop the officer demanded I unlock my phone. I refused and he threatened to arrest me for obstruction. Riley v. California says they need a warrant right? Was I right to refuse? What happens to the evidence if they search it illegally?', is_ai:0 },
  { category:'rights',      title:'Invoke the right to remain silent — but they keep questioning', body:'I told the detective "I am invoking my right to remain silent" but he kept talking and asking questions for another 20 minutes. Is that legal? Does the questioning have to stop immediately when I say that?', is_ai:0 },
  // AI-generated helpful answers
  { category:'dui',         title:'RE: First DUI arraignment — what to expect (answer)', is_pinned:1, is_ai:1, body:'At arraignment the judge will formally read the charges and ask for your plea. You should plead NOT GUILTY at this stage — this preserves all your options. Bring your ID. Your attorney will request discovery (dashcam, breathalyzer records, officer notes). A continuance is standard and expected. After arraignment comes the preliminary hearing (felony) or pre-trial conference (misdemeanor) where your attorney reviews the evidence. Do not discuss your case with anyone except your attorney.' },
  { category:'rights',      title:'RE: Police searching your phone — Riley v. California (answer)', is_pinned:1, is_ai:1, body:'You are correct. Riley v. California (2014) held unanimously that police must get a warrant before searching an arrestee's phone. Your refusal was legally correct. If they search without a warrant, the evidence may be suppressed under the exclusionary rule (Wong Sun v. United States). The officer's threat of obstruction for refusing an unconstitutional search was itself improper. Document everything: the officer's name, badge number, exact words used. Tell your attorney immediately.' },
  { category:'rights',      title:'RE: Right to remain silent — does questioning stop? (answer)', is_pinned:1, is_ai:1, body:'After Berghuis v. Thompkins (2010), the Supreme Court held that your invocation must be unambiguous AND you must stay silent for it to apply. The clearest language: "I am invoking my Fifth Amendment right to remain silent and I want an attorney." After that, questioning must stop under Edwards v. Arizona. However, if you continue talking or answering questions after invoking, courts may find you waived the right. The safest approach: invoke clearly, then say nothing more until your attorney is present.' },
];

(async () => {
  const { initDb, db } = await import('../db/index.js');
  await initDb();
  let inserted = 0;
  for (const post of FORUM_POSTS) {
    try {
      db.prepare(\`INSERT OR IGNORE INTO forum_posts 
        (user_id, category, title, body, upvotes, is_pinned, is_ai)
        VALUES (NULL, ?, ?, ?, 0, ?, ?)\`)
        .run(post.category, post.title, post.body, post.is_pinned||0, post.is_ai||0);
      inserted++;
    } catch(e) { /* already exists */ }
  }
  console.log(\`  ✓ Forum posts: \${inserted} seeded\`);
})().catch(e => console.error('Forum seed error:', e));


// ── Specialty courts seed (TODO 3K) ────────────────────────────────────────
const SPECIALTY_COURTS = [
  // Veterans Treatment Courts (sample — 600+ nationwide)
  { name:'Davidson County Veterans Treatment Court', court_type:'veteran', state:'TN', city:'Nashville', address:'1 Public Square, Nashville TN 37201', phone:'(615) 862-5600', judge:'Various', capacity:50, accepts_violent:0, notes:'Monthly docket; requires VSO referral' },
  { name:'Harris County Veterans Court', court_type:'veteran', state:'TX', city:'Houston', address:'1201 Franklin St, Houston TX 77002', phone:'(713) 755-6408', judge:'Various', capacity:75, accepts_violent:0, notes:'Largest VTC in Texas; peer mentor program' },
  { name:'Los Angeles County Veterans Court', court_type:'veteran', state:'CA', city:'Los Angeles', address:'210 W Temple St, Los Angeles CA 90012', phone:'(213) 972-1900', judge:'Various', capacity:100, accepts_violent:0, notes:'Multiple courthouses; VA partnership' },
  { name:'Broward County Veterans Treatment Court', court_type:'veteran', state:'FL', city:'Fort Lauderdale', address:'201 SE 6th St, Fort Lauderdale FL 33301', phone:'(954) 831-7735', judge:'Various', capacity:60, accepts_violent:0, notes:'Includes OTH discharge consideration' },
  { name:'Cook County Veterans Court', court_type:'veteran', state:'IL', city:'Chicago', address:'69 W Washington St, Chicago IL 60602', phone:'(312) 603-6000', judge:'Various', capacity:80, accepts_violent:0, notes:'Dedicated courtroom Division 78' },
  // Drug Courts (sample — 3,000+ nationwide)
  { name:'Davidson County Drug Court', court_type:'drug', state:'TN', city:'Nashville', address:'1 Public Square, Nashville TN 37201', phone:'(615) 862-5600', judge:'Various', capacity:75, accepts_violent:0, notes:'18-24 month program; graduation ceremony' },
  { name:'Miami-Dade Drug Court', court_type:'drug', state:'FL', city:'Miami', address:'73 W Flagler St, Miami FL 33130', phone:'(305) 349-5700', judge:'Various', capacity:200, accepts_violent:0, notes:'First drug court in US (1989)' },
  { name:'King County Drug Court', court_type:'drug', state:'WA', city:'Seattle', address:'516 3rd Ave, Seattle WA 98104', phone:'(206) 477-1300', judge:'Various', capacity:120, accepts_violent:0, notes:'Multiple tracks including HOPE program' },
  { name:'Harris County Drug Court', court_type:'drug', state:'TX', city:'Houston', address:'1201 Franklin St, Houston TX 77002', phone:'(713) 755-5900', judge:'Various', capacity:150, accepts_violent:0, notes:'Felony and misdemeanor tracks' },
  { name:'Cook County Drug Court', court_type:'drug', state:'IL', city:'Chicago', address:'69 W Washington St, Chicago IL 60602', phone:'(312) 603-6000', judge:'Various', capacity:200, accepts_violent:0, notes:'Multiple division locations' },
  // Mental Health Courts (sample — 300+ nationwide)
  { name:'Davidson County Mental Health Court', court_type:'mental_health', state:'TN', city:'Nashville', address:'1 Public Square, Nashville TN 37201', phone:'(615) 862-5700', judge:'Various', capacity:50, accepts_violent:0, notes:'Accepts misdemeanor and non-violent felony' },
  { name:'LA County Mental Health Court', court_type:'mental_health', state:'CA', city:'Los Angeles', address:'210 W Temple St, Los Angeles CA 90012', phone:'(213) 972-6000', judge:'Various', capacity:100, accepts_violent:0, notes:'AB 2162 compliance; CARE Court integrated' },
  { name:'Harris County Mental Health Court', court_type:'mental_health', state:'TX', city:'Houston', address:'1201 Franklin St, Houston TX 77002', phone:'(713) 755-6000', judge:'Various', capacity:75, accepts_violent:0, notes:'Felony and misdemeanor dockets' },
];

(async () => {
  const { initDb, db } = await import('../db/index.js');
  await initDb();
  let inserted = 0;
  for (const court of SPECIALTY_COURTS) {
    try {
      db.prepare(\`INSERT OR IGNORE INTO specialty_courts 
        (name, court_type, state, city, address, phone, judge, capacity, accepts_violent, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?)\`)
        .run(court.name, court.court_type, court.state, court.city,
             court.address, court.phone, court.judge||null,
             court.capacity||null, court.accepts_violent||0, court.notes||null);
      inserted++;
    } catch(e) { /* table might differ */ }
  }
  console.log(\`  ✓ Specialty courts: \${inserted} seeded\`);
})().catch(e => console.error('Specialty courts seed error:', e));

// ── Arrest seed data for demo mode (TODO 3L) ────────────────────────────────
const DEMO_ARRESTS = [
  { first_name:'James', last_name:'Martinez', dob:'1994-03-15', charge:'DUI - First Offense', charge_code:'DUI-1', booking_number:'2024-001847', booking_date:'2024-01-15 02:30:00', release_date:null, jail_name:'Davidson County Criminal Justice Center', jail_city:'Nashville', jail_state:'TN', bail_amount:1500, status:'in_custody', mugshot_url:null },
  { first_name:'Michael', last_name:'Thompson', dob:'1987-07-22', charge:'Felony Drug Possession', charge_code:'TCA39-17-418', booking_number:'2024-002291', booking_date:'2024-01-14 23:15:00', release_date:'2024-01-15 08:00:00', jail_name:'Davidson County Criminal Justice Center', jail_city:'Nashville', jail_state:'TN', bail_amount:5000, status:'released', mugshot_url:null },
  { first_name:'Robert', last_name:'Johnson', dob:'1999-11-08', charge:'Aggravated Assault', charge_code:'TCA39-13-102', booking_number:'2024-001923', booking_date:'2024-01-15 01:45:00', release_date:null, jail_name:'Davidson County Criminal Justice Center', jail_city:'Nashville', jail_state:'TN', bail_amount:15000, status:'in_custody', mugshot_url:null },
  { first_name:'David', last_name:'Williams', dob:'1991-05-30', charge:'DWI - First Offense', charge_code:'DWI-1', booking_number:'TX-2024-008847', booking_date:'2024-01-15 00:30:00', release_date:null, jail_name:'Harris County Jail', jail_city:'Houston', jail_state:'TX', bail_amount:500, status:'in_custody', mugshot_url:null },
  { first_name:'Christopher', last_name:'Davis', dob:'1985-09-14', charge:'Felony Drug Possession', charge_code:'THSC481.115', booking_number:'TX-2024-009102', booking_date:'2024-01-14 22:00:00', release_date:'2024-01-15 06:30:00', jail_name:'Harris County Jail', jail_city:'Houston', jail_state:'TX', bail_amount:10000, status:'released', mugshot_url:null },
  { first_name:'Anthony', last_name:'Garcia', dob:'1996-02-19', charge:'DUI - First Offense', charge_code:'DUI-1', booking_number:'CA-2024-047291', booking_date:'2024-01-15 03:15:00', release_date:null, jail_name:'Los Angeles County Jail', jail_city:'Los Angeles', jail_state:'CA', bail_amount:5000, status:'in_custody', mugshot_url:null },
  { first_name:'Kevin', last_name:'Anderson', dob:'1978-12-01', charge:'Aggravated Battery', charge_code:'FS784.045', booking_number:'FL-2024-012847', booking_date:'2024-01-14 21:30:00', release_date:null, jail_name:'Broward County Jail', jail_city:'Fort Lauderdale', jail_state:'FL', bail_amount:15000, status:'in_custody', mugshot_url:null },
  { first_name:'Brian', last_name:'Wilson', dob:'2001-06-11', charge:'Simple Assault', charge_code:'ASSAULT-SIMPLE', booking_number:'IL-2024-033918', booking_date:'2024-01-15 00:00:00', release_date:'2024-01-15 04:00:00', jail_name:'Cook County Jail', jail_city:'Chicago', jail_state:'IL', bail_amount:2500, status:'released', mugshot_url:null },
  { first_name:'Daniel', last_name:'Taylor', dob:'1993-08-27', charge:'DWI - Second Offense', charge_code:'DWI-2', booking_number:'TX-2024-009247', booking_date:'2024-01-14 23:45:00', release_date:null, jail_name:'Travis County Jail', jail_city:'Austin', jail_state:'TX', bail_amount:3000, status:'in_custody', mugshot_url:null },
  { first_name:'Joshua', last_name:'Moore', dob:'1989-04-03', charge:'Felony Drug Possession', charge_code:'PL220.18', booking_number:'NY-2024-089271', booking_date:'2024-01-15 02:00:00', release_date:null, jail_name:'Rikers Island', jail_city:'New York', jail_state:'NY', bail_amount:25000, status:'in_custody', mugshot_url:null },
];

(async () => {
  const { initDb, db } = await import('../db/index.js');
  await initDb();
  let inserted = 0;
  for (const arrest of DEMO_ARRESTS) {
    try {
      db.prepare(`INSERT OR IGNORE INTO arrests 
        (first_name, last_name, dob, charge, charge_code, booking_number, 
         booking_date, release_date, jail_name, jail_city, jail_state, 
         bail_amount, status, mugshot_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(arrest.first_name, arrest.last_name, arrest.dob, arrest.charge,
             arrest.charge_code, arrest.booking_number, arrest.booking_date,
             arrest.release_date, arrest.jail_name, arrest.jail_city,
             arrest.jail_state, arrest.bail_amount, arrest.status, arrest.mugshot_url);
      inserted++;
    } catch(e) { /* already exists or table differs */ }
  }
  console.log(`  ✓ Demo arrests: ${inserted} records seeded`);
})().catch(e => console.error('Arrest seed error:', e));
