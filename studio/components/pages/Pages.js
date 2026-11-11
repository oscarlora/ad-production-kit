'use client';
// The Pages page: the brand's research and sources (.md under inputs/, lib/server/pages.js), as an index (no `page`),
// or one page with every page in a sidebar beside it, edited in blocks like an ad's brief (MdEditor). Live.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { openFile, pageUrl } from '../../lib/client/api.js';
import { when } from '../../lib/client/format.js';
import { useBrandData, useDragWidth } from '../../lib/client/hooks.js';
import { Bars, LoadError } from '../BrandPage.js';
import { IcOpen } from '../icons.js';
import MdEditor from '../workflow/MdEditor.js';

// [[group, pages]] in list order, pages matching the search only.
function useGroups(pages, q) {
  return useMemo(() => {
    const needle = q.trim().toLowerCase(), groups = new Map();
    for (const pg of pages) {
      if (needle && !`${pg.title} ${pg.p}`.toLowerCase().includes(needle)) continue;
      groups.set(pg.group, [...(groups.get(pg.group) || []), pg]);
    }
    return [...groups];
  }, [pages, q]);
}

const isSources = (group) => group.startsWith('Sources');

function Index({ ws, brand, groups }) {
  return (
    <div className="pages-index">
      {groups.map(([group, list]) => (
        <section key={group}>
          <h2 className="eyebrow">{group}</h2>
          <ul>
            {list.map((pg) => (
              <li key={pg.p}>
                <Link className="pages-row" href={pageUrl(ws, brand, pg.p)}>
                  <span className="pages-row__title">{pg.title}</span>
                  <span className="pages-row__path">{pg.p}.md</span>
                  <span className="pages-row__when">{when(new Date(pg.mtime).toISOString())}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// The sidebar beside the open page; drag the line between them to resize it.
function Reader({ ws, brand, groups, page }) {
  const [width, dragging, line] = useDragWidth('ad-production-kit-studio:pages-nav-width', 256,
    (e) => Math.min(Math.max(e.clientX - e.currentTarget.parentElement.getBoundingClientRect().left, 160), 520));
  return (
    <div className="pages-read" data-dragging={dragging || undefined} style={{ '--nav-w': `${width}px` }}>
      <Sidebar ws={ws} brand={brand} groups={groups} current={page} />
      <div className="split__line" {...line} />
      <Doc ws={ws} brand={brand} page={page} />
    </div>
  );
}

// Every page, grouped; Sources folders start closed unless the open page is in them.
function Sidebar({ ws, brand, groups, current }) {
  return (
    <nav className="pages-nav" aria-label="Pages">
      {groups.map(([group, list]) => (
        <details key={group} className="pages-nav__group" open={!isSources(group) || list.some((pg) => pg.p === current)}>
          <summary className="eyebrow">{group}</summary>
          {list.map((pg) => (
            <Link key={pg.p} className="pages-nav__item" href={pageUrl(ws, brand, pg.p)} title={`${pg.p}.md`} aria-current={pg.p === current ? 'page' : undefined}>
              {pg.title}
            </Link>
          ))}
        </details>
      ))}
    </nav>
  );
}

function Doc({ ws, brand, page }) {
  const { data, error, load } = useBrandData(ws, brand, `pages?p=${encodeURIComponent(page)}`);
  if (error) return <LoadError what="this page" error={error} onRetry={load} />;
  if (!data) return null;
  return (
    <article className="pages-doc">
      <div className="pages-doc__meta eyebrow">
        <span>{data.file.p}</span>
        <span>Updated {when(new Date(data.mtime).toISOString())}</span>
        <button type="button" className="btn btn--mini" onClick={() => openFile(ws, brand, data.file.p)} title="Open the file in its app"><IcOpen /> Open file</button>
      </div>
      <MdEditor key={data.p} ws={ws} brand={brand} file={data.file} comments={data.comments} />
    </article>
  );
}

export default function Pages({ ws, brand, page }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, 'pages');
  const pages = useMemo(() => data?.pages || [], [data]);
  const [q, setQ] = useState('');
  const groups = useGroups(pages, q);
  const shown = groups.reduce((n, [, list]) => n + list.length, 0);
  return (
    <div>
      <Bars
        ws={ws} brand={brand} current="pages" count={data ? `${shown} of ${pages.length} pages` : 'Loading'} updatedAt={updatedAt}
        search={<input className="input bar__search" placeholder="Search pages" aria-label="Search page titles and files" value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      {error && <LoadError what="pages" error={error} onRetry={load} />}
      {!error && data && pages.length === 0 && <div className="empty-state">No .md files in <code>inputs/</code> yet.</div>}
      {!error && data && pages.length > 0 && (page
        ? <Reader ws={ws} brand={brand} groups={groups} page={page} />
        : shown ? <Index ws={ws} brand={brand} groups={groups} /> : <div className="empty-state">No pages match.</div>)}
    </div>
  );
}
