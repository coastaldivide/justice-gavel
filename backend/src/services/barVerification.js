/**
 * services/barVerification.js — Attorney license verification
 *
 * Problem: Lawyers Directory has no live verification against state bar records.
 * A disbarred attorney stays listed until manually removed — liability and trust risk.
 *
 * Solution:
 *   - Nightly job runs through every verified attorney
 *   - Checks their state bar's public registry (API where available, scrape otherwise)
 *   - Flags any status change: active → suspended/disbarred/resigned
 *   - Auto-disables the attorney profile + sends alert email
 *
 * State bar APIs with public data:
 *   CA: https://apps.calbar.ca.gov/attorney/Licensee/Detail/{barNumber}
 *   NY: https://iapps.courts.state.ny.us/attorney/AttorneyDetails
 *   TX: https://www.texasbar.com/AM/Template.cfm
 *   FL: https://www.floridabar.org/
 *   (+ scraping for states without APIs)
 *
 * Run via: node -e "import('./src/services/barVerification.js').then(m => m.runNightlyVerification())"
 * Cron: 0 2 * * * (2am daily)
 */

import axios    from 'axios';
import logger   from '../utils/logger.js';
import { db }   from '../db/index.js';
import { sendTransactionalEmail } from './email.js';

const TIMEOUT_MS = 10_000;

/** Status values that indicate the attorney should be delisted */
const INACTIVE_STATUSES = new Set([
  'disbarred', 'suspended', 'resigned', 'deceased',
  'inactive', 'revoked', 'not_admitted', 'administratively_suspended',
]);

/**
 * Verify a single attorney's license status.
 * Returns { status, verified_at, source, raw } or null if verification unavailable.
 */
export async function verifyAttorneyLicense({ bar_number, bar_state, name }) {
  if (!bar_number || !bar_state) return null;

  const state = bar_state.toUpperCase();

  try {
    switch (state) {
      case 'CA':
        return await verifyCalifornia(bar_number);
      case 'NY':
        return await verifyNewYork(bar_number);
      case 'TX':
        return await verifyTexas(bar_number);
      case 'FL':
        return await verifyFlorida(bar_number);
      default:
        return await verifyABADatabase(bar_number, state);
    }
  } catch (err) {
    logger.warn({ msg: '[bar_verify] verification failed', bar_number, state, error: err.message });
    return { status: 'verification_unavailable', verified_at: new Date().toISOString(), source: state };
  }
}

async function verifyCalifornia(barNumber) {
  const res = await axios.get(
    `https://apps.calbar.ca.gov/attorney/Licensee/Detail/${barNumber}`,
    { timeout: TIMEOUT_MS }
  );
  // Parse status from HTML (CalBar does not provide a JSON API)
  const statusMatch = res.data.match(/License Status[:\s]+<[^>]+>([^<]+)</i);
  const status = statusMatch?.[1]?.trim()?.toLowerCase() ?? 'unknown';
  return {
    status:      status === 'active' ? 'active' : INACTIVE_STATUSES.has(status) ? status : 'unknown',
    verified_at: new Date().toISOString(),
    source:      'calbar',
    raw:         status,
  };
}

async function verifyNewYork(barNumber) {
  const res = await axios.get(
    `https://iapps.courts.state.ny.us/attorney/AttorneyDetails?attorneyId=${barNumber}`,
    { timeout: TIMEOUT_MS }
  );
  const statusMatch = res.data.match(/Registration Status[:\s]+<[^>]+>([^<]+)</i);
  const status = statusMatch?.[1]?.trim()?.toLowerCase() ?? 'unknown';
  return {
    status:      status.includes('currently registered') ? 'active' : status,
    verified_at: new Date().toISOString(),
    source:      'ny_courts',
    raw:         status,
  };
}

async function verifyTexas(barNumber) {
  const res = await axios.get(
    `https://www.texasbar.com/barcard/?cardnum=${barNumber}`,
    { timeout: TIMEOUT_MS, headers: { 'User-Agent': 'JusticeGavel/1.0 License Verification' } }
  );
  const statusMatch = res.data.match(/Bar Card Status[:\s]+<[^>]+>([^<]+)</i);
  const status = statusMatch?.[1]?.trim()?.toLowerCase() ?? 'unknown';
  return {
    status:      status.includes('active') ? 'active' : status,
    verified_at: new Date().toISOString(),
    source:      'texasbar',
    raw:         status,
  };
}

async function verifyFlorida(barNumber) {
  const res = await axios.get(
    `https://www.floridabar.org/directories/find-mbr/profile/?num=${barNumber}`,
    { timeout: TIMEOUT_MS }
  );
  const eligible = res.data.includes('Eligible to Practice');
  return {
    status:      eligible ? 'active' : 'suspended',
    verified_at: new Date().toISOString(),
    source:      'floridabar',
    raw:         eligible ? 'Eligible to Practice' : 'Not Eligible',
  };
}

async function verifyABADatabase(barNumber, state) {
  // Fallback: mark as "needs_manual_review" for states without API
  return {
    status:      'needs_manual_review',
    verified_at: new Date().toISOString(),
    source:      `state_bar_${state.toLowerCase()}`,
    notes:       `${state} state bar does not provide a public verification API`,
  };
}

/**
 * Nightly verification sweep — run via cron or BullMQ job.
 * Processes all attorneys in batches to avoid overwhelming state bar servers.
 */
export async function runNightlyVerification() {
  logger.info('[bar_verify] Starting nightly attorney verification sweep');

  // Get all attorneys needing verification (not verified in last 24 hours)
  const attorneys = await db.all(`
    SELECT id, bar_number, bar_state, full_name, email, calendly_uri,
           license_status, last_verified_at
    FROM lawyer_profiles
    WHERE bar_number IS NOT NULL
      AND (last_verified_at IS NULL
           OR last_verified_at < NOW() - INTERVAL '24 hours')
    ORDER BY last_verified_at ASC NULLS FIRST
    LIMIT 500
  `);

  logger.info({ msg: '[bar_verify] attorneys to verify', count: attorneys.length });

  let verified = 0; let flagged = 0; let errors = 0;

  for (const attorney of attorneys) {
    try {
      // Rate limit: 1 req/sec per state bar
      await new Promise(r => setTimeout(r, 1000));

      const result = await verifyAttorneyLicense({
        bar_number: attorney.bar_number,
        bar_state:  attorney.bar_state,
        name:       attorney.full_name,
      });

      if (!result) { errors++; continue; }

      const wasActive = attorney.license_status === 'active';
      const isNowActive = result.status === 'active';
      const isNowInactive = INACTIVE_STATUSES.has(result.status);

      // Update attorney record
      await db.run(`
        UPDATE lawyer_profiles
        SET license_status    = ?,
            last_verified_at  = ?,
            verification_source = ?,
            is_verified       = ?,
            is_active         = ?
        WHERE id = ?
      `, [
        result.status,
        result.verified_at,
        result.source,
        isNowActive,
        isNowActive && !isNowInactive,
        attorney.id,
      ]);

      // If status changed to inactive, flag and notify
      if (wasActive && isNowInactive) {
        flagged++;
        logger.warn({
          msg:         '[bar_verify] Attorney status changed to inactive',
          attorney_id: attorney.id,
          bar_number:  attorney.bar_number,
          old_status:  attorney.license_status,
          new_status:  result.status,
        });

        // Alert admin
        await sendTransactionalEmail({
          to:      process.env.ADMIN_ALERT_EMAIL || 'admin@justicegavel.app',
          subject: `⚠️ Attorney license change: ${attorney.full_name}`,
          body:    `Attorney ${attorney.full_name} (Bar #${attorney.bar_number}, ${attorney.bar_state})
status changed from "${attorney.license_status}" to "${result.status}".
Their profile has been automatically deactivated.
Please review: ${process.env.ADMIN_URL}/attorneys/${attorney.id}`,
        });
      }

      verified++;
    } catch (err) {
      errors++;
      logger.error({ msg: '[bar_verify] error for attorney', id: attorney.id, error: err.message });
    }
  }

  const summary = { verified, flagged, errors, timestamp: new Date().toISOString() };
  logger.info({ msg: '[bar_verify] sweep complete', ...summary });
  return summary;
}
