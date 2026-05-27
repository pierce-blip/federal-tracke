export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { ticker, date } = req.query;
  if (!ticker || !date) {
    return res.status(400).json({ error: 'ticker and date required' });
  }

  try {
    const start = offsetDate(date, -14);
    const end = offsetDate(date, 14);
    const url = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(ticker)}%22&dateRange=custom&startdt=${start}&enddt=${end}&forms=4`;

    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 FederalTracker/1.0' }
    });

    if (!r.ok) return res.status(200).json({ found: false, insiders: [] });
    const data = await r.json();
    const hits = (data.hits && data.hits.hits) ? data.hits.hits : [];

    if (!hits.length) return res.status(200).json({ found: false, insiders: [] });

    const insiders = hits.slice(0, 3).map(h => ({
      name: h._source.display_names ? h._source.display_names[0] : 'Insider',
      role: h._source.entity_name || 'Executive',
      action: 'filed Form 4',
      date: h._source.file_date || ''
    }));

    res.status(200).json({ found: true, insiders });
  } catch (e) {
    res.status(200).json({ found: false, insiders: [], error: e.message });
  }
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr || new Date());
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}
