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
