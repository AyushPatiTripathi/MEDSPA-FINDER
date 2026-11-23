// City -> area -> practice-card drill-down, as an alternative to the map
// for people who'd rather browse than pan/zoom. Areas are a balanced
// median split of each city's practices (k-d tree), not real
// neighbourhoods, so counts stay even across tiles.
(function () {
  const { TYPES, COL, LBL, esc, slug, state, visible } = window.MF;

  function initials(n) {
    const w = n.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
    return ((w[0]?.[0] || '') + (w[1]?.[0] || '')).toUpperCase() || '·';
  }

  function mixBar(list) {
    const c = {};
    TYPES.forEach((t) => (c[t[0]] = 0));
    list.forEach((p) => c[p.type]++);
    return `<div class="mix">${TYPES.map((t) => (c[t[0]] ? `<span style="width:${(c[t[0]] / list.length) * 100}%;background:${t[1]}"></span>` : '')).join('')}</div>`;
  }

  function kdSplit(items, axes) {
    let groups = [{ items, path: [] }];
    for (const ax of axes) {
      const next = [];
      for (const g of groups) {
        const sorted = [...g.items].sort((a, b) => a[ax] - b[ax]);
        const mid = Math.ceil(sorted.length / 2);
        next.push({ items: sorted.slice(0, mid), path: [...g.path, ax === 'lat' ? 'South' : 'West'] });
        next.push({ items: sorted.slice(mid), path: [...g.path, ax === 'lat' ? 'North' : 'East'] });
      }
      groups = next;
    }
    return groups.filter((g) => g.items.length).map((g) => ({ label: g.path.join(' '), items: g.items }));
  }

  function sectorsFor(key) {
    const L = state.cities.get(key).L;
    const n = L.length;
    if (n <= 6) return [{ label: 'All practices', items: L }];
    const lats = L.map((p) => p.lat);
    const lngs = L.map((p) => p.lng);
    const midLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const latMi = (Math.max(...lats) - Math.min(...lats)) * 69;
    const lngMi = (Math.max(...lngs) - Math.min(...lngs)) * 69 * Math.cos((midLat * Math.PI) / 180);
    const a1 = latMi >= lngMi ? 'lat' : 'lng';
    const a2 = a1 === 'lat' ? 'lng' : 'lat';
    const depth = n <= 14 ? 1 : n <= 28 ? 2 : 3;
    return kdSplit(L, [a1, a2, a1].slice(0, depth));
  }

  let on2 = new Set(TYPES.map((t) => t[0])); // grid's own filter, mirrors map's on first load
  const root = () => document.getElementById('gridView');

  function chipsHtml() {
    return TYPES.map((t) => `<button class="chip" data-t="${t[0]}" aria-pressed="${on2.has(t[0])}"><i style="background:${t[1]}"></i>${t[2]}</button>`).join('');
  }
  function mountChips(after) {
    let m = document.getElementById('gridChips');
    if (!m) {
      m = document.createElement('div');
      m.id = 'gridChips';
      m.className = 'chips';
      document.querySelector('#view-grid .search-row').after(m);
    }
    m.innerHTML = chipsHtml();
    m.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        on2.has(t) ? on2.delete(t) : on2.add(t);
        if (!on2.size) on2.add(t);
        after();
      };
    });
  }
  // Text filter (debounced input). In a city/sector view it matches practice
  // names only, and is ignored when it just matched the city's own name.
  let gridQ = '';
  let curCity = null; // city key of the current city/sector view, else null
  const norm = (s) => String(s || '').toLowerCase();
  const cityMatches = (c) => !!gridQ && norm(c.key).includes(gridQ);
  const nameMatches = (p) => norm(p.name).includes(gridQ);
  const vis2 = (L) => {
    const useQ = gridQ && !(curCity && cityMatches(state.cities.get(curCity)));
    return L.filter((p) => on2.has(p.type) && (!useQ || nameMatches(p)));
  };

  function renderHome() {
    curCity = null;
    const filtering = !!gridQ || on2.size < TYPES.length;
    let cities = [...state.cities.values()].map((c) => {
      const typed = c.L.filter((p) => on2.has(p.type));
      const n = cityMatches(c) || !gridQ ? typed.length : typed.filter(nameMatches).length;
      return { c, n };
    });
    cities = cities.filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    const total = cities.length;
    const shown = filtering ? cities.slice(0, 60) : cities.slice(0, 12);
    const head = filtering
      ? `<h2 class="hd">${total} matching ${total === 1 ? 'city' : 'cities'}</h2><p class="sub">${total > shown.length ? `Showing the ${shown.length} with the most matches. ` : ''}Counts reflect your filters.</p>`
      : `<h2 class="hd">Jump to a city</h2><p class="sub">Filter above, or pick a busy one below.</p>`;
    root().innerHTML = `<p class="crumbline">${state.practices.length.toLocaleString()} practices across ${state.cities.size} US cities</p>
      ${head}
      <div class="tiles">${
        shown
          .map(
            ({ c, n }) => `<button class="tile home-tile" data-c="${esc(c.key)}"><span class="num">${n}</span><b>${esc(c.city)}</b><span class="sub2">${esc(c.state)} · ${esc(c.metro)} metro</span></button>`
          )
          .join('') || '<p class="empty">No results. Try a different city, practice name, or type filter.</p>'
      }</div>`;
    root()
      .querySelectorAll('[data-c]')
      .forEach((b) => (b.onclick = () => (location.hash = 'grid-city-' + slug(b.dataset.c))));
    mountChips(renderHome);
  }

  function renderCity(key) {
    const c = state.cities.get(key);
    if (!c) return renderHome();
    curCity = key;
    const secs = sectorsFor(key).map((s) => ({ ...s, shown: vis2(s.items) }));
    root().innerHTML = `<p class="crumbline"><a href="#" id="toHome">All cities</a> &rsaquo; ${esc(c.city)}, ${esc(c.state)}</p>
      <h2 class="hd">${esc(c.city)}: ${vis2(c.L).length} practices</h2><p class="sub">${secs.length > 1 ? 'Pick an area to see its practices.' : 'Showing every practice found in this city.'}</p>
      <div class="tiles">${
        secs
          .map((s, i) => (s.shown.length ? `<button class="tile" data-i="${i}"><span class="num">${s.shown.length}</span><b>${esc(s.label)}</b>${mixBar(s.items)}</button>` : ''))
          .join('') || '<p class="empty">No practices match your search or filters.</p>'
      }</div>`;
    root().querySelector('#toHome').onclick = (e) => { e.preventDefault(); location.hash = 'grid'; };
    if (secs.length === 1) { location.hash = 'grid-sector-' + slug(key) + '-0'; return; }
    root()
      .querySelectorAll('[data-i]')
      .forEach((b) => (b.onclick = () => (location.hash = 'grid-sector-' + slug(key) + '-' + b.dataset.i)));
    mountChips(() => renderCity(key));
  }

  function renderSector(key, idx) {
    const c = state.cities.get(key);
    if (!c) return renderHome();
    curCity = key;
    const secs = sectorsFor(key);
    const s = secs[idx];
    if (!s) return renderCity(key);
    const L = vis2(s.items).sort((a, b) => b.reviews - a.reviews);
    const crumb = secs.length > 1 ? `<a href="#" id="toCity">${esc(c.city)}</a> &rsaquo; ${esc(s.label)}` : `${esc(c.city)}, ${esc(c.state)}`;
    root().innerHTML = `<p class="crumbline"><a href="#" id="toHome">All cities</a> &rsaquo; ${crumb}</p>
      <h2 class="hd">${L.length} practice${L.length === 1 ? '' : 's'}</h2><p class="sub">Most-reviewed first.</p>
      <div class="cards">${
        L.map(
          (p) => `<article class="card">
        <div class="top"><div class="avatar" style="background:${COL[p.type]}">${initials(p.name)}</div>
        <div><b>${esc(p.name)}</b><br><span class="tag"><i style="background:${COL[p.type]}"></i>${esc(LBL[p.type])}</span></div></div>
        <div class="rating">${p.rating ?? '–'}★ <span class="muted">(${(p.reviews || 0).toLocaleString()} reviews)</span></div>
        <div class="addr">${esc(p.address)}</div>
        ${p.phone ? `<a class="phone" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''}
      </article>`
        ).join('') || '<p class="empty">No practices match your search or filters.</p>'
      }</div>`;
    root().querySelector('#toHome').onclick = (e) => { e.preventDefault(); location.hash = 'grid'; };
    const toCity = root().querySelector('#toCity');
    if (toCity) toCity.onclick = (e) => { e.preventDefault(); location.hash = 'grid-city-' + slug(key); };
    mountChips(() => renderSector(key, idx));
  }

  function route() {
    const h = location.hash.replace(/^#/, '');
    let m;
    if ((m = h.match(/^grid-city-(.+)$/))) { const key = [...state.cities.keys()].find((k) => slug(k) === m[1]); return renderCity(key); }
    if ((m = h.match(/^grid-sector-(.+)-(\d+)$/))) { const key = [...state.cities.keys()].find((k) => slug(k) === m[1]); return renderSector(key, +m[2]); }
    renderHome();
  }

  function mountSearch() {
    const input = document.getElementById('gridSearch');
    document.getElementById('gridCityList').innerHTML = [...state.cities.keys()].sort().map((k) => `<option value="${esc(k)}">`).join('');
    let timer;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        gridQ = input.value.trim().toLowerCase();
        route();
      }, 150);
    };
    // Picking an exact "City, ST" from the suggestions jumps straight to it.
    input.onchange = () => {
      const v = input.value.trim().toLowerCase();
      const key = [...state.cities.keys()].find((k) => k.toLowerCase() === v);
      if (key) { clearTimeout(timer); gridQ = ''; input.value = ''; location.hash = 'grid-city-' + slug(key); }
    };
  }

  window.addEventListener('hashchange', () => {
    if (document.getElementById('view-grid').classList.contains('active')) route();
  });

  window.MF_initGridView = function () {
    state.ready.then(() => {
      mountSearch();
      route();
    });
  };
})();
