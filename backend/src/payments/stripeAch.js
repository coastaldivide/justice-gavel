export async function createStripeAchPayment({ amount, currency='USD', user, meta }){
  if(process.env.STRIPE_ACH_ENABLED !== 'true'){
    return { provider:'ach-mock', url:'https://example.com/checkout/ach-mock', mock:true, note:'Enable STRIPE_ACH_ENABLED=true to use Stripe ACH debit.' };
  }
  return { provider:'ach', url:'https://dashboard.stripe.com/test/payments/MOCK' };
}
