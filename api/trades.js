export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const days = parseInt(req.query.days || '60');
  const today = new Date();
  const fromDate = new Date(today - days * 86400000);
  const fmt = d => d.toISOString().split('T')[0];

  let trades = [];
  let source = '';

  // Try Senate EFD (correct URL)
  const senateHits = await fetchSenate(fmt(fromDate), fmt(today));
  if (senateHits.length > 0) {
    trades = senateHits;
    source = 'senate';
  }

  // Fallback: House Clerk XML (correct URL)
  if (trades.length === 0) {
    const houseHits = await fetchHouse(today.getFullYear(), fromDate);
    if (houseHits.length > 0) { trades = houseHits; source = 'house'; }
  }

  if (trades.length === 0) {
    const houseHits = await fetchHouse(today.getFullYear() - 1, fromDate);
    if (houseHits.length > 0) { trades = houseHits; source = 'house-prev'; }
  }

  const fetchedAt = new Date().toISOString();
  return res.status(200).json({ trades, source, fetchedAt, fromCache: false, days });
}

async function fetchSenate(fromDate, toDate) {
  const seen = new Set();
  let allHits = [];

  // Try the correct Senate EFD search endpoint
  const urls = [
    `https://efdsearch.senate.gov/search/report/data/?report_types=%5B%22ptr%22%5D&submitted_start_date=${fromDate}+00%3A00%3A00&submitted_end_date=${toDate}+23%3A59%3A59&limit=100&offset=0`,
    `https://efdsearch.senate.gov/search/home/`,
  ];

  // Primary: Senate EFD API
  try {
    const url = `https://efdsearch.senate.gov/search/report/data/?report_types=%5B%22ptr%22%5D&submitted_start_date=${fromDate}+00%3A00%3A00&submitted_end_date=${toDate}+23%3A59%3A59&limit=100&offset=0`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*',
        'Referer': 'https://efdsearch.senate.gov/search/',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    if (r.ok) {
      const data = await r.json();
      const items = data.data || [];
      return items.map(item => ({
        name: (item[0] || '').replace(/<[^>]+>/g, '').trim(),
        chamber: 'Senate', party: '?', state: '',
        committee: '',
        ticker: 'N/A',
        company: item[3] || '',
        tradeType: 'purchase',
        amountMin: 1001, amountMax: 15000,
        tradeDate: item[2] || '',
        disclosedDate: item[4] || '',
        daysToDisclose: daysBetween(item[2], item[4]),
      })).filter(t => t.name.length > 2);
    }
  } catch(e) {}

  // Fallback: old EFTS endpoint
  try {
    const queries = ['purchase', 'sale', 'stock'];
    for (const q of queries) {
      const url = `https://efts.senate.gov/LATEST/search-index?q=%22${q}%22&daterange=custom&fromDate=${fromDate}&toDate=${toDate}&results_count=40`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const hits = (data.hits && data.hits.hits) ? data.hits.hits : [];
      for (const h of hits) {
        const id = h._id || JSON.stringify(h._source||'').slice(0,60);
        if (!seen.has(id)) { seen.add(id); allHits.push(h); }
      }
    }
    if (allHits.length > 0) {
      return allHits.map(h => {
        const s = h._source || {};
        const tradeDate = s.transaction_date || s.date || '';
        const disclosedDate = s.file_date || '';
        return {
          name: ((s.first_name||'')+' '+(s.last_name||'')).trim()||'Senator',
          chamber: 'Senate', party: '?', state: s.senator_state||'',
          committee: '',
          ticker: (s.ticker||'N/A').toUpperCase().trim(),
          company: s.asset_description||s.asset_name||'',
          tradeType: (s.type||'').toLowerCase().includes('sale')?'sale':'purchase',
          amountMin: parseAmount(s.amount||''),
          amountMax: parseAmountMax(s.amount||''),
          tradeDate, disclosedDate,
          daysToDisclose: daysBetween(tradeDate, disclosedDate),
        };
      }).filter(t => t.name.trim().length > 2);
    }
  } catch(e) {}

  return [];
}

async function fetchHouse(year, fromDate) {
  try {
    // Correct House Clerk URL
    const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.xml`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!r.ok) {
      // Try alternate URL format
      const url2 = `https://disclosures.house.gov/public_disc/financial-pdfs/${year}FD.xml`;
      const r2 = await fetch(url2, { headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' } });
      if (!r2.ok) return [];
      return parseHouseXML(await r2.text(), fromDate);
    }
    return parseHouseXML(await r.text(), fromDate);
  } catch(e) { return []; }
}

function parseHouseXML(text, fromDate) {
  try {
    const members = [...text.matchAll(/<Member>([\s\S]*?)<\/Member>/gi)];
    return members.slice(0, 80).map(m => {
      const get = tag => {
        const x = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
        return x ? x[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<[^>]+>/g,'').trim() : '';
      };
      const tradeDate = get('TransactionDate') || get('FiledDate') || '';
      const disclosedDate = get('FilingDate') || get('FiledDate') || '';
      if (disclosedDate && fromDate && new Date(disclosedDate) < fromDate) return null;
      return {
        name: [get('First'), get('Last')].filter(Boolean).join(' ') || get('Name') || 'Rep.',
        chamber: 'House',
        party: get('Party'),
        state: (get('StateDst')||get('State')).slice(0,2),
        committee: '',
        ticker: (get('Ticker')||'N/A').toUpperCase(),
        company: get('AssetName')||get('Asset')||'',
        tradeType: (get('Type')||'').toLowerCase().includes('sale')?'sale':'purchase',
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
