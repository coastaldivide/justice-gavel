export const openApiSpec = {
  openapi: '3.0.3',
  info: { title: 'Justice Gavel API', version: '6.3.0', description: 'Legal technology platform — criminal defense, immigration, family law, and more.' },
  servers: [
    { url: 'https://api.justicegavel.app/api/v1', description: 'Production' },
    { url: 'http://localhost:4000/api', description: 'Local' },
  ],
  security: [{ BearerAuth: [] }],
  components: {
    securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', required: ['error','code'], properties: { error: { type: 'string' }, code: { type: 'string' } } },
    },
  },
  paths: {
    '/auth/login':             { post: { summary: 'Login',               tags: ['Auth'],       security: [], responses: { 200: { description: 'Token pair' }, 401: { description: 'Invalid credentials' } } } },
    '/auth/register':          { post: { summary: 'Register',            tags: ['Auth'],       security: [], responses: { 201: { description: 'Created' }, 422: { description: 'Validation error' } } } },
    '/auth/refresh':           { post: { summary: 'Refresh token',       tags: ['Auth'],       security: [], responses: { 200: { description: 'New tokens' }, 401: { description: 'Invalid/expired' } } } },
    '/auth/disclaimer/status': { get:  { summary: 'Disclaimer status',   tags: ['Compliance'],          responses: { 200: { description: 'Status' } } } },
    '/auth/disclaimer/accept': { post: { summary: 'Accept disclaimer',   tags: ['Compliance'],          responses: { 200: { description: 'Accepted' } } } },
    '/cases':                  { get:  { summary: 'List cases',          tags: ['Cases'],               responses: { 200: { description: 'Cases array' } } },
                                 post: { summary: 'Create case',         tags: ['Cases'],               responses: { 201: { description: 'Created' } } } },
    '/bail/calculate':         { post: { summary: 'Calculate bail',      tags: ['Bail'],       security: [], responses: { 200: { description: 'Bail recommendation' } } } },
    '/bail/immigration':       { get:  { summary: 'ICE bond schedule',   tags: ['Immigration'],security: [], responses: { 200: { description: 'ICE bond info' } } } },
    '/match':                  { get:  { summary: 'Match attorneys/bondsmen', tags: ['Marketplace'],   responses: { 200: { description: 'Matches' } } } },
    '/push/token':             { post: { summary: 'Register push token', tags: ['Notifications'],      responses: { 200: { description: 'Registered' } } } },
    '/billing/subscribe':      { post: { summary: 'Start subscription',  tags: ['Billing'],            responses: { 200: { description: 'Subscription' } } } },
    '/billing/cancel':         { post: { summary: 'Cancel subscription', tags: ['Billing'],            responses: { 200: { description: 'Cancelled' } } } },
    '/chat':                   { post: { summary: 'AI legal chat',       tags: ['AI'],                 responses: { 200: { description: 'Response' }, 451: { description: 'Disclaimer required' } } } },
    '/chat/stream':            { post: { summary: 'AI chat (SSE stream)',tags: ['AI'],                 responses: { 200: { description: 'SSE stream' } } } },
    '/health':                 { get:  { summary: 'Health check',        tags: ['System'],    security: [], responses: { 200: { description: 'Healthy' }, 503: { description: 'Degraded' } } } },
  },
  tags: [
    { name: 'Auth' }, { name: 'Cases' }, { name: 'Bail' },
    { name: 'Immigration' }, { name: 'Compliance' }, { name: 'Marketplace' },
    { name: 'Notifications' }, { name: 'Billing' }, { name: 'AI' }, { name: 'System' },
  ],
};
export default openApiSpec;
