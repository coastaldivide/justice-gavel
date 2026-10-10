export function createNowPaymentsInvoice() {
  if(!process.env.NOWPAYMENTS_KEY){
    return { provider:'nowpayments-mock', url:'https://nowpayments.io/checkout/mock', mock:true };
  }
  return { provider:'nowpayments', url:'https://nowpayments.io/checkout/MOCK' };
}
