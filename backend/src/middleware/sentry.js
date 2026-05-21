import * as Sentry from '@sentry/node';
import { CONFIG } from '../config.js';
export function initSentry(app){ if(!CONFIG.SENTRY_DSN) return; Sentry.init({ dsn: CONFIG.SENTRY_DSN, tracesSampleRate:0.1 }); app.use(Sentry.Handlers.requestHandler()); app.use(Sentry.Handlers.tracingHandler()); }
export function sentryErrorHandler(){ if(!CONFIG.SENTRY_DSN) return (req,res,next)=>next(); return (err,req,res,next)=>{ Sentry.captureException(err); res.status(500).json({ error:'server error' }); }; }
