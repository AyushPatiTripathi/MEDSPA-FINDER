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
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

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
