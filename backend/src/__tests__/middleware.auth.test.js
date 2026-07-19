/**
 * middleware.auth.test.js — authRequired middleware
 * Tests: valid token, missing token, expired, wrong secret, role propagation
 */
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

// The authRequired middleware does: userExists(id).then(...).catch(() => next())
// In test env, getDb() will fail (no DB) → .catch fires → next() is called.
// We just need to ensure the Promise resolves before our assertion.
// Set JWT_SECRET to match the token signing below.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

const { authRequired } = await import('../middleware/auth.js');

// Wait for the userExists Promise to resolve/reject and call next()
const flush = () => new Promise(r => setTimeout(r, 500));

const makeReq = (token) => ({ headers: { authorization: token ? `Bearer ${token}` : '' } });
const makeRes = () => {
  const r = { _status:200, _body:null };
  r.status = (s) => { r._status=s; return r; };
  r.json   = (b) => { r._body=b; return r; };
  return r;
};

describe('authRequired middleware', () => {
  it('calls next() for a valid token and attaches req.user', async () => {
    const token = jwt.sign({ id:1, role:'user', email:'a@b.com' }, SECRET, { expiresIn:'1h' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    await flush();
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe(1);
    expect(req.user.role).toBe('user');
  });

  it('returns 401 when no token', async () => {
    const req=makeReq(null), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for expired token', async () => {
    const token = jwt.sign({ id:1, role:'user' }, SECRET, { expiresIn:'-1s' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for wrong secret', async () => {
    const token = jwt.sign({ id:1, role:'user' }, 'wrong_secret_entirely');
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for malformed token', async () => {
    const req=makeReq('not.a.jwt'), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('propagates role to req.user', async () => {
    const token = jwt.sign({ id:10, role:'attorney', email:'atty@law.com' }, SECRET, { expiresIn:'1h' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    await flush();
    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('attorney');
    expect(req.user.id).toBe(10);
  });
});
