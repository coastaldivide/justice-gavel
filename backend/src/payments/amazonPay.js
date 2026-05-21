export async function createAmazonPayPayment({ amount, currency='USD', user, meta }){
  if(!process.env.AMAZON_PAY_PUBLIC_KEY_ID){
    return { provider:'amazonpay-mock', url:'https://example.com/checkout/amazon-mock', mock:true };
  }
  return { provider:'amazon_pay', url:'https://pay.amazon.com/checkout/MOCK' };
}
