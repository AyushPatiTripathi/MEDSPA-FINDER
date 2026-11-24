#!/usr/bin/env node
// Merge a CSV/JSON list of practices into data/practices.json.
// Usage: node scripts/import-practices.js <file.csv|file.json> [--force] [--dry-run]
// See the README ("Importing more practices") for details.
try { require('dotenv').config({ quiet: true }); } catch (_) { /* optional */ }
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const P = (f) => path.join(DATA_DIR, f);
const NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const MAX_METRO_MILES = 40;
const GEO_DUP_METERS = 50;
const GEOCODE_INTERVAL_MS = 1100; // Nominatim policy: max 1 request/second

// ---------------------------------------------------------------- helpers
const ALIASES = {
  name: ['name', 'business_name', 'practice_name', 'title'],
  address: ['address', 'street_address', 'address1', 'full_address'],
  city: ['city', 'town'],
  state: ['state', 'state_code', 'region'],
  zip: ['zip', 'zipcode', 'zip_code', 'postal_code'],
  phone: ['phone', 'phone_number', 'telephone'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  website: ['website', 'url'],
  category: ['category', 'categories', 'type', 'business_type', 'description'],
};

const STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA',
  michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
const writeJson = (f, v, indent) => fs.writeFileSync(f, JSON.stringify(v, null, indent) + '\n');
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');
const keyOf = (h) => clean(h).toLowerCase().replace(/[\s-]+/g, '_');

function normState(s) {
  const v = clean(s);
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return STATES[v.toLowerCase()] || '';
}

function haversineMi(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return 7917.6 * Math.asin(Math.sqrt(x));
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Name with punctuation and generic business suffixes removed, for fuzzy compare.
function stripName(name) {
  return norm(name)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((w) => w && !['llc', 'inc', 'pllc', 'pc', 'pa', 'ltd', 'the', 'and', 'spa', 'medspa', 'med'].includes(w))
    .join(' ');
}

function namesClose(a, b) {
  const x = stripName(a), y = stripName(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length) >= 0.8;
}

const zip5 = (z) => (clean(z).match(/\d{5}/) || [''])[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- parsing
function readRows(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') {
    let j = JSON.parse(text);
    if (!Array.isArray(j)) j = j.practices || j.data || j.results;
    if (!Array.isArray(j)) throw new Error('JSON input must be an array of objects (or { practices: [...] }).');
    return j;
  }
  if (ext === '.csv') return parse(text, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: true });
  throw new Error('Unsupported file type "' + ext + '" — use .csv or .json');
}

function buildMapping(rows) {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const byKey = new Map(headers.map((h) => [keyOf(h), h]));
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => byKey.has(n));
    if (hit) map[field] = byKey.get(hit);
  }
  const ok = map.name && (map.address || (map.city && map.state));
  if (!ok) {
    throw new Error(
      'Could not map required columns (need a name column, plus address or city+state).\n' +
        '  Columns found: ' + headers.join(', ') + '\n' +
        '  Mapped so far: ' + JSON.stringify(map) + '\n' +
        '  Extend ALIASES in scripts/import-practices.js to cover these headers.'
    );
  }
  return map;
}

// "123 Main St, Austin, TX 78701" -> { city, state, zip }
function splitAddress(addr) {
  const m = clean(addr).match(/,\s*([^,]+?),\s*([A-Za-z]{2})\.?(?:\s+(\d{5})(?:-\d{4})?)?\s*(?:,?\s*(?:USA|US|United States))?\s*$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] || '' } : {};
}

function mapRow(raw, map) {
  const g = (f) => (map[f] ? clean(raw[map[f]]) : '');
  const row = { name: g('name'), address: g('address'), city: g('city'), state: normState(g('state')), zip: zip5(g('zip')), phone: g('phone'), website: g('website'), category: g('category') };
  if (!row.city || !row.state || !row.zip) {
    const s = splitAddress(row.address);
    row.city = row.city || s.city || '';
    row.state = row.state || s.state || '';
    row.zip = row.zip || s.zip || zip5(row.address);
  }
  const lat = parseFloat(g('lat')), lng = parseFloat(g('lng'));
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) { row.lat = lat; row.lng = lng; }
  return row;
}

// ---------------------------------------------------------------- geocoding
function geocodeQuery(r) {
  const parts = [r.address];
  if (r.city && !norm(r.address).includes(norm(r.city))) parts.push(r.city, `${r.state} ${r.zip}`.trim());
  return parts.filter(Boolean).join(', ');
}

async function geocodeAll(rows, report) {
  const cacheFile = P('.geocode-cache.json');
  const cache = readJson(cacheFile, {});
  const todo = rows.filter((r) => r.lat === undefined);
  if (!todo.length) return;
  const contact = process.env.NOMINATIM_CONTACT;
  if (!contact) {
    throw new Error(
      todo.length + ' row(s) need geocoding, but NOMINATIM_CONTACT is not set.\n' +
        '  Nominatim requires an identifying contact in the User-Agent. Set NOMINATIM_CONTACT in .env\n' +
        '  to an email or URL where you can be reached (it is only sent to Nominatim).'
    );
  }
  const ua = `medspa-finder-importer/1.0 (${contact})`;
  let lastReq = 0;
  for (const r of todo) {
    const q = geocodeQuery(r);
    const ck = norm(q);
    if (!ck) { report.skipped.push({ name: r.name, reason: 'no address to geocode' }); continue; }
    if (ck in cache) {
      report.cacheHits++;
    } else {
      const wait = lastReq + GEOCODE_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastReq = Date.now();
      try {
        const url = `${NOMINATIM_URL}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const hits = await res.json();
        cache[ck] = hits.length ? { lat: parseFloat(hits[0].lat), lng: parseFloat(hits[0].lon) } : null;
        writeJson(cacheFile, cache, 1);
        report.geocoded++;
      } catch (e) {
        // Transient failure: don't cache, so a re-run retries it.
        report.skipped.push({ name: r.name, reason: 'geocode error: ' + e.message });
        continue;
      }
    }
    const hit = cache[ck];
    if (hit) { r.lat = hit.lat; r.lng = hit.lng; r.geocoded = true; }
    else report.skipped.push({ name: r.name, reason: 'geocoder found no match for "' + q + '"' });
  }
}

// ---------------------------------------------------------------- classify
const RE_PLASTIC = /plastic surg|facial plastic|reconstructive surg|plastic (and|&) reconstructive/i;
const RE_DERM = /dermatolog/i;
const RE_MEDSPA = /med\s*spa|medspa|medical spa|aesthetic|injectable|botox|laser|cosmetic (surg|cent|clinic)|skin (clinic|care|bar)|wellness|face (&|and) body/i;
const RE_DR = /^Dr\.?\s/i;
const RE_CRED = /\b(M\.?D\.?|D\.?O\.?|F\.?A\.?C\.?S\.?|N\.?P\.?)\b/i;

// Returns { type, byDefault } or { exclude: reason }.
// Text = name + source category column, if any. With no keyword hit: if the
// source gave a category that says something else, exclude; otherwise default
// to Medspa and flag it for manual verification.
function classify(r) {
  const text = r.name + ' ' + r.category;
  if (RE_PLASTIC.test(text)) return { type: 'Plastic surgery' };
  if (RE_DERM.test(text)) return { type: 'Cosmetic dermatology' };
  if (RE_MEDSPA.test(text)) return { type: 'Medspa' };
  if (RE_DR.test(r.name) || RE_CRED.test(text)) return { type: 'Aesthetic physician' };
  if (r.category) return { exclude: 'not a medical-aesthetics business (category "' + r.category + '")' };
  return { type: 'Medspa', byDefault: true };
}

// ---------------------------------------------------------------- main
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('Usage: node scripts/import-practices.js <file.csv|file.json> [--force] [--dry-run]'); process.exit(1); }
  if (!fs.existsSync(file)) { console.error('File not found: ' + file); process.exit(1); }

  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const imported = readJson(P('.imported-files.json'), {});
  if (imported[hash] && !force) {
    console.error(`Already imported: ${imported[hash].file} on ${imported[hash].date} (+${imported[hash].added} rows).\nRe-run with --force to import it again.`);
    process.exit(1);
  }

  const anchors = readJson(P('metro-anchors.json'), null);
  if (!anchors) throw new Error('Missing ' + P('metro-anchors.json'));
  const dataset = readJson(P('practices.json'), null);
  if (!dataset) throw new Error('Missing ' + P('practices.json'));
  const existing = dataset.practices;

  const report = { skipped: [], excluded: [], flagged: [], geocoded: 0, cacheHits: 0 };
  const counts = {};

  const raw = readRows(file);
  counts.source = raw.length;
  const map = buildMapping(raw);

  // 1. column mapping
  let rows = [];
  for (const r of raw.map((x) => mapRow(x, map))) {
    if (!r.name) { report.excluded.push({ name: '(blank)', reason: 'missing name' }); continue; }
    if (r.lat === undefined && !r.address && !(r.city && r.state)) { report.excluded.push({ name: r.name, reason: 'no address or city/state' }); continue; }
    rows.push(r);
  }
  counts.mapped = rows.length;

  // 2. geocode
  await geocodeAll(rows, report);
  rows = rows.filter((r) => r.lat !== undefined);
  counts.geocoded = rows.length;

  // 3. classify + metro
  const kept = [];
  for (const r of rows) {
    const c = classify(r);
    if (c.exclude) { report.excluded.push({ name: r.name, reason: c.exclude }); continue; }
    let best = null, bestD = Infinity;
    for (const a of anchors) {
      const d = haversineMi(r.lat, r.lng, a.lat, a.lng);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (bestD > MAX_METRO_MILES) { report.excluded.push({ name: r.name, reason: `no metro within range (nearest ${best.metro}, ${bestD.toFixed(0)} mi)` }); continue; }
    r.type = c.type;
    r.metro = best.metro;
    if (c.byDefault) report.flagged.push(r.name);
    kept.push(r);
  }
  counts.classified = kept.length;

  // 4. dedupe
  const seenExact = new Set(existing.map((p) => norm(p.name) + '|' + norm(p.address)));
  const review = [];
  const added = [];
  let exactDups = 0;
  for (const r of kept) {
    const fullAddr = r.address && /\d{5}/.test(r.address) ? r.address : [r.address, r.city, `${r.state} ${r.zip}`.trim()].filter(Boolean).join(', ');
    r.fullAddress = fullAddr;
    const ek = norm(r.name) + '|' + norm(fullAddr);
    if (seenExact.has(ek) || seenExact.has(norm(r.name) + '|' + norm(r.address))) { exactDups++; continue; }
    const pool = existing.concat(added);
    const matches = [];
    for (const p of pool) {
      const sameZip = r.zip && zip5(p.zip) === r.zip;
      const meters = haversineMi(r.lat, r.lng, p.lat, p.lng) * 1609.344;
      const reasons = [];
      if (sameZip && namesClose(r.name, p.name)) reasons.push('same zip + similar name');
      if (meters <= GEO_DUP_METERS) reasons.push(`within ${Math.round(meters)} m`);
      if (reasons.length) matches.push({ id: p.id, name: p.name, address: p.address, reasons });
    }
    if (matches.length) {
      review.push({ incoming: { name: r.name, address: fullAddr, city: r.city, state: r.state, zip: r.zip, phone: r.phone, lat: r.lat, lng: r.lng, type: r.type, metro: r.metro }, possibleDuplicates: matches });
      continue;
    }
    seenExact.add(ek);
    const idSeed = crypto.createHash('sha1').update(norm(r.name) + '|' + norm(fullAddr)).digest('hex').slice(0, 16);
    const p = {
      id: 'imp-' + idSeed,
      name: r.name,
      type: r.type,
      address: fullAddr,
      city: r.city,
      state: r.state,
      zip: r.zip,
      metro: r.metro,
      lat: +r.lat.toFixed(5),
      lng: +r.lng.toFixed(5),
      phone: r.phone || null,
      rating: null,
      reviews: 0,
    };
    if (r.website) p.website = r.website;
    added.push(p);
  }
  counts.afterDedup = added.length;

  // 5. write
  const today = new Date().toISOString().slice(0, 10);
  const base = path.basename(file);
  if (!dryRun) {
    if (added.length) {
      dataset.practices = existing.concat(added);
      dataset.generated = today;
      dataset.source = `${dataset.source || ''}; import: ${base} (+${added.length} rows, ${today})`.replace(/^; /, '');
      writeJson(P('practices.json'), dataset, 1);
    }
    if (review.length) {
      const rf = P('needs-review.json');
      writeJson(rf, readJson(rf, []).concat(review.map((e) => ({ sourceFile: base, date: today, ...e }))), 1);
    }
    imported[hash] = { file: base, date: today, added: added.length };
    writeJson(P('.imported-files.json'), imported, 1);
  }

  // 6. report
  const tally = (list, f) => list.reduce((o, x) => ((o[f(x)] = (o[f(x)] || 0) + 1), o), {});
  const fmt = (o) => Object.entries(o).sort().map(([k, v]) => `    ${k}: ${v}`).join('\n') || '    (none)';
  console.log(`\nImport report${dryRun ? ' (dry run — nothing written)' : ''}: ${base}`);
  console.log(`  rows in source file:            ${counts.source}`);
  console.log(`  after column mapping:           ${counts.mapped}`);
  console.log(`  after geocoding:                ${counts.geocoded}   (${report.geocoded} geocoded, ${report.cacheHits} from cache)`);
  console.log(`  after classification/filtering: ${counts.classified}`);
  console.log(`  after dedup:                    ${counts.afterDedup}   (${exactDups} exact duplicates skipped, ${review.length} sent to review)`);
  console.log(`  FINAL ROWS ADDED:               ${added.length}`);
  console.log('  by metro:\n' + fmt(tally(added, (p) => p.metro)));
  console.log('  by type:\n' + fmt(tally(added, (p) => p.type)));
  if (report.skipped.length) console.log('  skipped (geocoding):\n' + report.skipped.map((s) => `    - ${s.name}: ${s.reason}`).join('\n'));
  if (report.excluded.length) console.log('  excluded:\n' + report.excluded.map((s) => `    - ${s.name}: ${s.reason}`).join('\n'));
  if (report.flagged.length) console.log('  classified by default (Medspa) — verify manually:\n' + report.flagged.map((n) => `    - ${n}`).join('\n'));
  if (review.length) console.log(`\n  ${review.length} possible duplicate(s) written to ${P('needs-review.json')} — inspect them by hand.`);
}

main().catch((e) => { console.error('\nImport failed: ' + e.message); process.exit(1); });
