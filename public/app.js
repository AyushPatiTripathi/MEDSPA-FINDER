// Tab switching + the header stat line. Each view's own init function
// (from map.js / grid.js) is called lazily, the first time its tab is shown.
(function () {
  const { state } = window.MF;
  const tabs = [...document.querySelectorAll('.tab')];
  const views = { map: document.getElementById('view-map'), grid: document.getElementById('view-grid'), pipeline: document.getElementById('view-pipeline') };
  const inited = { map: false, grid: false, pipeline: false };
  const seen = { map: 0, grid: 0, pipeline: 0 }; // state.crmVersion each view last rendered at

  function switchTab(name) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    Object.entries(views).forEach(([k, el]) => el.classList.toggle('active', k === name));
    if (name === 'map' && !inited.map) { inited.map = true; window.MF_initMapView(); }
    if (name === 'grid' && !inited.grid) { inited.grid = true; window.MF_initGridView(); }
    if (name === 'pipeline' && !inited.pipeline) { inited.pipeline = true; window.MF_initPipelineView(); }
    if (name === 'map' && window.MF_mapResize) window.MF_mapResize();
    // Edits made in another tab leave this one stale (marker rings, card badges): redraw.
    if (seen[name] !== undefined && seen[name] !== state.crmVersion) {
      seen[name] = state.crmVersion;
      if (name === 'map' && window.MF_mapRefresh) window.MF_mapRefresh();
      if (name === 'grid' && window.MF_gridRefresh) window.MF_gridRefresh();
      if (name === 'pipeline' && window.MF_pipelineRefresh) window.MF_pipelineRefresh();
    }
  }

  tabs.forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));

  const initialTab = location.hash.startsWith('#grid') ? 'grid' : location.hash.startsWith('#pipeline') ? 'pipeline' : 'map';
  switchTab(initialTab);

  state.ready.then(() => {
    const states = new Set(state.practices.map((p) => p.state));
    document.getElementById('stats').textContent = `${state.practices.length.toLocaleString()} practices · ${state.cities.size} cities · ${states.size} states${state.generated ? ` · data from ${state.generated}` : ''}`;
  });
})();
