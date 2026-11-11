// Google Fonts' families, most used first (the editor's font picker). Read once from Google's catalog, then kept.
import { jsonRes } from '../../../lib/server/http.js';

let fonts = null;

export async function GET() {
  try {
    if (!fonts) {
      const text = await (await fetch('https://fonts.google.com/metadata/fonts')).text();
      fonts = JSON.parse(text.slice(text.indexOf('{'))).familyMetadataList.sort((a, b) => a.popularity - b.popularity).map((f) => f.family);
    }
    return jsonRes({ fonts });
  } catch (e) { return jsonRes({ error: String(e?.message || e) }, 502); }
}
