import Pages from '../../../../../components/pages/Pages.js';
import { brandMetadata, brandPage } from '../../../../../lib/server/brands.js';

// The page's path under inputs/ (no .md), or '' for the index.
const pageOf = async (params) => { try { return ((await params).page || []).map(decodeURIComponent).join('/'); } catch { return ''; } };

export const generateMetadata = brandMetadata(async (params) => (await pageOf(params)) || 'Pages');
export default brandPage(Pages, async (params) => ({ page: await pageOf(params) }));
