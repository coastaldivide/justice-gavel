/**
 * immigration.js — Immigration legal rights and tools
 * Covers: asylum, detention rights, voluntary departure, DACA, VAWA, TPS
 * All AI responses include UPL disclaimer.
 */
import { Router }       from 'express';
import { authRequired } from '../middleware/auth.js';
import { apiLimiter }   from '../middleware/rateLimiters.js';
import { getDb }        from '../db/index.js';

const router = Router();

// ── GET /immigration/rights — Know your rights as an immigrant ────────────
router.get('/rights', apiLimiter, (req, res) => {
  const lang = req.headers['accept-language']?.split(',')[0]?.split('-')[0] || 'en';
  
  const rights = {
    en: [
      { title: 'Right to Remain Silent', body: 'You have the right to remain silent. You do not have to answer questions from ICE or CBP about your immigration status, where you were born, or how you entered the US. Say: "I am exercising my right to remain silent."' },
      { title: 'Right to an Attorney', body: 'You have the right to speak with a lawyer before answering questions. While you do not have a right to a free government-appointed attorney in immigration proceedings, you may hire one. Ask for the list of free legal services.' },
      { title: 'Right to a Hearing', body: 'You have the right to appear before an immigration judge before being deported (with some exceptions for people caught near the border or those with prior orders of removal).' },
      { title: 'Do Not Sign Anything', body: 'Do not sign any document you do not understand. Signing a "voluntary departure" or "stipulated removal" order gives up important rights. Ask for time to speak with an attorney first.' },
      { title: 'If ICE Comes to Your Home', body: 'You do not have to open the door. Ask if they have a warrant signed by a judge. A deportation warrant alone does not give them the right to enter. Only a judicial warrant allows entry.' },
      { title: 'Right to Contact Your Consulate', body: 'If detained, you have the right to contact your country\'s consulate. Ask ICE or CBP to notify your consulate upon arrest.' },
    ],
    es: [
      { title: 'Derecho a Guardar Silencio', body: 'Tiene el derecho de guardar silencio. No tiene que responder preguntas de ICE o CBP sobre su estado migratorio. Diga: "Estoy ejerciendo mi derecho a guardar silencio."' },
      { title: 'Derecho a un Abogado', body: 'Tiene el derecho de hablar con un abogado antes de responder preguntas. Puede contratar un abogado o solicitar la lista de servicios legales gratuitos.' },
      { title: 'Derecho a una Audiencia', body: 'Tiene el derecho de aparecer ante un juez de inmigración antes de ser deportado (con algunas excepciones).' },
      { title: 'No Firme Nada', body: 'No firme ningún documento que no entienda. Firmar una orden de "salida voluntaria" renuncia a derechos importantes.' },
      { title: 'Si ICE Viene a su Casa', body: 'No tiene que abrir la puerta. Pregunte si tienen una orden firmada por un juez. Solo una orden judicial les permite entrar.' },
      { title: 'Derecho a Contactar su Consulado', body: 'Si es detenido, tiene el derecho de contactar el consulado de su país. Pida a ICE que notifique a su consulado.' },
    ],
  };

  return res.json({
    lang,
    rights: rights[lang] || rights.en,
    disclaimer: 'This information is educational. It is not legal advice. Consult a licensed immigration attorney for your specific situation.',
    emergency_resources: [
      { name: 'ICE Detention Hotline', number: '1-888-385-0355' },
      { name: 'National Immigration Law Center', url: 'https://nilc.org' },
      { name: 'ACLU Know Your Rights', url: 'https://www.aclu.org/know-your-rights/immigrants-rights' },
    ],
  });
});

// ── POST /immigration/asylum-clock — calculate days on asylum clock ────────
router.post('/asylum-clock', authRequired, async (req, res) => {
  const { filing_date, case_type = 'defensive' } = req.body;
  if (!filing_date) return res.status(400).json({ error: 'filing_date required (YYYY-MM-DD)' });

  const filed   = new Date(filing_date);
  const today   = new Date();
  const days    = Math.floor((today - filed) / (1000 * 60 * 60 * 24));

  // 180 days required for EAD eligibility (with some exceptions)
  const ead_eligible_days = 180;
  const days_until_ead    = Math.max(0, ead_eligible_days - days);

  return res.json({
    filing_date,
    days_elapsed:      days,
    ead_eligible:      days >= ead_eligible_days,
    days_until_ead:    days_until_ead,
    ead_eligible_date: new Date(filed.getTime() + ead_eligible_days * 86400000).toISOString().split('T')[0],
    case_type,
    note: 'The asylum clock may be paused by delays caused by the applicant. Verify status with your attorney.',
    disclaimer: 'Not legal advice. Consult an immigration attorney.',
  });
});

// ── POST /immigration/voluntary-departure — deadline calculator ───────────
router.post('/voluntary-departure', authRequired, (req, res) => {
  const { grant_date, days_granted = 60 } = req.body;
  if (!grant_date) return res.status(400).json({ error: 'grant_date required (YYYY-MM-DD)' });

  const granted  = new Date(grant_date);
  const deadline = new Date(granted.getTime() + parseInt(days_granted, 10) * 86400000);
  const today    = new Date();
  const remaining = Math.max(0, Math.floor((deadline - today) / (1000 * 60 * 60 * 24)));

  return res.json({
    grant_date,
    days_granted: parseInt(days_granted, 10),
    departure_deadline: deadline.toISOString().split('T')[0],
    days_remaining: remaining,
    status: remaining === 0 ? 'EXPIRED — seek legal counsel immediately'
           : remaining <= 7 ? 'URGENT — depart or seek extension now'
           : remaining <= 30 ? 'WARNING — time is running short'
           : 'On track',
    consequences: 'Failure to depart by the deadline results in a 10-year bar to re-entry and a civil penalty of $1,000–$5,000.',
    disclaimer: 'Not legal advice. Consult an immigration attorney before your deadline.',
  });
});

// ── GET /immigration/relief-options — summary of available relief ─────────
router.get('/relief-options', apiLimiter, (req, res) => {
  return res.json({
    options: [
      { name: 'Asylum',              eligibility: 'Fear of persecution based on race, religion, nationality, political opinion, or social group', deadline: 'Must apply within 1 year of entry', path: '/immigration/asylum-clock' },
      { name: 'Withholding of Removal', eligibility: 'Higher standard than asylum — more likely than not to be persecuted', deadline: 'No filing deadline', path: null },
      { name: 'VAWA (Violence Against Women Act)', eligibility: 'Abuse by US citizen or permanent resident spouse, parent, or child', deadline: 'No firm deadline', path: null },
      { name: 'U Visa',              eligibility: 'Victim of certain crimes who cooperated with law enforcement', deadline: 'Annual cap of 10,000 — long wait list', path: null },
      { name: 'T Visa',              eligibility: 'Victim of human trafficking', deadline: 'No firm deadline', path: null },
      { name: 'TPS (Temporary Protected Status)', eligibility: 'Nationals of designated countries facing ongoing armed conflict or disaster', deadline: 'Varies by country designation', path: null },
      { name: 'DACA (Deferred Action)', eligibility: 'Brought to US before age 16, continuously resided since June 15, 2007', deadline: 'Renewal every 2 years if eligible', path: null },
      { name: 'Cancellation of Removal', eligibility: 'LPR: 5 yrs residence + 7 yrs continuous. Non-LPR: 10 yrs + exceptional hardship to US citizen/LPR family', deadline: 'Only available in removal proceedings', path: null },
    ],
    disclaimer: 'Eligibility summaries only. Each case is fact-specific. Consult a licensed immigration attorney.',
  });
});

export default router;
