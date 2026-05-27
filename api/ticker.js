export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker } = req.query;
  if (!ticker || ticker === 'N/A') return res.status(200).json({ info: null });

  try {
    const url = `https://financialmodelingprep.com/api/v3/profile/${ticker}?apikey=demo`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' }
    });
    if (!r.ok) return res.status(200).json({ info: null });
    const data = await r.json();
    if (!data || !data[0]) return res.status(200).json({ info: null });
    const p = data[0];
    res.status(200).json({
      info: {
        sector: p.sector || '',
        industry: p.industry || '',
        description: p.description ? p.description.slice(0, 140) + '…' : ''
      }
    });
  } catch (e) {
    res.status(200).json({ info: null });
  }
}
