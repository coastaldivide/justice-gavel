/**
 * utils/rateLimiters.js — Rate limiters for expensive API endpoints
 *
 * Uses express-rate-limit keyed by req.user?.id (authenticated) or IP (anonymous).
 * This prevents shared-NAT false positives while protecting against abuse.
 *
 * Cost per call:
 *   Claude Sonnet:   ~$0.015 input + output per call
 *   Whisper/STT:     ~$0.006/min audio
 *   Document AI:     ~$0.010 per page
 *
 * Limits are conservative enough for legitimate use but expensive for abuse.
 */

import rateLimit from 'express-rate-limit';
import logger    from './logger.js';

/** Key generator: use authenticated user ID when available, else IP */
const userOrIpKey = (req) => req.user?.id ? `user:${req.user.id}` : req.ip;

/** Shared handler for rate limit violations */
const onLimitReached = (label) => (req, res, options) => {
  logger.warn({
    msg:    '[rate_limit] limit reached',
    label,
    user:   req.user?.id ?? 'anon',
    ip:     req.ip,
    path:   req.path,
  });
  res.status(429).json({
    error: options.message,
    retryAfter: Math.ceil(options.windowMs / 1000 / 60),
  });
};

/**
 * AI Chat — 60 messages per user per 10 minutes
 * Prevents conversation spam that drains Claude budget
 */
export const chatLimiter = rateLimit({
  windowMs:         10 * 60 * 1000,
  max:              60,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('chat'),
  message:          'Too many messages. Please wait a moment before sending more.',
  standardHeaders:  true,
  legacyHeaders:    false,
  skipSuccessfulRequests: false,
});

/**
 * Translation — 20 translation requests per user per 10 minutes
 * Each call invokes Claude claude-sonnet-4-6 for legal translation
 */
export const translateLimiter = rateLimit({
  windowMs:         10 * 60 * 1000,
  max:              20,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('translate'),
  message:          'Translation limit reached. Please wait before translating more documents.',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Motion generation — 5 per user per hour ($9.99 each)
 * Hard cap: generating 100 motions would cost $50 in Claude calls + $50 fraud
 */
export const motionGenerateLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,
  max:              5,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('motion_generate'),
  message:          'Motion generation limit reached (5/hour). Upgrade to Esquire for higher limits.',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Legal research — 30 per user per hour
 */
export const researchLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,
  max:              30,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('legal_research'),
  message:          'Research limit reached. Please try again in an hour.',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Document analysis ($19.99 each) — 3 per user per hour
 */
export const documentAnalysisLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,
  max:              3,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('document_analysis'),
  message:          'Document analysis limit reached (3/hour). Upgrade for more analyses.',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Voice transcription — 10 per user per hour
 */
export const transcribeLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,
  max:              10,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('transcribe'),
  message:          'Transcription limit reached (10/hour). Please try again later.',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Matter intelligence — 20 per user per hour (AI-powered case analysis)
 */
export const matterIntelLimiter = rateLimit({
  windowMs:         60 * 60 * 1000,
  max:              20,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('matter_intelligence'),
  message:          'Case analysis limit reached (20/hour).',
  standardHeaders:  true,
  legacyHeaders:    false,
});

/**
 * Auth endpoints — prevent brute force
 * 5 login attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              5,
  keyGenerator:     (req) => req.ip,
  handler:          onLimitReached('auth'),
  message:          'Too many login attempts. Please wait 15 minutes and try again.',
  standardHeaders:  true,
  legacyHeaders:    false,
  skipSuccessfulRequests: true,  // successful logins don't count
});

/**
 * General API limiter — 200 req per minute per user/IP
 */
export const apiLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              200,
  keyGenerator:     userOrIpKey,
  handler:          onLimitReached('api'),
  message:          'Too many requests. Please slow down.',
  standardHeaders:  true,
  legacyHeaders:    false,
});
