export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const today = new Date();
  const weekAgo = new Date(today - 7 * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  const urls = [
    `https://efts.senate.gov/LATEST/search-index?q=%22stock%22&daterange=custom&fromDate=${fmt(weekAgo)}&toDate=${fmt(today)}&results_count=40`,
    `https://efts.senate.gov/LATEST/search-index?q=%22purchase%22&daterange=custom&fromDate=${fmt(weekAgo)}&toDate=${fmt(today)}&results_count=40`,
    `https://efts.senate.gov/LATEST/search-index?q=%22sale%22&daterange=custom&fromDate=${fmt(weekAgo)}&toDate=${fmt(today)}&results_count=40`,
  ];

  let allHits = [];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://efts.senate.gov/LATEST/search-index',
        }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const hits = (data.hits && data.hits.hits) ? data.hits.hits : [];
      allHits = [...allHits, ...hits];
    } catch(e) {
      continue;
    }
  }

  const seen = new Set();
  const trades = allHits
    .filter(h => {
      const id = h._id || JSON.stringify(h._source);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(h => {
      const s = h._source || {};
      const tradeDate = s.transaction_date || s.date || '';
      const disclosedDate = s.file_date || '';
      return {
        name: ((s.first_name || '') + ' ' + (s.last_name || '')).trim() || 'Senator',
        chamber: 'Senate',
        party: '?',
        state: s.senator_state || '',
        committee: '',
        ticker: (s.ticker || 'N/A').toUpperCase().trim(),
        company: s.asset_description || s.asset_name || '',
        tradeType: (s.type || '').toLowerCase().includes('sale') ? 'sale' : 'purchase',
        amountMin: parseAmount(s.amount || ''),
        amountMax: parseAmountMax(s.amount || ''),
        tradeDate,
        disclosedDate,
        daysToDisclose: daysBetween(tradeDate, disclosedDate),
      };
    })
    .filter(t => t.name.trim().length > 2);

  if (trades.length === 0) {
    const fallback = await fetchHouseDisclosures(fmt(weekAgo), fmt(today));
    return res.status(200).json({ trades: fallback, source: 'house', fetchedAt: new Date().toISOString() });
  }

  res.status(200).json({ trades, source: 'senate', fetchedAt: new Date().toISOString() });
}

async function fetchHouseDisclosures(fromDate, toDate) {
  try {
    const url = `https://disclosures.house.gov/FinancialDisclosure/ViewMemberSearchResult`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' }
    });
    return [];
  } catch(e) { return []; }
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
