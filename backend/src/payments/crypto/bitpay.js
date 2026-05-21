export async function createBitPayInvoice({ amount, currency='USD', user, meta }){
  if(!process.env.BITPAY_TOKEN){
    return { provider:'bitpay-mock', url:'https://test.bitpay.com/invoice?id=MOCK', mock:true };
  }
  return { provider:'bitpay', url:'https://bitpay.com/invoice?id=MOCK' };
}
