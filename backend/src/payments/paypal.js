export async function createPayPalPayment({ amount, currency='USD', user, meta }){
  if(!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_SECRET){
    return { provider:'paypal-mock', url:'https://example.com/checkout/paypal-mock', mock:true };
  }
  return { provider:'paypal', url:'https://www.paypal.com/checkoutnow?token=MOCK' };
}
