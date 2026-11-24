#!/usr/bin/env node
// Bulk-set website URLs on existing practices.
// Usage: node scripts/import-websites.js <file.csv>   (columns: id, website)
// Updates practice_status.website directly in Postgres (DATABASE_URL). Safe to re-run.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { normalizeUrl } = require('../server/url');

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/import-websites.js <file.csv>'); process.exit(1); }
if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set. Add it to .env (see README).'); process.exit(1); }

(async () => {
  const ids = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'practices.json'), 'utf8')).practices.map((p) => p.id));
  const rows = parse(fs.readFileSync(file, 'utf8'), { columns: (h) => h.map((x) => x.trim().toLowerCase()), skip_empty_lines: true, bom: true, trim: true, relax_column_count: true });
  if (!rows.length || !('id' in rows[0]) || !('website' in rows[0])) {
    console.error('CSV needs "id" and "website" columns. Found: ' + (rows[0] ? Object.keys(rows[0]).join(', ') : '(no rows)'));
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const stat = { total: rows.length, updated: 0, badId: [], blank: 0, badUrl: [] };
  try {
    for (const r of rows) {
      if (!ids.has(r.id)) { stat.badId.push(r.id || '(blank id)'); continue; }
      if (!r.website) { stat.blank++; continue; }
      const u = normalizeUrl(r.website);
      if (!u.ok) { stat.badUrl.push(`${r.id}: ${r.website}`); continue; }
      await pool.query(
        `INSERT INTO practice_status (practice_id, website) VALUES ($1, $2)
         ON CONFLICT (practice_id) DO UPDATE SET website = EXCLUDED.website, updated_at = now()`,
        [r.id, u.value]
      );
      stat.updated++;
    }
  } finally {
    await pool.end();
  }

  console.log(`Rows in file:               ${stat.total}`);
  console.log(`Updated:                    ${stat.updated}`);
  console.log(`Skipped (id not found):     ${stat.badId.length}`);
  console.log(`Skipped (blank website):    ${stat.blank}`);
  console.log(`Skipped (invalid website):  ${stat.badUrl.length}`);
  stat.badId.forEach((i) => console.log('  unknown id: ' + i));
  stat.badUrl.forEach((i) => console.log('  invalid URL: ' + i));
})().catch((e) => { console.error('Import failed: ' + e.message); process.exit(1); });
