// The brand's pages (lib/server/pages.js): the list (no ?p), or one page's text (?p=<path under inputs/, no .md>).
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { listPages, readPage } from '../../../../../lib/server/pages.js';

export const GET = brandRoute((req, ctx) => {
  const p = new URL(req.url).searchParams.get('p');
  if (p == null) return jsonRes({ pages: listPages(ctx.dir) });
  const page = readPage(ctx.dir, p);
  return page ? jsonRes(page) : jsonRes({ error: 'no such page' }, 404);
});
