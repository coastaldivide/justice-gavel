/**
 * testApp.js — Creates a test Express app with real routes
 * but with the DB replaced by the in-memory test DB.
 *
 * Each test file imports createApp() and gets a fresh app instance.
 */
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';

const TEST_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_testing_only';

// ── Token helpers (re-exported for convenience) ───────────────────────────────
export function makeToken(userId = 1, role = 'user', extra = {}) {
  return jwt.sign(
    { id: userId, role, email: `user${userId}@test.com`, subscription: 'pro', ...extra },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}
export const authHeader = (token) => ({ Authorization: `Bearer ${token}` });
export const userToken     = () => makeToken(1, 'user');
export const attorneyToken = () => makeToken(10, 'attorney');
export const adminToken    = () => makeToken(99, 'admin');

// ── Minimal auth middleware (no DB needed — just verifies JWT) ────────────────
export function mockAuthRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    req.user = jwt.verify(token, TEST_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'invalid token' });
  }
}
