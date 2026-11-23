require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, '..', 'data', 'practices.json');

let DATA = { generated: null, source: null, practices: [] };

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    DATA = {
      generated: parsed.generated || null,
      source: parsed.source || null,
      practices: Array.isArray(parsed.practices) ? parsed.practices : [],
    };
    console.log(`Loaded ${DATA.practices.length} practices (generated ${DATA.generated})`);
  } catch (err) {
    console.error('Failed to load practices data from', DATA_PATH, err.message);
    DATA = { generated: null, source: null, practices: [] };
  }
}

loadData();

app.use(compression());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Only the CARTO basemap key is exposed to the client; never add other env vars here.
app.get('/api/config', (req, res) => {
  res.json({ cartoApiKey: process.env.CARTO_API_KEY || null });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, count: DATA.practices.length });
});

// Full dataset in one call: at ~1,000 rows this is far cheaper than
// paginating, and lets the client do instant filtering/aggregation.
// If the dataset grows into the tens of thousands (the planned grid-sweep
// expansion), split this into /api/cities + /api/cities/:slug/practices.
app.get('/api/practices', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(DATA);
});

// ---- CSV export -------------------------------------------------------
const CSV_COLS = ['name', 'type', 'address', 'city', 'state', 'zip', 'metro', 'lat', 'lng', 'phone', 'rating', 'reviews'];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Returns the 2-letter state code, 'all', or null if the param is invalid.
function parseState(v) {
  if (v === undefined || v === '' || String(v).toLowerCase() === 'all') return 'all';
  return /^[A-Za-z]{2}$/.test(String(v)) ? String(v).toUpperCase() : null;
}

app.get('/api/export.csv', (req, res) => {
  const st = parseState(req.query.state);
  if (!st) return res.status(400).json({ error: 'state must be a 2-letter code or "all"' });
  const rows = st === 'all' ? DATA.practices : DATA.practices.filter((p) => p.state === st);
  const lines = [CSV_COLS.join(',')];
  for (const p of rows) lines.push(CSV_COLS.map((c) => csvCell(p[c])).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="medspas-${st}.csv"`);
  res.send('﻿' + lines.join('\r\n') + '\r\n');
});

// ---- AI market plan (Groq) -------------------------------------------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Override with GROQ_MODEL in .env if Groq retires this one.
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

function summarize(practices, st) {
  const byType = {};
  const cities = new Map();
  let ratingSum = 0, ratingN = 0;
  for (const p of practices) {
    byType[p.type] = (byType[p.type] || 0) + 1;
    if (typeof p.rating === 'number') { ratingSum += p.rating; ratingN++; }
    if (!cities.has(p.city)) cities.set(p.city, []);
    cities.get(p.city).push(p);
  }
  const cityStats = [...cities.entries()]
    .map(([city, L]) => {
      const types = {};
      let rs = 0, rn = 0;
      for (const p of L) {
        types[p.type] = (types[p.type] || 0) + 1;
        if (typeof p.rating === 'number') { rs += p.rating; rn++; }
      }
      return {
        city,
        practices: L.length,
        typeMix: types,
        avgRating: rn ? +(rs / rn).toFixed(2) : null,
        totalReviews: L.reduce((a, p) => a + (p.reviews || 0), 0),
        topByReviews: [...L].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 3)
          .map((p) => ({ name: p.name, type: p.type, rating: p.rating, reviews: p.reviews })),
      };
    })
    .sort((a, b) => b.practices - a.practices)
    .slice(0, 15);
  return {
    state: st,
    totalPractices: practices.length,
    cityCount: cities.size,
    countsByType: byType,
    avgRating: ratingN ? +(ratingSum / ratingN).toFixed(2) : null,
    cities: cityStats,
  };
}

app.post('/api/plan', async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(400).json({ error: 'Add a free Groq API key to .env to enable this — see console.groq.com/keys' });
  }
  const { scope, value } = req.body || {};
  const st = scope === 'state' ? parseState(value) : null;
  if (!st || st === 'all') return res.status(400).json({ error: 'Send { "scope": "state", "value": "<2-letter state code>" }' });
  const practices = DATA.practices.filter((p) => p.state === st);
  if (!practices.length) return res.status(404).json({ error: `No practices found for ${st}` });

  const summary = summarize(practices, st);
  try {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 1200,
        messages: [
          {
            role: 'system',
            content:
              'You are a go-to-market analyst for a company selling to aesthetic practices (medspas, plastic surgery, cosmetic dermatology, aesthetic physicians). ' +
              'Given aggregate practice data for one US state, write a concise outreach plan in simple markdown with these labeled sections: ' +
              '"Highest-opportunity cities", "Competitive landscape", "Practice-type mix (under/over-represented)", "Suggested outreach order". ' +
              'Use only the numbers provided; do not invent data. Be specific and brief, no filler.',
          },
          { role: 'user', content: 'Practice data summary (JSON):\n' + JSON.stringify(summary) },
        ],
      }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Groq error', r.status, body && body.error && body.error.message);
      return res.status(502).json({ error: 'Groq request failed: ' + ((body.error && body.error.message) || r.status) });
    }
    const plan = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
    if (!plan) return res.status(502).json({ error: 'Groq returned an empty response' });
    res.json({ plan, model: GROQ_MODEL, scope: 'state', value: st, practices: practices.length });
  } catch (err) {
    console.error('Groq fetch failed', err.message);
    res.status(502).json({ error: 'Could not reach Groq: ' + err.message });
  }
});

app.get('/api/reload', (req, res) => {
  // Manual trigger to re-read data/practices.json without a redeploy,
  // e.g. after dropping in a larger dataset from the grid-sweep.
  loadData();
  res.json({ ok: true, count: DATA.practices.length });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`medspa-finder listening on port ${PORT}`);
});
