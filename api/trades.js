export const config = { maxDuration: 30 };

const memCache = { data: null, ts: 0 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const days = parseInt(req.query.days || '60');
  const today = new Date();
  const fromDate = new Date(today - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  // Return memory cache if fresh (within 6 hours) and same day range
  const cacheAge = (Date.now() - memCache.ts) / 1000 / 60 / 60;
  if (memCache.data && memCache.data.days === days && cacheAge < 6) {
    return res.status(200).json({ ...memCache.data, fromCache: true, cacheAgeHours: Math.round(cacheAge * 10) / 10 });
  }

  let trades = [];
  let source = '';

  // Try Senate EFDS first
  const senateHits = await fetchSenate(fmt(fromDate), fmt(today));
  if (senateHits.length > 0) {
    trades = senateHits;
    source = 'senate';
  }

  // Fallback: House Clerk XML
  if (trades.length === 0) {
    const houseHits = await fetchHouse(today.getFullYear(), fromDate);
    if (houseHits.length > 0) {
      trades = houseHits;
      source = 'house';
    }
  }

  // Try previous House year if still empty
  if (trades.length === 0) {
    const houseHits = await fetchHouse(today.getFullYear() - 1, fromDate);
    if (houseHits.length > 0) {
      trades = houseHits;
      source = 'house-prev';
    }
  }

  const fetchedAt = new Date().toISOString();

  // Cache whatever we got (even empty, to avoid hammering APIs)
  if (trades.length > 0) {
    memCache.data = { trades, source, fetchedAt, days };
    memCache.ts = Date.now();
  }

  // If still nothing, return last cached data with flag
  if (trades.length === 0 && memCache.data) {
    return res.status(200).json({ ...memCache.data, fromCache: true, cacheAgeHours: Math.round(cacheAge * 10) / 10 });
  }

  return res.status(200).json({ trades, source, fetchedAt, fromCache: false, days });
}

async function fetchSenate(fromDate, toDate) {
  const queries = ['stock', 'purchase', 'sale', 'transaction'];
  let allHits = [];
  const seen = new Set();

  for (const q of queries) {
    try {
      const url = `https://efts.senate.gov/LATEST/search-index?q=%22${q}%22&daterange=custom&fromDate=${fromDate}&toDate=${toDate}&results_count=40`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
        }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const hits = (data.hits && data.hits.hits) ? data.hits.hits : [];
      for (const h of hits) {
        const id = h._id || (h._source ? JSON.stringify(h._source).slice(0, 60) : Math.random().toString());
        if (!seen.has(id)) { seen.add(id); allHits.push(h); }
      }
    } catch(e) { continue; }
  }

  return allHits.map(h => {
    const s = h._source || {};
    const tradeDate = s.transaction_date || s.date || '';
    const disclosedDate = s.file_date || '';
    return {
      name: ((s.first_name||'')+' '+(s.last_name||'')).trim() || 'Senator',
      chamber: 'Senate', party: '?', state: s.senator_state || '',
      committee: '',
      ticker: (s.ticker||'N/A').toUpperCase().trim(),
      company: s.asset_description || s.asset_name || '',
      tradeType: (s.type||'').toLowerCase().includes('sale') ? 'sale' : 'purchase',
      amountMin: parseAmount(s.amount||''),
      amountMax: parseAmountMax(s.amount||''),
      tradeDate, disclosedDate,
      daysToDisclose: daysBetween(tradeDate, disclosedDate),
    };
  }).filter(t => t.name.trim().length > 2);
}

async function fetchHouse(year, fromDate) {
  try {
    const url = `https://disclosures.house.gov/public_disc/financial-pdfs/${year}FD.xml`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' } });
    if (!r.ok) return [];
    const text = await r.text();
    const members = [...text.matchAll(/<Member>([\s\S]*?)<\/Member>/g)];
    return members.slice(0, 60).map(m => {
      const get = tag => { const x = m[1].match(new RegExp(`<${tag}[^>]*>(.*?)<\/${tag}>`, 'i')); return x ? x[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim() : ''; };
      const tradeDate = get('TransactionDate') || get('FiledDate');
      const disclosedDate = get('FilingDate') || get('FiledDate');
      if (disclosedDate && new Date(disclosedDate) < fromDate) return null;
      return {
        name: [get('First'), get('Last')].filter(Boolean).join(' ') || 'Rep.',
        chamber: 'House',
        party: get('Party'),
        state: get('StateDst').slice(0,2) || get('State').slice(0,2),
        committee: '',
        ticker: (get('Ticker')||'N/A').toUpperCase(),
        company: get('AssetName') || get('Asset') || '',
        tradeType: (get('Type')||'').toLowerCase().includes('sale') ? 'sale' : 'purchase',
        amountMin: parseAmount(get('Amount')),
        amountMax: parseAmountMax(get('Amount')),
        tradeDate, disclosedDate,
        daysToDisclose: daysBetween(tradeDate, disclosedDate),
      };
    }).filter(Boolean).filter(t => t.name.trim().length > 2);
  } catch(e) { return []; }
}

function daysBetween(d1, d2) {
  if (!d1||!d2) return null;
  const a = new Date(d1), b = new Date(d2);
  if (isNaN(a)||isNaN(b)) return null;
  return Math.round(Math.abs(b-a)/86400000);
}
function parseAmount(str) {
  if (!str) return 1001;
  const nums = str.replace(/[$,]/g,'').match(/\d+/g);
  return nums?(parseInt(nums[0])||1001):1001;
}
function parseAmountMax(str) {
  if (!str) return 15000;
  const nums = str.replace(/[$,]/g,'').match(/\d+/g);
  if (!nums||nums.length<2) return parseAmount(str)*5;
  return parseInt(nums[nums.length-1])||15000;
}
