export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const today = new Date();
    const weekAgo = new Date(today - 7 * 86400000);
    const fmt = d => d.toISOString().split('T')[0];

    const url = `https://efts.senate.gov/LATEST/search-index?q=%22transaction%22&daterange=custom&fromDate=${fmt(weekAgo)}&toDate=${fmt(today)}&results_count=40`;

    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' }
    });

    if (!r.ok) throw new Error(`Senate EFDS returned ${r.status}`);
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) ? data.hits.hits : [];

    const trades = hits.map(h => {
      const s = h._source || {};
      const tradeDate = s.transaction_date || s.date || '';
      const disclosedDate = s.file_date || '';
      const days = daysBetween(tradeDate, disclosedDate);
      return {
        name: ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || 'Senator',
        chamber: 'Senate',
        party: '?',
        state: s.senator_state || '',
        committee: '',
        ticker: (s.ticker || 'N/A').toUpperCase(),
        company: s.asset_description || s.asset_name || '',
        tradeType: (s.type || '').toLowerCase().includes('sale') ? 'sale' : 'purchase',
        amountMin: parseAmount(s.amount || ''),
        amountMax: parseAmountMax(s.amount || ''),
        tradeDate,
        disclosedDate,
        daysToDisclose: days,
      };
    }).filter(t => t.name.trim().length > 2);

    res.status(200).json({ trades, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
  const nums = str.replace(/[$,]/g, '').match(/\d+/g);
  return nums ? (parseInt(nums[0]) || 1001) : 1001;
}

function parseAmountMax(str) {
  if (!str) return 15000;
  const nums = str.replace(/[$,]/g, '').match(/\d+/g);
  if (!nums || nums.length < 2) return parseAmount(str) * 5;
  return parseInt(nums[nums.length - 1]) || 15000;
}
