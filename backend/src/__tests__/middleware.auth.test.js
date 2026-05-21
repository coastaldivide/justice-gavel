/**
 * middleware.auth.test.js — authRequired middleware
 * Tests: valid token, missing token, expired, wrong secret, role propagation
 */
import jwt from 'jsonwebtoken';
import { jest } from '@jest/globals';

const SECRET = process.env.JWT_SECRET;
const { authRequired } = await import('../middleware/auth.js');

const makeReq = (token) => ({ headers: { authorization: token ? `Bearer ${token}` : '' } });
const makeRes = () => {
  const r = { _status:200, _body:null };
  r.status = (s) => { r._status=s; return r; };
  r.json   = (b) => { r._body=b; return r; };
  return r;
};

describe('authRequired middleware', () => {
  it('calls next() for a valid token and attaches req.user', () => {
    const token = jwt.sign({ id:1, role:'user', email:'a@b.com' }, SECRET, { expiresIn:'1h' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user.id).toBe(1);
    expect(req.user.role).toBe('user');
  });

  it('returns 401 when no token', () => {
    const req=makeReq(null), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for expired token', () => {
    const token = jwt.sign({ id:1, role:'user' }, SECRET, { expiresIn:'-1s' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for wrong secret', () => {
    const token = jwt.sign({ id:1, role:'user' }, 'wrong_secret_entirely');
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('returns 401 for malformed token', () => {
    const req=makeReq('not.a.jwt'), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  it('propagates role to req.user', () => {
    const token = jwt.sign({ id:10, role:'attorney', email:'atty@law.com' }, SECRET, { expiresIn:'1h' });
    const req=makeReq(token), res=makeRes(), next=jest.fn();
    authRequired(req,res,next);
    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('attorney');
    expect(req.user.id).toBe(10);
  });
});
