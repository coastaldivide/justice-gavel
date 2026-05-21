export async function createBraintreePayment({ amount, currency='USD', user, meta }){
  if(!process.env.BRAINTREE_MERCHANT_ID){
    return { provider:'braintree-mock', url:'https://example.com/checkout/braintree-mock', mock:true, note:'Venmo supported via Braintree in production.' };
  }
  return { provider:'braintree', url:'https://sandbox.braintreegateway.com/merchants/checkout/MOCK' };
}
