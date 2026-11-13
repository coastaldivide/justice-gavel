/**
 * monitoring/aiHealth.js — is the AI working, and what does it cost?
 *
 * Reads ai_usage_log (one row per model attempt, services/aiClient.js; columns from
 * migrations 06/07/44). Postgres only (the sql.js dev fallback returns empty results).
 *
 *   aiHealth(db)   the last hour: calls, errors (failed + invalid answers), final refusals,
 *                  classifier declines (refusal = true, also those a fallback then answered),
 *                  and whether a person should be alerted:
 *                    errors   > AI_ALERT_ERROR_PCT   % of calls (default 20) or
 *                    refusals > AI_ALERT_REFUSAL_PCT % of calls (default 10),
 *                  once at least AI_ALERT_MIN_CALLS calls finished (default 20).
 *                  server.js checks it in the hourly watchdog (one alert per code, 5-min dedup
 *                  in errorNotifier) next to jobHealth and smsHealth.
 *   aiMetrics(db)  the summary behind GET /api/admin/metrics/ai: per day × route × class —
 *                  calls, cost, tokens (input / output / cache read / cache write), cache-read
 *                  share of input, p50 / p95 latency, refusal rate, error rate.
 * Refusals return HTTP 200, so the provider's error rate never shows them: they are counted here.
 */
const num = (v, d) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n > 0 ? n : d;
};

export function aiAlertThresholds() {
  return {
    minCalls: num(process.env.AI_ALERT_MIN_CALLS, 20),
    errorShare: num(process.env.AI_ALERT_ERROR_PCT, 20) / 100,
    refusalShare: num(process.env.AI_ALERT_REFUSAL_PCT, 10) / 100,
  };
}

/** → { total, errors, refused, declined, error_rate, refusal_rate, decline_rate, alarm, alarms[] } */
export async function aiHealth(db, { minutes = 60 } = {}) {
  const empty = { total: 0, errors: 0, refused: 0, declined: 0, error_rate: 0, refusal_rate: 0, decline_rate: 0, alarm: false, alarms: [] };
  if (db?.engine !== 'postgres') return empty;
  const r = await db.get(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('failed', 'invalid'))::int AS errors,
            COUNT(*) FILTER (WHERE status = 'refused')::int AS refused,
            COUNT(*) FILTER (WHERE refusal)::int AS declined
       FROM ai_usage_log
      WHERE queued_at >= NOW() - make_interval(mins => ?) AND COALESCE(status, '') <> 'stopped'`, [minutes]);
  const t = aiAlertThresholds();
  const total = r?.total || 0;
  const out = {
    total, errors: r?.errors || 0, refused: r?.refused || 0, declined: r?.declined || 0,
    error_rate: total ? (r.errors || 0) / total : 0,
    refusal_rate: total ? (r.refused || 0) / total : 0,
    decline_rate: total ? (r.declined || 0) / total : 0,
    thresholds: t,
  };
  const alarms = [];
  if (total >= t.minCalls && out.error_rate > t.errorShare) alarms.push('ai_error_rate');
  if (total >= t.minCalls && out.refusal_rate > t.refusalShare) alarms.push('ai_refusal_rate');
  return { ...out, alarm: alarms.length > 0, alarms };
}

const round = (v, d = 6) => (v == null ? null : Number(Number(v).toFixed(d)));

/**
 * Per day × route × class for the last `days` (1–90). Rows are bounded (LIMIT 2000) and
 * totals are returned per class and per route as well.
 */
export async function aiMetrics(db, { days = 7 } = {}) {
  const d = Math.min(90, Math.max(1, Math.round(Number(days) || 7)));
  if (db?.engine !== 'postgres') return { days: d, rows: [], by_class: [], by_route: [], totals: null };
  const select = (group) => `
    SELECT ${group},
           COUNT(*)::int AS calls,
           COALESCE(SUM(cost_usd), 0) AS cost_usd,
           COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
           COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
           COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
           COALESCE(SUM(cache_write_5m_tokens + cache_write_1h_tokens), 0)::bigint AS cache_write_tokens,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
           COUNT(*) FILTER (WHERE status = 'refused')::int AS refused,
           COUNT(*) FILTER (WHERE refusal)::int AS declined,
           COUNT(*) FILTER (WHERE status IN ('failed', 'invalid'))::int AS errors
      FROM ai_usage_log
     WHERE queued_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - make_interval(days => ?)`;
  const shape = (r) => {
    const calls = Number(r.calls) || 0;
    const inTotal = Number(r.input_tokens) + Number(r.cache_read_tokens) + Number(r.cache_write_tokens);
    return {
      ...r,
      ...(r.day ? { day: new Date(r.day).toISOString().slice(0, 10) } : {}),
      cost_usd: round(r.cost_usd),
      input_tokens: Number(r.input_tokens), output_tokens: Number(r.output_tokens),
      cache_read_tokens: Number(r.cache_read_tokens), cache_write_tokens: Number(r.cache_write_tokens),
      cache_read_share: inTotal ? round(Number(r.cache_read_tokens) / inTotal, 4) : 0,
      p50_ms: r.p50_ms == null ? null : Math.round(r.p50_ms),
      p95_ms: r.p95_ms == null ? null : Math.round(r.p95_ms),
      refusal_rate: calls ? round(r.refused / calls, 4) : 0,
      decline_rate: calls ? round(r.declined / calls, 4) : 0,
      error_rate: calls ? round(r.errors / calls, 4) : 0,
    };
  };
  const rows = await db.all(`${select("to_char(date_trunc('day', queued_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, route, COALESCE(task_class, 'unclassified') AS task_class")}
     GROUP BY 1, 2, 3 ORDER BY 1 DESC, cost_usd DESC LIMIT 2000`, [d]);
  const byClass = await db.all(`${select("COALESCE(task_class, 'unclassified') AS task_class")} GROUP BY 1 ORDER BY cost_usd DESC LIMIT 20`, [d]);
  const byRoute = await db.all(`${select('route')} GROUP BY 1 ORDER BY cost_usd DESC LIMIT 200`, [d]);
  const totals = await db.get(`${select("'all' AS scope")} GROUP BY 1`, [d]);
  return { days: d, rows: rows.map(shape), by_class: byClass.map(shape), by_route: byRoute.map(shape), totals: totals ? shape(totals) : null };
}
