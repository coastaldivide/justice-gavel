/**
 * utils/logger.pino.js — Drop-in pino logger (10× faster than morgan)
 *
 * To switch: in app.js, replace:
 *   import morgan from 'morgan';
 *   app.use(morgan('combined'));
 * With:
 *   import { pinoHttp } from 'pino-http';
 *   app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.body.password'] }));
 *
 * pino:
 *   - 10× faster than morgan/winston in benchmarks
 *   - JSON output native (Datadog, CloudWatch, Papertrail compatible)
 *   - redact: strips PII (passwords, tokens) from log lines automatically
 */

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      '*.api_key',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd ? {} : {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});

export default logger;
