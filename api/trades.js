export const config = { maxDuration: 30 };

const FMP_KEY = 'A1cM0kdAwSwjfl50DX4YBeOFQKBa3Xaw';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const days = parseInt(req.query.days || '30');
  const today = new Date();
  const fromDate = new Date(today - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  const endpoints = [
    { url: `https://financialmodelingprep.com/stable/senate-trading?page=0&apikey=${FMP_KEY}`, chamber: 'Senate' },
    { url: `https://financialmodelingprep.com/stable/house-trading?page=0&apikey=${FMP_KEY}`, chamber: 'House' },
    { url: `https://financialmodelingprep.com/api/v4/senate-trading?page=0&apikey=${FMP_KEY}`, chamber: 'Senate' },
    { url: `https://financialmodelingprep.com/api/v4/house-disclosure?page=0&apikey=${FMP_KEY}`, chamber: 'House' },
  ];

  let trades = [];
  const errors = [];

  for (const ep of endpoints) {
    try {
      const r = await fetch(ep.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0', 'Accept': 'application/json' }
      });
      if (!r.ok) { errors.push(`${ep.url}: ${r.status}`); continue; }
      const data = await r.json();
      const items = Array.isArray(data) ? data : (data.data || data.trades || []);
      if (!items.length) { errors.push(`${ep.url}: empty`); continue; }

      const mapped = items.map(t => {
        const name = t.senator || t.representative || t.name || [t.firstName, t.lastName].filter(Boolean).join(' ') || '';
        const tradeDate = t.transactionDate || t.tradeDate || t.date || '';
        const disclosedDate = t.disclosureDate || t.disclosedDate || t.dateRecieved || t.filingDate || '';
        const typeRaw = (t.type || t.transactionType || t.transaction || '').toLowerCase();
        return {
          name,
          chamber: ep.chamber,
          party: t.party || '?',
          state: t.state || t.office || '',
          committee: t.committee || '',
          ticker: (t.ticker || t.symbol || 'N/A').toUpperCase().trim(),
          company: t.assetDescription || t.asset || t.companyName || '',
          tradeType: typeRaw.includes('sale') || typeRaw.includes('sell') ? 'sale' : 'purchase',
          amountMin: parseAmount(t.amount || t.range || t.size || ''),
          amountMax: parseAmountMax(t.amount || t.range || t.size || ''),
          tradeDate,
          disclosedDate,
          daysToDisclose: daysBetween(tradeDate, disclosedDate),
          sector: t.sector || '',
        };
      }).filter(t => t.name.trim().length > 2);

      if (mapped.length > 0) {
        const existing = new Set(trades.map(t => `${t.chamber}-${t.name}-${t.ticker}-${t.tradeDate}`));
        for (const t of mapped) {
          const key = `${t.chamber}-${t.name}-${t.ticker}-${t.tradeDate}`;
          if (!existing.has(key)) { existing.add(key); trades.push(t); }
        }
      }
    } catch(e) { errors.push(`${ep.url}: ${e.message}`); }
  }

  // Filter by date range
  const filtered = trades.filter(t => {
    const d = t.disclosedDate || t.tradeDate;
    if (!d) return true;
    return new Date(d) >= fromDate;
  });

  // Sort newest first
  filtered.sort((a, b) => new Date(b.disclosedDate || 0) - new Date(a.disclosedDate || 0));

  return res.status(200).json({
    trades: filtered,
    source: 'fmp',
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    days,
    debug: errors
  });
}

function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1), b = new Date(d2);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / 86400000);
}
function parseAmount(str) {
  if (!str) return 1001;
  const nums = str.replace(/[$,]/g, '').match(/\d+/g);
  return nums ? (parseInt(nums[0]) || 1001) : 1001;
}
function parseAmountMax(str) {
  if (!str) return 15000;
  const nums = str.replace(/[$,]/g, '').match(/\d+/g);
  if (!nums || nums.length < 2) return parseAmount(str) * 5;
  return parseInt(nums[nums.length - 1]) || 15000;
}
