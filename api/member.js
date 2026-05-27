export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const CONGRESS_KEY = process.env.CONGRESS_API_KEY || 'OxTbF4sEpGt7TywmtYx8YYn75PrdS26Ydj6cxysu';

  try {
    const url = `https://api.congress.gov/v3/member?query=${encodeURIComponent(name)}&limit=1&currentMember=true&api_key=${CONGRESS_KEY}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(200).json({ member: null });
    const data = await r.json();
    const member = (data.members && data.members[0]) || null;
    res.status(200).json({ member });
  } catch (e) {
    res.status(200).json({ member: null, error: e.message });
  }
}
