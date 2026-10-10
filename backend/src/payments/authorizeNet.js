export function createAuthorizeNetPayment() {
  if(!process.env.AUTHORIZE_NET_API_LOGIN_ID){
    return { provider:'authorize-mock', url:'https://example.com/checkout/authorize-mock', mock:true };
  }
  return { provider:'authorize_net', url:'https://accept.authorize.net/payment/payment' };
}
