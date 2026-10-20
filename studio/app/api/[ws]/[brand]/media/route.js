import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { mediaRecords, swipedBy } from '../../../../../lib/server/media.js';

export const GET = brandRoute(async (req, ctx) => jsonRes({ records: await mediaRecords(ctx.dir), swipedBy: await swipedBy(ctx.dir) }));
