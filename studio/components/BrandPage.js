'use client';
// Shared brand-page pieces: the page list, the page frame (rail and top bar) and its filters, side-panel rows, and the
// load-error block.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandUrl } from '../lib/client/api.js';
import { words } from '../lib/client/format.js';
import { IcAds, IcFlow, IcImage, IcSort, IcSwipe } from './icons.js';
import Switcher from './Switcher.js';

// URL segment → label; the first is the default.
export const TABS = { board: 'Board', media: 'Media', swipe: 'Swipe', workflow: 'Workflow' };
const TAB_ICONS = { board: IcAds, media: IcImage, swipe: IcSwipe, workflow: IcFlow };
export const tabOr = (t) => (Object.hasOwn(TABS, t || '') ? t : 'board');

// Ad statuses in workflow order (stored values: tools/record-ad.mjs) and their labels.
const STATUSES = { 'in-progress': 'In Progress', 'pending-review': 'Pending Review', approved: 'Approved' };
export const statusOf = (rec) => rec?.status || 'in-progress';
export const statusLabel = (s) => STATUSES[s] || words(s);

// A top bar filter or sort: its icon, options [[value, label]], the first the default.
export const BarSelect = ({ label, icon: Icon = IcSort, value, onChange, options }) => (
  <span className="bar-select" title={label}>
    <Icon />
    <select className="select" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  </span>
);
export const SORTS = [['new', 'Newest'], ['old', 'Oldest']];
// Every list's status and format filters, from its items.
export const statusOptions = [['', 'Any status'], ...Object.entries(STATUSES)];
export const formatOptions = (items) => [['', 'Any format'], ...[...new Set(items.filter(Boolean))].sort().map((f) => [f, words(f)])];
// Newest (highest ID) first, or oldest.
export const byId = (sort) => (a, b) => (sort === 'old' ? 1 : -1) * ((a.id || 0) - (b.id || 0));

// A side panel's label / value row; id ties the label to a field in the value.
// icon: a muted icon component before the label.
export const Param = ({ label, id, icon: Icon, className = '', children }) => (
  <div className={`param ${className}`}>
    {label && (id
      ? <label className="eyebrow" htmlFor={id}>{Icon && <Icon />}{label}</label>
      : <span className="eyebrow">{Icon && <Icon />}{label}</span>)}
    <div className="param__v">{children}</div>
  </div>
);

// Cleared by JS, not CSS, so reduced-motion users aren't left with a stuck label.
function UpdatedFlash({ at }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!at) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1900);
    return () => clearTimeout(t);
  }, [at]);
  if (!visible) return null;
  return <span key={at} className="bar__count updated-flash">Updated</span>;
}

// Every brand page's frame: the rail (brand picker, pages as icons) and the page's own bar on top: its count,
// search (centered) and other controls (children, on the right), or `head` in their place (an ad's page).
export function Bars({ ws, brand, current, count, updatedAt, search, children, head }) {
  return (
    <>
      <aside className="rail">
        <Switcher ws={ws} brand={brand} />
        <nav className="rail__nav" aria-label="Pages">
          {Object.entries(TABS).map(([t, label]) => {
            const Icon = TAB_ICONS[t];
            return (
              <Link key={t} className="rail__page" aria-current={current === t ? 'page' : undefined} href={brandUrl(ws, brand, t)} title={label} aria-label={label}>
                <Icon />
              </Link>
            );
          })}
        </nav>
      </aside>
      {head ? <header className="topbar topbar--head">{head}</header> : (
        <header className="topbar">
          <div className="topbar__start"><span className="bar__count">{count}</span><UpdatedFlash at={updatedAt} /></div>
          {search || <span />}
          <div className="topbar__end">{children}</div>
        </header>
      )}
    </>
  );
}

export function LoadError({ what, error, onRetry }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">Could not load {what}.</p>
      <p><code>{error}</code></p>
      <button type="button" className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}
