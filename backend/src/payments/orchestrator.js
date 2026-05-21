import { CONFIG } from '../config.js';
import { createStripePayment } from './stripe.js';
import { createPayPalPayment } from './paypal.js';
import { createBraintreePayment } from './braintree.js';
import { createSquarePayment } from './square.js';
import { createAuthorizeNetPayment } from './authorizeNet.js';
import { createAmazonPayPayment } from './amazonPay.js';
import { createStripeAchPayment } from './stripeAch.js';
import { createZelleInstructions } from './zelle.js';
import { createCoinbaseCharge } from './crypto/coinbase.js';
import { createBitPayInvoice } from './crypto/bitpay.js';
import { createNowPaymentsInvoice } from './crypto/nowpayments.js';

export async function createPaymentSession({ method, amount, currency = 'USD', user, meta = {} }){
  if(!CONFIG.LIVE_PAYMENTS){ return { provider:'mock', url:'https://example.com/pay/mock', note:'LIVE_PAYMENTS=false (demo mode)'}; }
switch ((method||'').toLowerCase()) {
    case 'stripe':
    case 'apple_pay':
    case 'google_pay':
      return await createStripePayment({ amount, currency, user, meta });
    case 'paypal':
      return await createPayPalPayment({ amount, currency, user, meta });
    case 'braintree':
    case 'venmo':
      return await createBraintreePayment({ amount, currency, user, meta });
    case 'square':
      return await createSquarePayment({ amount, currency, user, meta });
    case 'authorize_net':
      return await createAuthorizeNetPayment({ amount, currency, user, meta });
    case 'amazon_pay':
      return await createAmazonPayPayment({ amount, currency, user, meta });
    case 'ach':
      return await createStripeAchPayment({ amount, currency, user, meta });
    case 'zelle':
      return await createZelleInstructions({ amount, currency, user, meta });
    case 'crypto_coinbase':
      return await createCoinbaseCharge({ amount, currency, user, meta });
    case 'crypto_bitpay':
      return await createBitPayInvoice({ amount, currency, user, meta });
    case 'crypto_nowpayments':
      return await createNowPaymentsInvoice({ amount, currency, user, meta });
    default:
      return { provider:'mock', url:'https://example.com/pay/mock', note:'Unknown method; using mock session.' };
  }
}
