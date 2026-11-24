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

  // ---- Outreach CRM widget (shared by map popup and grid cards) -------
  const ONBOARDED_BADGE_LABEL = 'AG';
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const STATUS_FIELDS = [
    ['contacted', 'Contacted'],
    ['meeting_set', 'Meeting set up'],
    ['onboarded', 'Onboarded'],
  ];

  async function patchStatus(p, body) {
    const r = await fetch('/api/practices/' + encodeURIComponent(p.id) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Save failed (' + r.status + ')');
    for (const k of ['website', 'contacted', 'meeting_set', 'onboarded']) p[k] = d[k];
  }

  function websiteHtml(p) {
    const u = safeUrl(p.website);
    return u
      ? `<a class="site" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''))}</a> <button type="button" class="linkbtn" data-act="edit-site">edit</button>`
      : `<button type="button" class="linkbtn" data-act="edit-site">+ Add website</button>`;
  }

  function crmHtml(p) {
    return `<div class="crm">
      <div class="crm-site">${websiteHtml(p)}</div>
      <div class="crm-toggles">${STATUS_FIELDS.map(
        ([k, label]) => `<label><input type="checkbox" data-f="${k}"${p[k] ? ' checked' : ''}> ${label}</label>`
      ).join('')}</div>
      <div class="crm-msg" role="status" aria-live="polite"></div>
    </div>`;
  }

  // Wire a container holding crmHtml(p). onChange(p) runs after every successful save.
  function crmBind(root, p, onChange) {
    const msg = root.querySelector('.crm-msg');
    let timer;
    const say = (text, err) => {
      clearTimeout(timer);
      msg.textContent = text;
      msg.className = 'crm-msg' + (err ? ' err' : text ? ' ok' : '');
      if (!err && text) timer = setTimeout(() => (msg.textContent = ''), 1500);
    };
    const save = async (body) => {
      say('Saving…');
      try {
        await patchStatus(p, body);
        say('\u2713 Saved');
        if (onChange) onChange(p);
        return true;
      } catch (e) {
        say(e.message, true);
        return false;
      }
    };
    root.querySelectorAll('input[data-f]').forEach((box) => {
      box.onchange = async () => {
        const f = box.dataset.f;
        if (!(await save({ [f]: box.checked }))) box.checked = !box.checked;
      };
    });
    const siteBox = root.querySelector('.crm-site');
    const wire = () => {
      const btn = siteBox.querySelector('[data-act="edit-site"]');
      if (!btn) return;
      btn.onclick = () => {
        siteBox.innerHTML = `<form class="siteform"><input type="text" inputmode="url" placeholder="example.com" aria-label="Website" value="${esc(p.website || '')}"><button class="btn" type="submit">Save</button></form>`;
        const form = siteBox.querySelector('form');
        form.querySelector('input').focus();
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (await save({ website: form.querySelector('input').value })) { siteBox.innerHTML = websiteHtml(p); wire(); }
        };
      };
    };
    wire();
  }

  window.MF = { TYPES, COL, LBL, esc, slug, mi, state, visible, ONBOARDED_BADGE_LABEL, crmHtml, crmBind };
})();
