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
