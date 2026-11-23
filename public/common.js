// Shared data loading, type/colour config, and small helpers used by
// both map.js and grid.js. Everything hangs off window.MF.
(function () {
  const TYPES = [
    ['Medspa', '#c2366b', 'Medspa'],
    ['Plastic surgery', '#1f7a96', 'Plastic surgery'],
    ['Cosmetic dermatology', '#d38c06', 'Cosmetic dermatology'],
    ['Aesthetic physician', '#847b8c', 'Physician (type to verify)'],
  ];
  const COL = Object.fromEntries(TYPES.map((t) => [t[0], t[1]]));
  const LBL = Object.fromEntries(TYPES.map((t) => [t[0], t[2]]));

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const slug = (s) =>
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  // Great-circle distance in miles.
  function mi(aLat, aLng, bLat, bLng) {
    const r = Math.PI / 180;
    const x = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
    return 7917.6 * Math.asin(Math.sqrt(x));
  }

  const state = {
    practices: [],
    cities: new Map(), // key "City, ST" -> { key, city, state, metro, L: [...] }
    on: new Set(TYPES.map((t) => t[0])), // active type filter
    ready: null,
  };

  function buildCities() {
    state.cities = new Map();
    for (const p of state.practices) {
      const k = `${p.city}, ${p.state}`;
      if (!state.cities.has(k)) state.cities.set(k, { key: k, city: p.city, state: p.state, metro: p.metro, L: [] });
      state.cities.get(k).L.push(p);
    }
  }

  function visible(list) {
    return list.filter((p) => state.on.has(p.type));
  }

  state.ready = fetch('/api/practices')
    .then((r) => {
      if (!r.ok) throw new Error('practices request failed: ' + r.status);
      return r.json();
    })
    .then((d) => {
      state.practices = d.practices || [];
      state.generated = d.generated;
      buildCities();
      return state;
    });

  window.MF = { TYPES, COL, LBL, esc, slug, mi, state, visible };
})();
