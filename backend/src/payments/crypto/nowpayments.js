export async function createNowPaymentsInvoice({ amount, currency='USD', user, meta }){
  if(!process.env.NOWPAYMENTS_KEY){
    return { provider:'nowpayments-mock', url:'https://nowpayments.io/checkout/mock', mock:true };
  }
  return { provider:'nowpayments', url:'https://nowpayments.io/checkout/MOCK' };
}
