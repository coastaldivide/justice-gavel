export async function createSquarePayment({ amount, currency='USD', user, meta }){
  if(!process.env.SQUARE_ACCESS_TOKEN){
    return { provider:'square-mock', url:'https://example.com/checkout/square-mock', mock:true };
  }
  return { provider:'square', url:'https://squareup.com/checkout/MOCK' };
}
