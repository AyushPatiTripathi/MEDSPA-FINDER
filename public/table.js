// Table (pipeline) tab: sortable, filterable, paginated list of every practice
// with all CRM fields editable inline. Edits go through the same PATCH endpoint
// and the same shared widgets (MF.crmBind) as the map popup and grid cards.
(function () {
  const { COL, LBL, esc, state, ONBOARDED_BADGE_LABEL, crmBind, urlHtml, checkHtml, dateHtml } = window.MF;
  const PAGE_SIZE = 50;

  const COLUMNS = [
    { key: 'name', label: 'Name', sort: true },
    { key: 'metro', label: 'Metro', sort: true },
    { key: 'city', label: 'City', sort: true },
    { key: 'state', label: 'State', sort: true },
    { key: 'type', label: 'Type', sort: true },
    { key: 'phone', label: 'Phone' },
    { key: 'website', label: 'Website' },
    { key: 'contacted', label: 'Contacted', sort: true },
    { key: 'meeting_set', label: 'Meeting set', sort: true },
    { key: 'meeting_date', label: 'Meeting date', sort: true },
    { key: 'meeting_link', label: 'Meeting link' },
    { key: 'onboarded', label: 'Onboarded', sort: true },
    { key: '_msg', label: '' },
  ];

  // Default: meetings with a date, soonest upcoming first, so the tab opens on "what's next".
  let sort = { key: 'meeting_date', dir: 'asc' };
  let q = '';
  let statusFilter = 'all';
  let page = 0;
  let rows = []; // filtered + sorted

  const norm = (s) => String(s || '').toLowerCase();
  const time = (p) => (p.meeting_date ? new Date(p.meeting_date).getTime() : null);

  function compare(a, b) {
    const { key, dir } = sort;
    const m = dir === 'asc' ? 1 : -1;
    let c = 0;
    if (key === 'meeting_date') {
      const ta = time(a), tb = time(b);
      if (ta === null || tb === null) c = ta === tb ? 0 : ta === null ? 1 : -1; // undated always last
      else if (dir === 'asc') {
        // upcoming first (soonest), then past (most recent first)
        const now = Date.now();
        const fa = ta >= now, fb = tb >= now;
        c = fa !== fb ? (fa ? -1 : 1) : fa ? ta - tb : tb - ta;
      } else c = tb - ta;
      if (c) return c;
    } else if (['contacted', 'meeting_set', 'onboarded'].includes(key)) {
      c = (b[key] ? 1 : 0) - (a[key] ? 1 : 0); // ticked first on asc click
      if (c) return c * m;
    } else {
      c = norm(a[key]).localeCompare(norm(b[key]));
      if (c) return c * m;
    }
    return norm(a.name).localeCompare(norm(b.name));
  }

  function matchesStatus(p) {
    switch (statusFilter) {
      case 'not_contacted': return !p.contacted;
      case 'contacted': return p.contacted;
      case 'meeting_set': return p.meeting_set;
      case 'onboarded': return p.onboarded;
      default: return true;
    }
  }

  function recompute() {
    rows = state.practices
      .filter((p) => matchesStatus(p) && (!q || norm(p.name).includes(q) || norm(p.city).includes(q)))
      .sort(compare);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
  }

  const badge = (p) => (p.onboarded ? `<span class="agBadge">${esc(ONBOARDED_BADGE_LABEL)}</span>` : '');

  function rowHtml(p) {
    return `<tr data-id="${esc(p.id)}">
      <td class="rname" title="${esc(p.name)}">${esc(p.name)} <span class="agslot">${badge(p)}</span></td>
      <td>${esc(p.metro)}</td>
      <td>${esc(p.city)}</td>
      <td>${esc(p.state)}</td>
      <td><span class="tag"><i style="background:${COL[p.type]}"></i>${esc(LBL[p.type] || p.type)}</span></td>
      <td>${p.phone ? `<a class="phone" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''}</td>
      <td>${urlHtml(p, 'website')}</td>
      <td class="c">${checkHtml(p, 'contacted')}</td>
      <td class="c">${checkHtml(p, 'meeting_set')}</td>
      <td>${dateHtml(p)}</td>
      <td>${urlHtml(p, 'meeting_link')}</td>
      <td class="c">${checkHtml(p, 'onboarded')}</td>
      <td><span class="crm-msg" role="status" aria-live="polite"></span></td>
    </tr>`;
  }

  function render() {
    recompute();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const arrow = (k) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const table = document.getElementById('crmTable');
    table.innerHTML =
      `<thead><tr>${COLUMNS.map((c) => `<th${c.sort ? ` class="sortable" data-k="${c.key}" aria-sort="${sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead>` +
      `<tbody>${slice.map(rowHtml).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty">No practices match your search or filter.</td></tr>`}</tbody>`;

    table.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        sort = sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
        page = 0;
        render();
      };
    });
    const byId = new Map(slice.map((p) => [p.id, p]));
    table.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const p = byId.get(tr.dataset.id);
      // Rows are not re-sorted/re-filtered after an edit (that would make them jump
      // under the cursor); the change is applied on the next sort, filter or page change.
      crmBind(tr, p, () => { tr.querySelector('.agslot').innerHTML = badge(p); });
    });

    document.getElementById('tableCount').textContent = `${rows.length.toLocaleString()} practice${rows.length === 1 ? '' : 's'}`;
    document.getElementById('tablePage').textContent = `Page ${page + 1} of ${pages}`;
    document.getElementById('tablePrev').disabled = page === 0;
    document.getElementById('tableNext').disabled = page >= pages - 1;
  }

  window.MF_tableRefresh = function () { if (document.getElementById('tablePage').textContent) render(); };

  window.MF_initTableView = function () {
    state.ready.then(() => {
      let timer;
      const search = document.getElementById('tableSearch');
      search.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { q = search.value.trim().toLowerCase(); page = 0; render(); }, 150);
      };
      document.getElementById('tableStatus').onchange = (e) => { statusFilter = e.target.value; page = 0; render(); };
      document.getElementById('tablePrev').onclick = () => { page--; render(); };
      document.getElementById('tableNext').onclick = () => { page++; render(); };
      render();
    });
  };
})();
