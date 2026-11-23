// Sidebar: per-state CSV download link and AI market plan modal.
// Independent of the map and grid code; only needs MF.state.
(function () {
  const { esc, state } = window.MF;
  const sel = document.getElementById('exportState');
  const link = document.getElementById('csvLink');
  const btn = document.getElementById('planBtn');
  const modal = document.getElementById('planModal');
  const body = document.getElementById('planBody');

  state.ready.then(() => {
    const states = [...new Set(state.practices.map((p) => p.state))].sort();
    sel.innerHTML = '<option value="all">All states</option>' + states.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  });

  function syncLink() {
    link.href = sel.value === 'all' ? '/api/export.csv' : '/api/export.csv?state=' + encodeURIComponent(sel.value);
  }
  sel.onchange = syncLink;

  // Tiny markdown subset: ## / ### headings, **bold**, - bullets, paragraphs.
  function md(text) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    let html = '', inList = false;
    for (const line of text.split('\n')) {
      const h = line.match(/^#{1,6}\s+(.*)/);
      const li = line.match(/^\s*[-*]\s+(.*)/);
      if (inList && !li) { html += '</ul>'; inList = false; }
      if (h) html += `<h3>${inline(h[1])}</h3>`;
      else if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; }
      else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    return html + (inList ? '</ul>' : '');
  }

  const close = () => { modal.hidden = true; };
  document.getElementById('planClose').onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  btn.onclick = async () => {
    if (sel.value === 'all') {
      body.className = 'plan-body error';
      body.textContent = 'Pick a single state to generate a plan.';
      modal.hidden = false;
      return;
    }
    body.className = 'plan-body';
    body.textContent = `Generating plan for ${sel.value}…`;
    modal.hidden = false;
    btn.disabled = true;
    try {
      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'state', value: sel.value }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Request failed (' + r.status + ')');
      body.innerHTML = md(d.plan);
    } catch (err) {
      body.className = 'plan-body error';
      body.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
})();
