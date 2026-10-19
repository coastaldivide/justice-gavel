/**
 * utils/redis.js — Redis client for caching, sessions, and rate limiting
 *
 * Uses ioredis with graceful degradation — if Redis is unavailable,
 * the app continues to function without caching (just slower).
 *
 * Environment: REDIS_URL (e.g. a Render Key Value instance's internal URL —
 * set it on the web service; DEPLOY_ENV_SETUP.md)
 */

import Redis from 'ioredis';
import logger from './logger.js';

let redis = null;

function createRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('[redis] REDIS_URL not set — running without cache');
    return null;
  }

  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue:   false,
    connectTimeout:       5000,
    lazyConnect:          false,   // connect immediately (offline queue is disabled)
  });

  client.on('connect',      () => logger.info('[redis] connected'));
  client.on('error',        (err) => logger.error({ msg: '[redis] error', error: err.message }));
  client.on('reconnecting', () => logger.warn('[redis] reconnecting'));

  return client;
}

export function getRedis() {
  if (!redis) redis = createRedisClient();
  return redis;
}

/**
 * Cache helper — get or set with TTL.
 * Returns null gracefully if Redis is down.
 */
export async function cache(key, ttlSeconds, fetchFn) {
  const client = getRedis();
  if (!client) return fetchFn(); // degrade gracefully

  try {
    const cached = await client.get(key);
    if (cached) return JSON.parse(cached);
    const fresh = await fetchFn();
    if (fresh != null) {
      await client.setex(key, ttlSeconds, JSON.stringify(fresh));
    }
    return fresh;
  } catch (err) {
    logger.warn({ msg: '[redis] cache miss/error', key, error: err.message });
    return fetchFn(); // degrade gracefully
  }
}



