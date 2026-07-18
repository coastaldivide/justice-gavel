/**
 * utils/redis.js — Redis client for caching, sessions, and rate limiting
 *
 * Uses ioredis with graceful degradation — if Redis is unavailable,
 * the app continues to function without caching (just slower).
 *
 * Environment: REDIS_URL (Railway provides this automatically when you
 * add a Redis plugin: Settings → Plugins → Add → Redis)
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
    lazyConnect:          true,
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

/**
 * Session store helper (for JWT refresh token blacklisting)
 */
export async function blacklistToken(jti, ttlSeconds) {
  const client = getRedis();
  if (!client) return false;
  try {
    await client.setex(`blacklist:${jti}`, ttlSeconds, '1');
    return true;
  } catch { return false; }
}

export async function isTokenBlacklisted(jti) {
  const client = getRedis();
  if (!client) return false;
  try {
    return await client.exists(`blacklist:${jti}`) === 1;
  } catch { return false; }
}

/**
 * Distributed rate limiter (replaces in-memory rate limiting under load)
 * Sliding window using Redis sorted sets.
 */
export async function rateLimitCheck(key, limit, windowSeconds) {
  const client = getRedis();
  if (!client) return { allowed: true, remaining: limit }; // degrade gracefully

  const now   = Date.now();
  const floor = now - windowSeconds * 1000;

  try {
    const pipeline = client.pipeline();
    pipeline.zremrangebyscore(key, 0, floor);         // remove old entries
    pipeline.zadd(key, now, now.toString());           // add current request
    pipeline.zcard(key);                               // count total in window
    pipeline.expire(key, windowSeconds + 1);           // cleanup

    const results = await pipeline.exec();
    const count   = results[2][1];

    return {
      allowed:   count <= limit,
      remaining: Math.max(0, limit - count),
      count,
    };
  } catch (err) {
    logger.warn({ msg: '[redis] rate limit check failed', error: err.message });
    return { allowed: true, remaining: limit }; // degrade gracefully
  }
}
