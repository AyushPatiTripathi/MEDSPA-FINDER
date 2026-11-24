// Pipeline stages are ordered: contacted -> meeting_set -> onboarded.
// Turning a stage on turns every earlier stage on; turning one off turns every later stage off.
const ORDER = ['contacted', 'meeting_set', 'onboarded'];

// existing: current flags (all booleans); body: the request's (already type-checked) flags.
// Returns { flags } or { error }. Applied to the MERGED row, so {contacted:false}
// clears an existing onboarded:true as well.
function cascade(existing, body) {
  for (let i = 0; i < ORDER.length; i++) {
    for (let j = i + 1; j < ORDER.length; j++) {
      if (body[ORDER[i]] === false && body[ORDER[j]] === true) {
        return { error: `Contradictory request: ${ORDER[j]} cannot be true while ${ORDER[i]} is false` };
      }
    }
  }
  const m = {};
  ORDER.forEach((k) => (m[k] = k in body ? body[k] : !!existing[k]));
  ORDER.forEach((k, i) => {
    if (body[k] === true) for (let j = 0; j <= i; j++) m[ORDER[j]] = true;
    if (body[k] === false) for (let j = i; j < ORDER.length; j++) m[ORDER[j]] = false;
  });
  // Repair any stale invalid row the request didn't touch: highest stage wins.
  let later = false;
  for (let i = ORDER.length - 1; i >= 0; i--) {
    if (m[ORDER[i]]) later = true;
    else if (later) m[ORDER[i]] = true;
  }
  return { flags: m };
}

module.exports = { cascade, ORDER };
