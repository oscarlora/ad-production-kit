// Text formatters for the pages.

// Folder and record slugs as words: "Burned-Out-Woman" → "Burned Out Woman".
export const words = (s) => String(s || '').replace(/[-_]+/g, ' ').trim();
// "Piel-De-Bebe" → "Piel de bebe".
export const sentence = (s) => { const c = words(s).toLowerCase(); return c.charAt(0).toUpperCase() + c.slice(1); };
// An ad folder's or file's head (naming: write-prompt): its ID and its creator's initials ("5_OL_"); older names have
// no initials.
export const AD_HEAD = /^\d+_(?:[A-Z]{2,4}_)?/;
// The name after its head ("Piel-De-Bebe_Static_…"); null for a name that isn't an ad's.
export const adRest = (name) => (AD_HEAD.test(name) ? name.replace(AD_HEAD, '') : null);

// A render's name, "5_OL_V8_Piel-De-Bebe_Static_…_Story.png" → { v: 'V8', name: 'Piel de bebe', story: true } (Studio's
// cards and share-ads.mjs); null for other names.
export function renderName(file) {
  const n = String(file).split('/').pop(), m = /^(V\d+)_([^_.]+)/.exec(adRest(n) || '');
  return m && { v: m[1], name: sentence(m[2]), story: /_Story\.\w+$/.test(n) };
}

// An ISO time as a short local date and time; '' when missing or invalid.
export const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(+d) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; };

// Seconds as m:ss, or m:ss.hh with `fine` (the editor); 0:00 when unknown.
export function clock(s, fine = false) {
  const x = Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = Math.floor(x / 60), r = x - m * 60;
  return `${m}:${fine ? (Math.floor(r * 100) / 100).toFixed(2).padStart(5, '0') : String(Math.floor(r)).padStart(2, '0')}`;
}
