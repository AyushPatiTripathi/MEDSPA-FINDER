// Shared URL normalisation for website / meeting-link fields.
// Blank -> { ok: true, value: null }. Adds https:// if no scheme; only http(s) allowed.
function normalizeUrl(input) {
  let w = input === null || input === undefined ? '' : String(input).trim();
  if (!w) return { ok: true, value: null };
  if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
  try {
    const u = new URL(w);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || w.length > 500) return { ok: false };
  } catch (_) {
    return { ok: false };
  }
  return { ok: true, value: w };
}

module.exports = { normalizeUrl };
