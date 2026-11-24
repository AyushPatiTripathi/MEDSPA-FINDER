# Medspa Finder

Map and grid explorer for medspa / plastic surgery / cosmetic dermatology practices.

## Run

```
npm install
npm start
```

Open http://localhost:3000. It works with no setup: the map uses OpenStreetMap tiles by default.

## Optional: CARTO basemap

For a nicer-looking basemap, get a free key at https://carto.com/basemaps/apikey/, then:

```
cp .env.example .env
# edit .env and set CARTO_API_KEY=your_key
```

Restart the server. With no key (or a blank one) the app falls back to OpenStreetMap.
`.env` is gitignored.

## Features

- **Grid filter:** the Grid tab's search box filters cities and practice names as you type; the type chips narrow by practice type.
- **CSV export:** pick a state in the Map sidebar and click Download CSV (`/api/export.csv?state=NY`, or omit `state` for everything).
- **AI market plan (optional):** add a free Groq key (https://console.groq.com/keys) as `GROQ_API_KEY` in `.env`, then pick a state and click Generate plan. Plans are generated on demand and not stored.

## Importing more practices

```
node scripts/import-practices.js path/to/list.csv        # or .json
node scripts/import-practices.js list.csv --dry-run      # report only, writes nothing
node scripts/import-practices.js list.csv --force        # re-import an already-imported file
```

- **Input:** a CSV, or a JSON array of objects. Column names are matched case-insensitively against common aliases (`name`/`business_name`/`practice_name`/`title`, `address`/`street_address`/`full_address`, `city`, `state`, `zip`/`postal_code`, `phone`, `lat`/`latitude`, `lng`/`lon`/`longitude`, `website`/`url`). A name plus an address (or city + state) is required. If the columns can't be mapped, the script prints the headers it found; extend `ALIASES` in the script. An optional `category`/`type`/`description` column helps classification.
- **Geocoding:** rows without coordinates are geocoded with OpenStreetMap Nominatim (1 request/second, results cached in `data/.geocode-cache.json`). Set `NOMINATIM_CONTACT` in `.env` to an email or URL, since Nominatim requires one in the User-Agent. Rows that fail to geocode are skipped and listed in the report.
- **Filtering:** rows are classified into the four existing types. Rows with no keyword match default to Medspa and are flagged in the report for manual checking, unless the source category clearly says it's something else, in which case they are excluded. Rows more than 40 miles from every anchor in `data/metro-anchors.json` are excluded. That file is static; edit it by hand to add metros.
- **Dedup:** exact name + address matches are skipped. Possible duplicates (same zip with a similar name, or within ~50 m of an existing practice) are not added; they are written to `data/needs-review.json`.
- **`needs-review.json`:** each entry has the incoming row and the existing practices it may duplicate, with the reason. Inspect them: if it's a genuine new practice, add it to `data/practices.json` by hand; otherwise delete the entry. The script appends to this file, so clear entries you've dealt with.
- **Re-runs:** imported files are tracked by hash in `data/.imported-files.json`; the script refuses to import the same file twice without `--force`. Imported rows have no rating or review data. Restart the server or call `/api/reload` to pick up new data.

## Outreach tracking (website, contacted / meeting set / onboarded)

Each practice has a website field and three toggles (Contacted, Meeting set up, Onboarded), shown in the map popup and on grid cards. Onboarded practices get an "AG" badge in the grid and a gold ring with an "AG" label on the map (change `ONBOARDED_BADGE_LABEL` in `public/common.js` to rename it).

This data is stored in Postgres, not on disk, so it survives Render's restarts and redeploys. It lives in its own `practice_status` table keyed by practice id, so importing more practices never touches it.

1. Create a free database at https://neon.tech (no credit card, doesn't expire) and copy the connection string from the dashboard.
2. Put it in `.env` (and in Render's environment variables) as `DATABASE_URL`. It looks like `postgresql://user:password@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require`.
3. Run `npm run migrate` once to create the table (safe to re-run).

Without `DATABASE_URL` the app still runs; the toggles just show an error when you try to save. Add `DATABASE_URL` (`sync: false`) to the Render service's env vars as well.
