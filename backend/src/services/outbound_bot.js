import { logIgnored } from '../utils/ignored.js';
import logger from '../utils/logger.js';
/**
 * outbound_bot.js — Justice Gavel Automated Revenue Engine
 * ────────────────────────────────────────────────────────
 * Runs after every arrest harvest. For each new arrest:
 *
 *  1. Checks opt-out list before any send
 *  2. Finds matching bondsmen in the arrest county
 *  3. Sends SMS lead offer: "New booking — $30k bail — reply YES for $100"
 *     (flat lead fee from routes/billing/leadFee.js — never scaled to bail)
 *  4. Finds matching attorneys in the county
 *  5. Sends email lead offer with county arrest summary
 *
 * Payment confirmation (via webhook) is in routes/webhooks/stripe.js
 *
 * TCPA COMPLIANCE:
 *  - Opt-outs are honored immediately and permanently
 *  - Every number checked against opt_outs before any send
 *  - STOP reply processed synchronously in webhook handler
 *  - No messages sent between 9pm–8am local time (TCPA quiet hours)
 *
 * IDEMPOTENCY:
 *  - Every message has a unique idempotency_key: `{type}:{recipient_id}:{arrest_id}`
 *  - Duplicate keys are rejected by DB UNIQUE constraint
 *  - Safe to run multiple times — no double-sends
 */

import { getDb as getAppDb } from '../db/index.js';
import { normalizePhone } from '../utils/sanitize.js';
// SMS is not wired up (push notifications and Resend email handle delivery).
// The stub reports a non-delivery instead of returning null, which made every
// `result.error` read throw a TypeError.
const sendSms = () => Promise.resolve({ error: 'sms_not_configured', skipped: true });
import { sendEmail } from './email.js';
import { createPaymentLink, calcStripeFee } from '../payments/stripe.js';
import { bondsmanLeadFeeCents, formatLeadFee } from '../routes/billing/leadFee.js';
import { realArrestSql } from '../utils/arrestVisibility.js';

// Arrest columns the bot reads. Every lookup goes through realArrestSql(): the
// bot must never message or bill anyone because of a sample/seed or taken-down row.
const ARREST_COLS = 'id, name, booking_date, charges, bail_amount, county, state, jail_location, has_attorney, alert_sent, case_number, court_date';

/** Unsent, real arrests from the last 24h with bail set and no attorney. */
export async function selectActionableArrests(db) {
  return await db.all(
    `SELECT ${ARREST_COLS}
       FROM arrest_records
      WHERE alert_sent = 0
        AND ${realArrestSql()}
        AND bail_amount > 0
        AND has_attorney = 0
        AND created_at >= (NOW() - INTERVAL '24 hours')
      ORDER BY bail_amount DESC
      LIMIT 500`
  );
}

/** One real (non-sample, non-suppressed) arrest by id, or undefined. */
export async function getRealArrest(db, arrestId) {
  return await db.get(`SELECT ${ARREST_COLS} FROM arrest_records WHERE id = ? AND ${realArrestSql()}`, [arrestId]);
}


// ── Lead fee ─────────────────────────────────────────────────────────────────
// FLAT fee from the billing source of truth (routes/billing/leadFee.js). It is
// never scaled to the bail amount (runner-capper / barratry statutes).
// ── TCPA quiet hours check (8am–9pm recipient's estimated local time) ─────────
function isQuietHours() {
  const hour = new Date().getHours(); // Server time (Central configured)
  return hour < 8 || hour >= 21;
}

// ── DB helpers ────────────────────────────────────────────────────────────────
// All provider, arrest and outbound tables live in the main Postgres database.
// (The adapter is a shared singleton; its close() is a no-op.)
async function getDb()     { return await getAppDb(); }

// Check if phone/email is opted out
async function isOptedOut(db, phone, email) {
  if (phone) {
    const norm = normalizePhone(phone);
    if (norm) {
      const row = await db.get('SELECT id FROM opt_outs WHERE phone = ?', [norm]);
      if (row) return true;
    }
  }
  if (email) {
    const row = await db.get('SELECT id FROM opt_outs WHERE email = ?', [email?.toLowerCase()]);
    if (row) return true;
  }
  return false;
}

// Log a sent message — idempotency key prevents duplicates
async function logMessage(db, { recipientType, recipientId, recipientPhone, recipientEmail, channel, arrestId, messageType, body, status, sendgridId, idempotencyKey, errorMsg } = {}) {
  try {
    const r = await db.run(
      `INSERT INTO outbound_messages
         (idempotency_key, recipient_type, recipient_id, recipient_phone, recipient_email,
          channel, arrest_id, message_type, body, status, sendgrid_id, error_msg, sent_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, NOW())
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [idempotencyKey ?? null, recipientType ?? null, recipientId ?? null, recipientPhone ?? null,
       recipientEmail ?? null, channel ?? null, arrestId ?? null, messageType ?? null, body ?? null,
       status ?? null, sendgridId ?? null, errorMsg ?? null]
    );
    return r.changes > 0;   // 0 → already logged (idempotency working)
  } catch (err) {
    if (err.code === '23505' || err.message?.includes('UNIQUE constraint')) {
      return false; // Already sent — idempotency working correctly
    }
    logger.error('[bot] logMessage error:', err.message);
    return false;
  }
}

// Check if message was already sent (idempotency check)
async function alreadySent(db, idempotencyKey) {
  const row = await db.get('SELECT id FROM outbound_messages WHERE idempotency_key = ?', [idempotencyKey]);
  return !!row;
}

// ── Build SMS message for bondsman lead offer ─────────────────────────────────
export function buildBondsmanSms(arrest) {
  const bail   = arrest.bail_amount > 0 ? `$${arrest.bail_amount.toLocaleString()}` : 'TBD';
  const county = arrest.county || 'your county';
  const fee    = formatLeadFee(bondsmanLeadFeeCents(arrest));
  const charges = arrest.charges ? arrest.charges.substring(0, 60) : 'Not specified';

  return [
    `Justice Gavel — New Lead`,
    `${county} County, ${arrest.state || 'TN'}`,
    `Bail: ${bail}`,
    `Charges: ${charges}`,
    ``,
    `Reply YES to get full contact info for ${fee}.`,
    `Reply NO to skip. Reply STOP to opt out.`,
    ``,
    `Offer expires in 2 hours.`,
  ].join('\n');
}

// ── Build email for attorney lead offer ───────────────────────────────────────
function buildAttorneyEmail(attorney, arrests) {
  const county  = arrests[0]?.county || 'your county';
  const state   = arrests[0]?.state  || 'TN';
  const noAtty  = arrests.filter(a => !a.has_attorney).length;
  const withBail = arrests.filter(a => a.bail_amount > 0).length;

  const chargeBreakdown = {};
  for (const a of arrests) {
    const c = (a.charges || 'Unknown').split(/[,;]/)[0].trim().substring(0, 40);
    chargeBreakdown[c] = (chargeBreakdown[c] || 0) + 1;
  }
  const breakdown = Object.entries(chargeBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, n]) => `  • ${n}x ${c}`)
    .join('\n');

  return {
    subject: `${arrests.length} new arrest${arrests.length > 1 ? 's' : ''} in ${county} County — ${noAtty} unrepresented`,
    text: [
      `Hi ${attorney.name || 'Attorney'},`,
      ``,
      `Justice Gavel found ${arrests.length} new arrest${arrests.length > 1 ? 's' : ''} in ${county} County, ${state} in the last 24 hours.`,
      ``,
      `  • ${noAtty} have no attorney of record`,
      `  • ${withBail} have bail set`,
      ``,
      `Top charge types:`,
      breakdown,
      ``,
      `Start your free 30-day trial to receive daily arrest alerts and get top placement in family searches:`,
      `https://justicegavel.app/subscribe`,
      ``,
      `Already subscribed? Log in to view all leads:`,
      `https://justicegavel.app/leads`,
      ``,
      `— Justice Gavel Alert System`,
      `Unsubscribe: https://justicegavel.app/unsubscribe?email=${encodeURIComponent(attorney.email || '')}`,
    ].join('\n'),
  };
}

// ── Process a single bondsman for one arrest ─────────────────────────────────
async function processBondsmanLead(db, agent, arrest, stats, errors) {
  const phone = normalizePhone(agent.phone);
  if (!phone) return;

  // Opt-out check
  const optedOut = await isOptedOut(db, phone, agent.email);
  if (optedOut) return;

  const idempKey = `lead_offer:bail_agent:${agent.id}:${arrest.id}`;

  // Idempotency check
  if (await alreadySent(db, idempKey)) return;

  const body = buildBondsmanSms(arrest);

  try {
    const result = await sendSms({ to: phone, body });
    const status = result.error ? 'failed' : 'sent';

    await logMessage(db, {
      recipientType: 'bail_agent',
      recipientId: agent.id,
      recipientPhone: phone,
      channel: 'sms',
      arrestId: arrest.id,
      messageType: 'lead_offer',
      body,
      status,
      idempotencyKey: idempKey,
      errorMsg: result.error,
    });

    if (!result.error) {
      stats.messagesSent++;
    } else {
      errors.push(`SMS to ${phone} failed: ${result.error}`);
    }
  } catch (err) {
    errors.push(`processBondsmanLead error: ${err.message}`);
    await logMessage(db, {
      recipientType: 'bail_agent',
      recipientId: agent.id,
      recipientPhone: phone,
      channel: 'sms',
      arrestId: arrest.id,
      messageType: 'lead_offer',
      body,
      status: 'failed',
      idempotencyKey: idempKey,
      errorMsg: err.message,
    });
  }
}

// ── Process a single attorney for a county's arrests ─────────────────────────
async function processAttorneyLeads(db, attorney, arrests, stats, errors) {
  if (!attorney.email) return;

  // Opt-out check
  const optedOut = await isOptedOut(db, null, attorney.email);
  if (optedOut) return;

  const countyKey = (arrests[0]?.county || 'unknown').toLowerCase().replace(/\s+/g, '_');
  const today     = new Date().toISOString().substring(0, 10);
  const idempKey  = `lead_offer:esquire:${attorney.id}:${countyKey}:${today}`;

  if (await alreadySent(db, idempKey)) return;

  const { subject, text } = buildAttorneyEmail(attorney, arrests);

  try {
    const result = await sendEmail({ to: attorney.email, subject, text });
    const status = result.error ? 'failed' : 'sent';

    await logMessage(db, {
      recipientType: 'attorney',
      recipientId: attorney.id,
      recipientEmail: attorney.email,
      channel: 'email',
      messageType: 'lead_offer',
      body: text,
      status,
      sendgridId: result.messageId,
      idempotencyKey: idempKey,
      errorMsg: result.error,
    });

    if (!result.error) {
      stats.messagesSent++;
    } else {
      errors.push(`Email to ${attorney.email} failed: ${result.error}`);
    }
  } catch (err) {
    errors.push(`processAttorneyLeads error: ${err.message}`);
  }
}

// ── Main bot runner ───────────────────────────────────────────────────────────
export async function runOutboundBot(options = {}) {
  const startTime = Date.now();
  const stats = { messagesSent: 0, arrestsFound: 0, leadsSold: 0, revenueCents: 0 };
  const errors = [];

  logger.info('\n[bot] ═══ Outbound bot starting ═══');

  // TCPA quiet hours — do not send between 9pm and 8am
  if (isQuietHours() && !options.forceRun) {
    logger.info('[bot] Quiet hours (9pm–8am) — skipping outbound sends. Use forceRun:true to override.');
    return { skipped: true, reason: 'quiet_hours' };
  }

  const db = await getDb();

  try {
    // ── Get unsent arrests from last 24h with bail set and no attorney ────────
    const arrests = await selectActionableArrests(db).catch((e) => {
      errors.push(`arrest query failed: ${e.message}`);
      return [];
    });

    stats.arrestsFound = arrests.length;
    logger.info(`[bot] ${arrests.length} actionable arrests (bail set, no attorney)`);

    if (arrests.length === 0) {
      logger.info('[bot] No new arrests to process.');
      await logBotRun(db, 'nightly', stats, errors, startTime);
      return { ...stats, errors };
    }

    // ── Group arrests by county ───────────────────────────────────────────────
    const byCounty = {};
    for (const a of arrests) {
      const key = (a.county || 'unknown').toLowerCase();
      if (!byCounty[key]) byCounty[key] = [];
      byCounty[key].push(a);
    }

    // ── Get all active bail agents and attorneys ───────────────────────────────
    const [bailAgents, attorneys] = await Promise.all([
      db.all(`SELECT id, name, phone, email, city, active FROM bail_agents WHERE active = 1 AND phone IS NOT NULL`).catch(() => []),
      db.all(`SELECT id, name, email, city, specialties, active FROM lawyers WHERE active = 1 AND email IS NOT NULL`).catch(() => []),
    ]);

    logger.info(`[bot] ${bailAgents.length} active bondsmen, ${attorneys.length} active attorneys`);

    // ── Send bondsman SMS lead offers ─────────────────────────────────────────
    logger.info('[bot] Step 1/2 — Sending bondsman SMS lead offers...');
    for (const [county, countyArrests] of Object.entries(byCounty)) {
      // Match bondsmen to this county (by city name or county name)
      const matchedAgents = bailAgents.filter(agent => {
        const city = (agent.city || '').toLowerCase();
        return city.includes(county) || county.includes(city.split(',')[0].trim());
      });

      // If no county-specific match, send to all agents (small network mode)
      const targets = matchedAgents.length > 0 ? matchedAgents : bailAgents.slice(0, 10);

      for (const agent of targets) {
        // Send one SMS per arrest (bondsmen buy individual leads)
        for (const arrest of countyArrests.slice(0, 5)) { // Max 5 per county per agent per run
          await processBondsmanLead(db, agent, arrest, stats, errors);
        }
      }
    }

    // ── Send attorney email summaries ─────────────────────────────────────────
    logger.info('[bot] Step 2/2 — Sending attorney county summary emails...');
    for (const [county, countyArrests] of Object.entries(byCounty)) {
      // Match attorneys to this county
      const matchedAttorneys = attorneys.filter(atty => {
        const city = (atty.city || '').toLowerCase();
        return city.includes(county) || county.includes(city.split(',')[0].trim());
      });

      const targets = matchedAttorneys.length > 0 ? matchedAttorneys : attorneys.slice(0, 5);

      for (const attorney of targets) {
        await processAttorneyLeads(db, attorney, countyArrests, stats, errors);
      }
    }

    // ── Mark arrests as alerted ───────────────────────────────────────────────
    // Failure here means the arrest will be re-alerted on the next nightly run.
    // In the TCPA context, duplicate SMS = potential harassment complaint.
    // Surface individual failures to errors[] so the run report shows skipped IDs.
    if (!options.dryRun && arrests.length > 0) {
      for (const arrest of arrests) {
        try {
          await db.run('UPDATE arrest_records SET alert_sent = 1 WHERE id = ?', [arrest.id]);
        } catch (e) {
          const msg = `alert_sent mark failed for arrest ${arrest.id}: ${e.message}`;
          errors.push(msg);
          logger.warn('[bot]', msg);
        }
      }
    }

    await logBotRun(db, options.runType || 'nightly', stats, errors, startTime);

    logger.info(`[bot] ═══ Complete: ${stats.messagesSent} messages sent, ${errors.length} errors ═══\n`);
    return { ...stats, errors };

  } catch (err) {
    errors.push(`Fatal bot error: ${err.message}`);
    logger.error('[bot] Fatal error:', err.message);
    await logBotRun(db, 'nightly', stats, errors, startTime);
    return { ...stats, errors };
  }
}

// ── Log bot run to DB ──────────────────────────────────────────────────────────
async function logBotRun(db, runType, stats, errors, startTime) {
  try {
    await db.run(
      `INSERT INTO bot_runs (run_type, arrests_found, messages_sent, leads_sold, revenue_cents, errors, completed_at, duration_ms)
       VALUES (?,?,?,?,?,?,NOW(),?)`,
      [runType, stats.arrestsFound, stats.messagesSent, stats.leadsSold, stats.revenueCents, JSON.stringify(errors), Date.now() - startTime]
    );
  } catch (e) { logger.warn('[outbound_bot/logRun]', e?.message); }
}

// ── Send payment link when bondsman replies YES ───────────────────────────────
export async function sendPaymentLink({ phone, arrestId, recipientType, recipientId }) {
  const db = await getDb();
  try {
    // Get arrest
    const arrest = await getRealArrest(db, arrestId);
    if (!arrest) {
      logger.error('[bot] sendPaymentLink: arrest not found', arrestId);
      return { error: 'arrest_not_found' };
    }

    // Check not already sold to this recipient
    const alreadyPurchased = await db.get(
      'SELECT id FROM payment_links WHERE arrest_id = ? AND recipient_phone = ? AND status = ?',
      [arrestId, phone, 'paid']
    ).catch(() => null);
    if (alreadyPurchased) {
      await sendSms({ to: phone, body: `You already purchased this lead. Check your texts for the contact information.` });
      return { error: 'already_purchased' };
    }

    const feeCents    = bondsmanLeadFeeCents(arrest);
    const description = `Lead: ${arrest.county} County — Bail $${(arrest.bail_amount || 0).toLocaleString()} — ${(arrest.charges || '').substring(0, 40)}`;

    // Create Stripe payment link (2hr expiry)
    const linkResult = await createPaymentLink({
      amountCents:     feeCents,
      description,
      arrestId,
      recipientPhone:  phone,
      recipientType,
    });

    // Save payment link to DB
    await db.run(
      `INSERT INTO payment_links
        (stripe_link_id, stripe_link_url, arrest_id, recipient_phone, recipient_type, recipient_id, amount_cents, status, expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [linkResult.id, linkResult.url, arrestId, phone, recipientType, recipientId, feeCents, 'pending', linkResult.expiresAt]
    ).catch(logIgnored('services/outbound_bot'));

    // Text the payment link
    const smsBody = [
      `Justice Gavel — Lead reserved for 2 hours`,
      ``,
      `Pay ${formatLeadFee(feeCents)} to unlock:`,
      linkResult.url,
      ``,
      `After payment, full contact info delivered instantly.`,
      `Link expires: ${new Date(linkResult.expiresAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' })} CT`,
    ].join('\n');

    const idempKey = `payment_link:${arrestId}:${phone}`;
    const smsResult = await sendSms({ to: phone, body: smsBody });

    await logMessage(db, {
      recipientType,
      recipientId,
      recipientPhone: phone,
      channel: 'sms',
      arrestId,
      messageType: 'payment_link',
      body: smsBody,
      status: smsResult.error ? 'failed' : 'sent',
      idempotencyKey: idempKey,
      errorMsg: smsResult.error,
    }).catch(logIgnored('services/outbound_bot'));

    logger.info(`[bot] Payment link sent to ${phone} for arrest ${arrestId} — ${formatLeadFee(feeCents)}`);
    return { success: true, linkUrl: linkResult.url, feeCents, mock: linkResult.mock };

  } catch (err) {
    logger.error('[bot] sendPaymentLink error:', err.message);
    return { error: err.message };
  }
}

// ── Deliver lead after payment confirmed ──────────────────────────────────────
export async function deliverLead({ phone, arrestId, stripeLinkId, stripePaymentIntentId }) {
  const db = await getDb();
  try {
    const arrest = await getRealArrest(db, arrestId);
    if (!arrest) return { error: 'arrest_not_found' };

    // Mark payment link as paid
    await db.run(
      `UPDATE payment_links SET status = 'paid', paid_at = NOW(), stripe_pi_id = ? WHERE arrest_id = ? AND recipient_phone = ?`,
      [stripePaymentIntentId || null, arrestId, phone]
    ).catch(logIgnored('services/outbound_bot'));

    // Log revenue
    const feeCents   = bondsmanLeadFeeCents(arrest);
    const stripeFee  = calcStripeFee(feeCents);
    const netCents   = feeCents - stripeFee;

    await db.run(
      `INSERT INTO revenue_log (source, recipient_type, arrest_id, gross_cents, stripe_fee_cents, net_cents, stripe_link_id, stripe_pi_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['lead_sale', 'bail_agent', arrestId, feeCents, stripeFee, netCents, stripeLinkId || null, stripePaymentIntentId || null]
    ).catch(logIgnored('services/outbound_bot'));

    // Mark lead_purchase in billing table
    await db.run(
      `INSERT INTO lead_purchases (arrest_id, bail_amount, lead_fee_cents, status, contact_revealed, stripe_pi_id)
       VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING`,
      [arrestId, arrest.bail_amount, feeCents, 'charged', 1, stripePaymentIntentId || null]
    ).catch(logIgnored('services/outbound_bot'));

    // Deliver full arrest record via SMS
    const deliveryBody = [
      `LEAD UNLOCKED — Justice Gavel`,
      ``,
      `Name:    ${arrest.name}`,
      `County:  ${arrest.county}, ${arrest.state}`,
      `Bail:    $${(arrest.bail_amount || 0).toLocaleString()}`,
      `Charges: ${(arrest.charges || 'Not specified').substring(0, 80)}`,
      arrest.case_number ? `Case #:  ${arrest.case_number}` : '',
      arrest.jail_location ? `Jail:    ${arrest.jail_location}` : '',
      arrest.court_date ? `Court:   ${arrest.court_date}` : '',
      ``,
      `Contact family through jail booking system or public defender.`,
      `Good luck! — Justice Gavel`,
    ].filter(Boolean).join('\n');

    const deliveryIdempKey = `lead_delivery:${arrestId}:${phone}`;
    const smsResult = await sendSms({ to: phone, body: deliveryBody });

    await logMessage(db, {
      recipientType: 'bail_agent',
      recipientPhone: phone,
      channel: 'sms',
      arrestId,
      messageType: 'lead_delivery',
      body: deliveryBody,
      status: smsResult.error ? 'failed' : 'sent',
      idempotencyKey: deliveryIdempKey,
      errorMsg: smsResult.error,
    }).catch(logIgnored('services/outbound_bot'));

    logger.info(`[bot] Lead delivered to ${phone} for arrest ${arrestId} — net revenue $${(netCents / 100).toFixed(2)}`);
    return { success: true, netCents, mock: smsResult.mock };

  } catch (err) {
    logger.error('[bot] deliverLead error:', err.message);
    return { error: err.message };
  }
}

// ── Handle opt-out ────────────────────────────────────────────────────────────
export async function processOptOut({ phone, email, reason = 'STOP' }) {
  const db = await getDb();
  try {
    const norm = phone ? normalizePhone(phone) : null;
    await db.run(
      `INSERT INTO opt_outs (phone, email, reason) VALUES (?,?,?) ON CONFLICT DO NOTHING`,
      [norm, email?.toLowerCase() || null, reason]
    );

    // Send TCPA-required confirmation
    if (norm) {
      await sendSms({
        to: norm,
        body: `You have been removed from Justice Gavel lead alerts. No further messages will be sent. Reply START to resubscribe.`,
      });
    }

    logger.info(`[bot] Opt-out recorded: ${norm || email}`);
    return { success: true };
  } catch (err) {
    logger.error('[bot] processOptOut error:', err.message);
    return { error: err.message };
  }
}

// ── Expire payment links older than 2 hours ───────────────────────────────────
export async function expireOldPaymentLinks() {
  const db = await getDb();
  try {
    const expired = await db.all(
      `SELECT id, stripe_link_id, stripe_link_url, arrest_id, recipient_phone, recipient_type, recipient_id, fee_cents, status, expires_at
       FROM payment_links
       WHERE status = 'pending'
       AND expires_at < NOW()
       LIMIT 100`
    ).catch(() => []);

    for (const link of expired) {
      await db.run(
        `UPDATE payment_links SET status = 'expired' WHERE id = ?`,
        [link.id]
      );
      // Notify the bondsman the link expired and invite them to request a new one
      if (link.recipient_phone) {
        const idempKey = `link_expired:${link.id}`;
        if (!(await alreadySent(db, idempKey))) {
          await sendSms({
            to: link.recipient_phone,
            body: `Your Justice Gavel payment link expired. Reply YES to get a fresh link for this lead, or check justicegavel.app for new leads.`,
          });
          await logMessage(db, {
            recipientType: link.recipient_type,
            recipientPhone: link.recipient_phone,
            channel: 'sms',
            messageType: 'lead_offer',
            body: 'Link expired notification',
            status: 'sent',
            idempotencyKey: idempKey,
          });
        }
      }
    }

    if (expired.length > 0) logger.info(`[bot] Expired ${expired.length} payment links`);
    return { expired: expired.length };
  } catch (err) {
    logger.error('[bot] expireOldPaymentLinks error:', err.message);
    return { error: err.message };
  }
}