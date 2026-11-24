// Pipeline tab: Kanban board (default) + sortable list view over the same
// filtered dataset. Cards drag between stages (native HTML5 DnD); clicking a
// card opens the same CRM widget used in the map popup and grid cards.
(function () {
  const { COL, LBL, esc, state, ONBOARDED_BADGE_LABEL, crmHtml, crmBind, urlHtml, checkHtml, dateHtml, patchStatus, safeUrl } = window.MF;

  // Each stage sets every flag up to that point, so a card is never "onboarded" but not "contacted".
  const STAGES = [
    { key: 'not_contacted', label: 'Not Contacted', body: { contacted: false, meeting_set: false, onboarded: false } },
    { key: 'contacted', label: 'Contacted', body: { contacted: true, meeting_set: false, onboarded: false } },
    { key: 'meeting_set', label: 'Meeting Set', body: { contacted: true, meeting_set: true, onboarded: false } },
    { key: 'onboarded', label: 'Onboarded', body: { contacted: true, meeting_set: true, onboarded: true } },
  ];
  const CARD_STEP = 40; // cards rendered per column before "Show more"
  const PAGE_SIZE = 50; // list view rows per page

  let view = 'board';
  let q = '';
  let metro = '';
  let sort = { key: 'meeting_date', dir: 'asc' }; // list view
  let page = 0;
  const colLimit = STAGES.map(() => CARD_STEP);
  const pending = new Map(); // practice id -> stage index while a drop is saving
  let flashId = null;
  let filtered = [];
  let dragId = null;
  let ready = false;

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s || '').toLowerCase();
  const time = (p) => (p.meeting_date ? new Date(p.meeting_date).getTime() : null);
  const derivedStage = (p) => (p.onboarded ? 3 : p.meeting_set ? 2 : p.contacted ? 1 : 0);
  const stageOf = (p) => (pending.has(p.id) ? pending.get(p.id) : derivedStage(p));

  // ------------------------------------------------------------- sorting
  // Meeting date: upcoming soonest first, then past (most recent first), undated last.
  function byMeeting(a, b, dir) {
    const ta = time(a), tb = time(b);
    if (ta === null || tb === null) return ta === tb ? 0 : ta === null ? 1 : -1;
    if (dir === 'desc') return tb - ta;
    const now = Date.now();
    const fa = ta >= now, fb = tb >= now;
    return fa !== fb ? (fa ? -1 : 1) : fa ? ta - tb : tb - ta;
  }
  const byName = (a, b) => norm(a.name).localeCompare(norm(b.name));

  function compare(a, b) {
    const { key, dir } = sort;
    const m = dir === 'asc' ? 1 : -1;
    let c = 0;
    if (key === 'meeting_date') {
      c = byMeeting(a, b, dir);
      return c || byName(a, b);
    }
    if (['contacted', 'meeting_set', 'onboarded'].includes(key)) c = ((b[key] ? 1 : 0) - (a[key] ? 1 : 0)) * m;
    else c = norm(a[key]).localeCompare(norm(b[key])) * m;
    return c || byName(a, b);
  }

  // ------------------------------------------------------------- filtering
  function recompute() {
    filtered = state.practices.filter(
      (p) => (!metro || p.metro === metro) && (!q || norm(p.name).includes(q) || norm(p.city).includes(q))
    );
  }

  function renderStats() {
    const n = (f) => filtered.filter(f).length;
    const items = [
      [filtered.length, 'practices'],
      [n((p) => p.contacted), 'contacted'],
      [n((p) => p.meeting_set), 'meetings set'],
      [n((p) => p.onboarded), 'onboarded'],
    ];
    $('pipeStats').innerHTML = items.map(([v, l]) => `<div class="pstat"><b>${v.toLocaleString()}</b><span>${l}</span></div>`).join('');
  }

  // ------------------------------------------------------------- board
  const fmtMeeting = (p) =>
    p.meeting_date ? new Date(p.meeting_date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date TBD';

  function cardHtml(p) {
    const site = safeUrl(p.website);
    const link = safeUrl(p.meeting_link);
    const hasMeeting = p.meeting_set || p.meeting_date;
    const chip = hasMeeting
      ? link
        ? `<a class="mchip" href="${esc(link)}" target="_blank" rel="noopener noreferrer" title="Open meeting link">&#128197; ${esc(fmtMeeting(p))}</a>`
        : `<span class="mchip">&#128197; ${esc(fmtMeeting(p))}</span>`
      : '';
    return `<article class="kcard${pending.has(p.id) ? ' saving' : ''}${flashId === p.id ? ' flash' : ''}" draggable="true" data-id="${esc(p.id)}" tabindex="0">
      <div class="ktop"><i class="kdot" style="background:${COL[p.type]}" title="${esc(LBL[p.type] || p.type)}"></i><b class="kname">${esc(p.name)}</b>${p.onboarded ? `<span class="agBadge">${esc(ONBOARDED_BADGE_LABEL)}</span>` : ''}</div>
      <div class="kmeta">${esc(p.city)}, ${esc(p.state)}${site ? ` <a class="ksite" href="${esc(site)}" target="_blank" rel="noopener noreferrer" title="${esc(site)}" aria-label="Website">&#8599;</a>` : ''}</div>
      ${chip ? `<div class="kchips">${chip}</div>` : ''}
    </article>`;
  }

  function renderBoard() {
    const cols = STAGES.map(() => []);
    for (const p of filtered) cols[stageOf(p)].push(p);
    cols.forEach((list, i) => list.sort(i >= 2 ? (a, b) => byMeeting(a, b, 'asc') || byName(a, b) : byName));
    $('pipeBoard').innerHTML = STAGES.map((st, i) => {
      const list = cols[i];
      const shown = list.slice(0, colLimit[i]);
      const more = list.length - shown.length;
      return `<section class="kcol" data-stage="${i}" aria-label="${st.label}">
        <header class="khead"><span>${st.label}</span><span class="kcount">${list.length.toLocaleString()}</span></header>
        <div class="kbody">${
          shown.map(cardHtml).join('') || '<div class="kempty">No practices here yet</div>'
        }${more > 0 ? `<button type="button" class="kmore" data-i="${i}">Show ${Math.min(CARD_STEP, more)} more (${more.toLocaleString()} left)</button>` : ''}</div>
      </section>`;
    }).join('');
    wireBoard();
  }

  function wireBoard() {
    const board = $('pipeBoard');
    board.querySelectorAll('.kmore').forEach((b) => (b.onclick = () => { colLimit[+b.dataset.i] += CARD_STEP; renderBoard(); }));
    const byId = new Map(filtered.map((p) => [p.id, p]));
    board.querySelectorAll('.kcard').forEach((el) => {
      const p = byId.get(el.dataset.id);
      el.querySelectorAll('a').forEach((a) => (a.onclick = (e) => e.stopPropagation()));
      el.onclick = () => openPanel(p);
      el.onkeydown = (e) => { if (e.key === 'Enter') openPanel(p); };
      el.ondragstart = (e) => {
        dragId = p.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', p.id);
        setTimeout(() => el.classList.add('dragging'), 0); // after the drag image is captured
        board.classList.add('is-dragging');
      };
      el.ondragend = () => {
        dragId = null;
        el.classList.remove('dragging');
        board.classList.remove('is-dragging');
        board.querySelectorAll('.kcol.over').forEach((c) => c.classList.remove('over'));
      };
    });
    board.querySelectorAll('.kcol').forEach((col) => {
      col.ondragover = (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); };
      col.ondragleave = (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); };
      col.ondrop = (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const p = state.practices.find((x) => x.id === (dragId || e.dataTransfer.getData('text/plain')));
        dragId = null;
        if (p) move(p, +col.dataset.stage);
      };
    });
  }

  let toastTimer;
  function toast(text, err) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), err ? 4500 : 1800);
  }

  async function move(p, idx) {
    if (stageOf(p) === idx) return;
    pending.set(p.id, idx); // optimistic: card jumps now, reverts if the save fails
    refresh();
    try {
      await patchStatus(p, STAGES[idx].body);
      flashId = p.id;
      toast(`Moved to ${STAGES[idx].label}`);
    } catch (e) {
      toast(`Couldn't move "${p.name}": ${e.message}`, true);
    }
    pending.delete(p.id);
    refresh();
    setTimeout(() => { flashId = null; document.querySelectorAll('.kcard.flash').forEach((c) => c.classList.remove('flash')); }, 1300);
  }

  // ------------------------------------------------------------- detail panel
  let panelP = null;
  function openPanel(p) {
    panelP = p;
    const addr = [p.address].filter(Boolean).join('');
    $('pmBody').innerHTML = `<h2 id="pmTitle">${esc(p.name)}</h2>
      <div class="tagline"><span class="dot" style="background:${COL[p.type]}"></span>${esc(LBL[p.type] || p.type)}</div>
      <div class="meta">${p.rating ?? '–'}★ (${(p.reviews || 0).toLocaleString()} reviews)</div>
      <div class="addr">${esc(addr)}</div>
      ${p.phone ? `<a class="phone" href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a>` : ''}
      ${crmHtml(p)}`;
    crmBind($('pmBody'), p, refresh);
    $('practiceModal').hidden = false;
  }
  const closePanel = () => { $('practiceModal').hidden = true; panelP = null; };

  // ------------------------------------------------------------- list view
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
  const badge = (p) => (p.onboarded ? `<span class="agBadge">${esc(ONBOARDED_BADGE_LABEL)}</span>` : '');

  function rowHtml(p) {
    return `<tr data-id="${esc(p.id)}">
      <td class="rname" title="${esc(p.name)}">${esc(p.name)} <span class="agslot">${badge(p)}</span></td>
      <td>${esc(p.metro)}</td><td>${esc(p.city)}</td><td>${esc(p.state)}</td>
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

  function renderList() {
    const rows = [...filtered].sort(compare);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    const slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const arrow = (k) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    const table = $('crmTable');
    table.innerHTML =
      `<thead><tr>${COLUMNS.map((c) => `<th${c.sort ? ` class="sortable" data-k="${c.key}" aria-sort="${sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>${c.label}${arrow(c.key)}</th>`).join('')}</tr></thead>` +
      `<tbody>${slice.map(rowHtml).join('') || `<tr><td colspan="${COLUMNS.length}" class="empty">No practices match your search or filter.</td></tr>`}</tbody>`;
    table.querySelectorAll('th.sortable').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        sort = sort.key === k ? { key: k, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' };
        page = 0;
        renderList();
      };
    });
    const byId = new Map(slice.map((p) => [p.id, p]));
    // Rows aren't re-sorted after an inline edit (they'd jump under the cursor); stats update live.
    table.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const p = byId.get(tr.dataset.id);
      crmBind(tr, p, () => { tr.querySelector('.agslot').innerHTML = badge(p); renderStats(); });
    });
    $('pipePage').textContent = `Page ${page + 1} of ${pages}`;
    $('pipePrev').disabled = page === 0;
    $('pipeNext').disabled = page >= pages - 1;
  }

  // ------------------------------------------------------------- orchestration
  function refresh() {
    if (!ready) return;
    recompute();
    renderStats();
    $('pipeBoard').hidden = view !== 'board';
    $('pipeList').hidden = view !== 'list';
    $('pipePager').hidden = view !== 'list';
    if (view === 'board') renderBoard();
    else renderList();
  }

  function filtersChanged() {
    page = 0;
    colLimit.fill(CARD_STEP);
    refresh();
  }

  window.MF_pipelineRefresh = refresh;

  window.MF_initPipelineView = function () {
    state.ready.then(() => {
      ready = true;
      const metros = [...new Set(state.practices.map((p) => p.metro))].sort();
      $('pipeMetro').innerHTML = '<option value="">All metros</option>' + metros.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      let timer;
      const search = $('pipeSearch');
      search.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { q = search.value.trim().toLowerCase(); filtersChanged(); }, 150);
      };
      $('pipeMetro').onchange = (e) => { metro = e.target.value; filtersChanged(); };
      $('pipePrev').onclick = () => { page--; renderList(); };
      $('pipeNext').onclick = () => { page++; renderList(); };
      document.querySelectorAll('.vtoggle button').forEach((b) => {
        b.onclick = () => {
          view = b.dataset.v;
          document.querySelectorAll('.vtoggle button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          refresh();
        };
      });
      $('pmClose').onclick = closePanel;
      $('practiceModal').onclick = (e) => { if (e.target === $('practiceModal')) closePanel(); };
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelP) closePanel(); });
      refresh();
    });
  };
})();
