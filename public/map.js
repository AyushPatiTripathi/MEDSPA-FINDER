// Real Leaflet map: CARTO Voyager (if a key is configured) or OpenStreetMap tiles, marker clustering so the
// country view declutters into per-city clusters and resolves into
// individual practices as you zoom in — this replaces the earlier
// hand-rolled drill-down with actual geographic zoom.
(function () {
  const { TYPES, COL, LBL, esc, mi, state, visible, ONBOARDED_BADGE_LABEL, crmHtml, crmBind } = window.MF;

  let map, cluster, pinMode = false, pinMarker = null, pinCircle = null, pinLines = [];
  let radius = 5;

  // CARTO Voyager when a key is configured, otherwise plain OpenStreetMap.
  function tileLayer(key) {
    if (key) {
      return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=' + encodeURIComponent(key), {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      });
    }
    return L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
  }

  function initMap(cartoApiKey) {
    map = L.map('map', { zoomControl: true, minZoom: 3, maxZoom: 18 }).setView([39.5, -98.35], 4);
    tileLayer(cartoApiKey).addTo(map);

    cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      iconCreateFunction(c) {
        const kids = c.getAllChildMarkers();
        const counts = {};
        kids.forEach((m) => { counts[m.options.ptype] = (counts[m.options.ptype] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        const n = c.getChildCount();
        const size = n < 10 ? 34 : n < 50 ? 42 : 50;
        return L.divIcon({
          html: `<div class="clusterDot" style="width:${size}px;height:${size}px;background:${COL[top]}">${n}</div>`,
          className: '',
          iconSize: [size, size],
        });
      },
    });
    map.addLayer(cluster);

    map.on('click', (e) => {
      if (pinMode) dropPin(e.latlng);
    });
  }

  // Onboarded practices keep their type colour but get a gold ring and a small label.
  function markerIcon(p) {
    if (p.onboarded) {
      return L.divIcon({
        html: `<div class="dotMarker onboarded" style="background:${COL[p.type]}"></div><span class="agLabel">${esc(ONBOARDED_BADGE_LABEL)}</span>`,
        className: 'onboardedIcon',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -8],
      });
    }
    return L.divIcon({
      html: `<div class="dotMarker" style="background:${COL[p.type]}"></div>`,
      className: '',
      iconSize: [16, 16],
      popupAnchor: [0, -6],
    });
  }

  function popupHtml(p) {
    return `<div class="popup">
      <b>${esc(p.name)}</b>
      <div class="tagline"><span class="dot" style="background:${COL[p.type]}"></span>${esc(LBL[p.type])}</div>
      <div class="meta">${p.rating ?? '–'}★ (${(p.reviews || 0).toLocaleString()} reviews)</div>
      <div class="addr">${esc(p.address)}</div>
      ${p.phone ? `<a class="phone" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''}
      ${crmHtml(p)}
    </div>`;
  }

  function refreshMarkers() {
    cluster.clearLayers();
    const markers = visible(state.practices).map((p) => {
      const m = L.marker([p.lat, p.lng], { icon: markerIcon(p), ptype: p.type });
      // Built fresh on each open so it always reflects the latest saved status.
      m.bindPopup(() => {
        const el = document.createElement('div');
        el.innerHTML = popupHtml(p);
        crmBind(el, p, () => m.setIcon(markerIcon(p)));
        return el;
      });
      return m;
    });
    cluster.addLayers(markers);
  }

  function flyToCity(key) {
    const c = state.cities.get(key);
    if (!c) return;
    const pts = c.L.map((p) => [p.lat, p.lng]);
    const bounds = L.latLngBounds(pts);
    map.flyToBounds(bounds.pad(0.25), { maxZoom: 14, duration: 0.9 });
  }

  function clearPin() {
    if (pinMarker) map.removeLayer(pinMarker);
    if (pinCircle) map.removeLayer(pinCircle);
    pinLines.forEach((l) => map.removeLayer(l));
    pinMarker = null; pinCircle = null; pinLines = [];
    document.getElementById('pinResult').innerHTML = '';
  }

  function dropPin(latlng) {
    clearPin();
    const nearest = visible(state.practices)
      .map((p) => ({ p, d: mi(latlng.lat, latlng.lng, p.lat, p.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    pinMarker = L.circleMarker(latlng, { radius: 7, color: '#1d1720', weight: 2, fillColor: '#1d1720', fillOpacity: 1 }).addTo(map);
    pinCircle = L.circle(latlng, { radius: radius * 1609.34, color: '#1d1720', weight: 1, dashArray: '4 4', fill: false }).addTo(map);
    pinLines = nearest.map(({ p }) => L.polyline([latlng, [p.lat, p.lng]], { color: '#1d1720', weight: 1.5 }).addTo(map));

    const ok = nearest.length === 3 && nearest[2].d <= radius;
    const list = nearest
      .map(
        ({ p, d }, i) => `<div class="pinRow">
      <b>${i + 1}. ${esc(p.name)}</b> <span class="num">${d.toFixed(1)} mi</span>
      <div class="meta"><span class="dot" style="background:${COL[p.type]}"></span>${esc(LBL[p.type])} · ${esc(p.city)}, ${esc(p.state)}</div>
    </div>`
      )
      .join('');
    document.getElementById('pinResult').innerHTML = `
      <div class="verdict ${ok ? 'ok' : 'no'}">${ok ? `Covered: 3 within ${radius} mi` : `Not covered${nearest[2] ? `: 3rd-nearest is ${nearest[2].d.toFixed(1)} mi away` : ''}`}</div>
      ${list}`;
  }

  function renderStateList() {
    const byState = new Map();
    for (const c of state.cities.values()) {
      if (!byState.has(c.state)) byState.set(c.state, { state: c.state, n: 0, cities: [] });
      const s = byState.get(c.state);
      s.n += c.L.length;
      s.cities.push(c);
    }
    const states = [...byState.values()].sort((a, b) => b.n - a.n);
    const el = document.getElementById('stateList');
    el.innerHTML = states
      .map(
        (s, i) => `<details class="stateRow" ${i === 0 ? 'open' : ''}>
      <summary><b>${esc(s.state)}</b><span class="num">${s.n}</span></summary>
      <div class="cityRows">${s.cities
        .sort((a, b) => b.L.length - a.L.length)
        .map((c) => `<button class="cityRow" data-k="${esc(c.key)}"><span>${esc(c.city)}</span><span class="num">${c.L.length}</span></button>`)
        .join('')}</div>
    </details>`
      )
      .join('');
    el.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => flyToCity(b.dataset.k)));
  }

  function mountChips() {
    const el = document.getElementById('mapChips');
    el.innerHTML = TYPES.map((t) => `<button class="chip" data-t="${t[0]}" aria-pressed="${state.on.has(t[0])}"><i style="background:${t[1]}"></i>${t[2]}</button>`).join('');
    el.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        const t = b.dataset.t;
        state.on.has(t) ? state.on.delete(t) : state.on.add(t);
        if (!state.on.size) state.on.add(t);
        mountChips();
        refreshMarkers();
        if (pinMarker) dropPin(pinMarker.getLatLng());
      };
    });
  }

  function mountCitySearch() {
    const input = document.getElementById('citySearch');
    const list = document.getElementById('cityList');
    list.innerHTML = [...state.cities.keys()].sort().map((k) => `<option value="${esc(k)}">`).join('');
    input.onchange = () => {
      const v = input.value.trim();
      const key = [...state.cities.keys()].find((k) => k.toLowerCase() === v.toLowerCase());
      if (key) { flyToCity(key); input.value = ''; }
    };
  }

  function mountPinControls() {
    const btn = document.getElementById('pinToggle');
    const radiusInput = document.getElementById('radius');
    const radiusVal = document.getElementById('radiusVal');
    btn.onclick = () => {
      pinMode = !pinMode;
      btn.setAttribute('aria-pressed', String(pinMode));
      btn.textContent = pinMode ? 'Click the map to drop a pin' : 'Drop a pin: 3 nearest';
      document.getElementById('map').classList.toggle('pinCursor', pinMode);
      if (!pinMode) clearPin();
    };
    radiusInput.oninput = (e) => {
      radius = +e.target.value;
      radiusVal.textContent = radius + ' mi';
      if (pinMarker) dropPin(pinMarker.getLatLng());
    };
  }

  window.MF_mapResize = function () {
    if (map) setTimeout(() => map.invalidateSize(), 0);
  };

  window.MF_mapRefresh = function () { if (map && cluster) refreshMarkers(); };

  let mapInit = null;
  window.MF_initMapView = function () {
    if (!mapInit) {
      mapInit = fetch('/api/config')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}))
        .then((cfg) => {
          initMap(cfg.cartoApiKey || null);
          mountChips();
          mountPinControls();
        });
    }
    Promise.all([mapInit, state.ready]).then(() => {
      mountCitySearch();
      renderStateList();
      refreshMarkers();
      setTimeout(() => map.invalidateSize(), 50);
    });
  };
})();
