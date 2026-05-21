const key = process.env.COINBASE_COMMERCE_API_KEY || '';
export async function createCoinbaseCharge({ amount, currency='USD', user, meta }){
  if(!key){ return { provider:'coinbase-mock', url:'https://commerce.coinbase.com/checkout/mock', mock:true }; }
  const r = await fetch('https://api.commerce.coinbase.com/charges', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'X-CC-Api-Key': key, 'X-CC-Version':'2018-03-22' },
    body: JSON.stringify({
      name: meta?.description || 'Justice Gavel Premium',
      pricing_type: 'fixed_price',
      local_price: { amount: String(amount), currency },
      metadata: { user: user?.email || 'anon' },
      redirect_url: meta?.successUrl || 'http://localhost:19006',
      cancel_url: meta?.cancelUrl || 'http://localhost:19006'
    })
  });
  if(!r.ok){ return { provider:'coinbase-error', status:r.status, url:null }; }
  const data = await r.json();
  return { provider:'coinbase', url: data?.data?.hosted_url || null };
}
