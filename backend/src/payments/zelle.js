import { randomBytes } from 'crypto';

export async function createZelleInstructions({ amount, currency='USD', user, meta }) {
  const email = process.env.ALERT_EMAIL_FROM || 'billing@justice-gavel.local';
  // Cryptographically secure reference code — consistent with codebase standard
  const code  = randomBytes(4).toString('hex').toUpperCase();
  const note  = `Send ${amount} ${currency} via Zelle to ${email}. Include code: ${code}`;
  return { provider: 'zelle-instructions', url: null, instructions: note, status: 'pending' };
}
