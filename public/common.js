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

  // ---- Outreach CRM widgets (map popup, grid cards, table rows) -------
  const ONBOARDED_BADGE_LABEL = 'AG';
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const STATUS_FIELDS = [
    ['contacted', 'Contacted'],
    ['meeting_set', 'Meeting set up'],
    ['onboarded', 'Onboarded'],
  ];
  const CRM_KEYS = ['website', 'contacted', 'meeting_set', 'meeting_date', 'meeting_link', 'onboarded'];
  const URL_FIELDS = {
    website: { add: '+ Add website', label: (u) => u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''), placeholder: 'example.com' },
    meeting_link: { add: '+ Add meeting link', label: () => 'Join', placeholder: 'https://zoom.us/j/…' },
  };

  // Bumped on every successful save so other tabs know to refresh stale DOM.
  state.crmVersion = 0;

  // <input type=datetime-local> works in local time without a zone.
  const toLocalInput = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function patchStatus(p, body) {
    const r = await fetch('/api/practices/' + encodeURIComponent(p.id) + '/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Save failed (' + r.status + ')');
    for (const k of CRM_KEYS) p[k] = d[k];
    state.crmVersion++;
  }

  // One editable URL field (website or meeting link): link + edit, or "+ Add".
  function urlHtml(p, field) {
    const cfg = URL_FIELDS[field];
    const u = safeUrl(p[field]);
    return `<span class="urlf" data-u="${field}">${
      u
        ? `<a class="site" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(cfg.label(u))}</a> <button type="button" class="linkbtn" data-act="edit-url">edit</button>`
        : `<button type="button" class="linkbtn" data-act="edit-url">${cfg.add}</button>`
    }</span>`;
  }
  const checkHtml = (p, f, label) => `<label class="chk"><input type="checkbox" data-f="${f}"${p[f] ? ' checked' : ''}${label ? '' : ` aria-label="${f}"`}>${label ? ' ' + label : ''}</label>`;
  const dateHtml = (p) => `<input type="datetime-local" class="mdate" data-d="meeting_date" aria-label="Meeting date" value="${toLocalInput(p.meeting_date)}">`;

  function crmHtml(p) {
    return `<div class="crm">
      <div class="crm-row">Website: ${urlHtml(p, 'website')}</div>
      <div class="crm-toggles">${STATUS_FIELDS.map(([k, label]) => checkHtml(p, k, label)).join('')}</div>
      <div class="crm-row">Meeting: ${dateHtml(p)}</div>
      <div class="crm-row">Link: ${urlHtml(p, 'meeting_link')}</div>
      <div class="crm-msg" role="status" aria-live="polite"></div>
    </div>`;
  }

  // Wire every CRM control inside `root` (needs one .crm-msg). onChange(p) runs after each successful save.
  function crmBind(root, p, onChange) {
    const msg = root.querySelector('.crm-msg');
    let timer;
    const say = (text, err) => {
      clearTimeout(timer);
      msg.textContent = text;
      msg.className = 'crm-msg' + (err ? ' err' : text ? ' ok' : '');
      if (!err && text && text !== 'Saving…') timer = setTimeout(() => (msg.textContent = ''), 1500);
    };
    const save = async (body) => {
      say('Saving…');
      try {
        await patchStatus(p, body);
        say('✓ Saved');
        if (onChange) onChange(p);
        return true;
      } catch (e) {
        say(e.message, true);
        return false;
      }
    };
    // Stages are ordered (contacted -> meeting set -> onboarded); the server enforces it.
    // Earlier stages are shown checked and locked while a later one is on.
    const syncFlags = () => {
      root.querySelectorAll('input[data-f]').forEach((box) => {
        const f = box.dataset.f;
        box.checked = !!p[f];
        box.disabled = (f === 'contacted' && !!(p.meeting_set || p.onboarded)) || (f === 'meeting_set' && !!p.onboarded);
        box.title = box.disabled ? 'Implied by a later stage; turn the later stage off first' : '';
      });
    };
    root.querySelectorAll('input[data-f]').forEach((box) => {
      box.onchange = async () => {
        await save({ [box.dataset.f]: box.checked });
        syncFlags(); // on success shows the cascaded values; on failure reverts the box
      };
    });
    syncFlags();
    root.querySelectorAll('input[data-d]').forEach((inp) => {
      inp.onchange = async () => {
        const body = { meeting_date: inp.value ? new Date(inp.value).toISOString() : null };
        if (!(await save(body))) inp.value = toLocalInput(p.meeting_date);
      };
    });
    root.querySelectorAll('.urlf').forEach((box) => {
      const field = box.dataset.u;
      const wire = () => {
        const btn = box.querySelector('[data-act="edit-url"]');
        if (!btn) return;
        btn.onclick = () => {
          box.innerHTML = `<form class="siteform"><input type="text" inputmode="url" placeholder="${URL_FIELDS[field].placeholder}" aria-label="${field}" value="${esc(p[field] || '')}"><button class="btn" type="submit">Save</button></form>`;
          const form = box.querySelector('form');
          form.querySelector('input').focus();
          form.onsubmit = async (e) => {
            e.preventDefault();
            if (await save({ [field]: form.querySelector('input').value })) {
              box.innerHTML = urlHtml(p, field).replace(/^<span[^>]*>|<\/span>$/g, '');
              wire();
            }
          };
        };
      };
      wire();
    });
  }

  window.MF = { TYPES, COL, LBL, esc, slug, mi, state, visible, ONBOARDED_BADGE_LABEL, crmHtml, crmBind, urlHtml, checkHtml, dateHtml, toLocalInput, patchStatus, safeUrl };
})();
