export const config = { maxDuration: 30 };

const FMP_KEY = 'A1cM0kdAwSwjfl50DX4YBeOFQKBa3Xaw';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const days = parseInt(req.query.days || '30');
  const today = new Date();
  const fromDate = new Date(today - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  try {
    const [senateRes, houseRes] = await Promise.allSettled([
      fetch(`https://financialmodelingprep.com/api/v4/senate-trading?page=0&apikey=${FMP_KEY}`),
      fetch(`https://financialmodelingprep.com/api/v4/house-disclosure?page=0&apikey=${FMP_KEY}`)
    ]);

    let trades = [];

    if (senateRes.status === 'fulfilled' && senateRes.value.ok) {
      const data = await senateRes.value.json();
      const senate = Array.isArray(data) ? data : [];
      trades = [...trades, ...senate.map(t => ({
        name: t.senator || t.firstName + ' ' + t.lastName || '',
        chamber: 'Senate',
        party: t.party || '?',
        state: t.state || '',
        committee: t.committee || '',
        ticker: (t.ticker || 'N/A').toUpperCase(),
        company: t.assetDescription || t.asset || '',
        tradeType: (t.type || t.transactionType || '').toLowerCase().includes('sale') ? 'sale' : 'purchase',
        amountMin: parseAmount(t.amount || t.range || ''),
        amountMax: parseAmountMax(t.amount || t.range || ''),
        tradeDate: t.transactionDate || t.tradeDate || '',
        disclosedDate: t.disclosureDate || t.dateRecieved || '',
        daysToDisclose: daysBetween(t.transactionDate || t.tradeDate, t.disclosureDate || t.dateRecieved),
        sector: t.sector || '',
      }))];
    }

    if (houseRes.status === 'fulfilled' && houseRes.value.ok) {
      const data = await houseRes.value.json();
      const house = Array.isArray(data) ? data : [];
      trades = [...trades, ...house.map(t => ({
        name: t.representative || t.firstName + ' ' + t.lastName || '',
        chamber: 'House',
        party: t.party || '?',
        state: t.state || '',
        committee: t.committee || '',
        ticker: (t.ticker || 'N/A').toUpperCase(),
        company: t.assetDescription || t.asset || '',
        tradeType: (t.type || t.transactionType || '').toLowerCase().includes('sale') ? 'sale' : 'purchase',
        amountMin: parseAmount(t.amount || t.range || ''),
        amountMax: parseAmountMax(t.amount || t.range || ''),
        tradeDate: t.transactionDate || t.tradeDate || '',
        disclosedDate: t.disclosureDate || t.disclosedDate || '',
        daysToDisclose: daysBetween(t.transactionDate || t.tradeDate, t.disclosureDate || t.disclosedDate),
        sector: t.sector || '',
      }))];
    }

    // Filter by date range
    trades = trades.filter(t => {
      const d = t.disclosedDate || t.tradeDate;
      if (!d) return true;
      return new Date(d) >= fromDate;
    });

    // Deduplicate
    const seen = new Set();
    trades = trades.filter(t => {
      const key = `${t.name}-${t.ticker}-${t.tradeDate}-${t.tradeType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by disclosed date descending
    trades.sort((a, b) => {
      const da = new Date(a.disclosedDate || 0);
      const db = new Date(b.disclosedDate || 0);
      return db - da;
    });

    return res.status(200).json({
      trades,
      source: 'fmp',
      fetchedAt: new Date().toISOString(),
      fromCache: false,
      days
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, trades: [] });
  }
}

function daysBetween(d1, d2) {
  if (!d1 || !d2) return null;
  const a = new Date(d1), b = new Date(d2);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(Math.abs(b - a) / 86400000);
}

function parseAmount(str) {
  if (!str) return 1001;
  const clean = str.replace(/[$,]/g, '');
  const nums = clean.match(/\d+/g);
  if (!nums) return 1001;
  return parseInt(nums[0]) || 1001;
}

function parseAmountMax(str) {
  if (!str) return 15000;
  const clean = str.replace(/[$,]/g, '');
  const nums = clean.match(/\d+/g);
  if (!nums || nums.length < 2) return parseAmount(str) * 5;
  return parseInt(nums[nums.length - 1]) || 15000;
}
