'use client';
import { useEffect, useRef, useState } from 'react';
import { fileUrl } from '../../lib/client/api.js';
import { IcArchive, IcCheck, IcPen, IcPlay, IcX } from '../icons.js';

// A brand file's text, refetched when its version changes; null until it arrives.
export function useFileText(ws, brand, p, v) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!p) return undefined;
    let dead = false;
    fetch(fileUrl(ws, brand, p, v), { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '')
      .then((t) => { if (!dead) setText(t); });
    return () => { dead = true; };
  }, [ws, brand, p, v]);
  return text;
}

export const Dot = ({ state, title }) => <span className="dot" data-state={state} title={title} role={title ? 'img' : undefined} aria-label={title} />;

// Fetched on first open.
export function TextDisclosure({ ws, brand, label, file }) {
  const [open, setOpen] = useState(false);
  const text = useFileText(ws, brand, open ? file.p : null, file.v);
  return (
    <details className="disclosure" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <div className="disclosure__body">{text ?? 'Loading'}</div>
    </details>
  );
}

// A comment field: Enter sends its text (onSend, when there is any) and closes it, Shift+Enter is a line break, Esc
// closes it; with sendOnBlur, leaving it sends too. ref reaches the textarea; other props go to its box.
export function Compose({ value, onChange, onSend, onClose, sendOnBlur, placeholder, ref, className = '', ...rest }) {
  const send = () => { if (value.trim()) onSend(value.trim()); onClose(); };
  return (
    <div className={`ed__compose ${className}`.trim()} {...rest}>
      <textarea
        ref={ref} autoFocus rows={2} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={sendOnBlur ? send : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
    </div>
  );
}

const STAGE = { open: ['todo', 'Waiting'], seen: ['current', 'Working on it'], done: ['done', 'Ready to review'], approved: ['done', 'Approved'] };
const ORDER = { done: 0, seen: 1, open: 1 };

// The comments not yet approved, ready to review first: the list's order.
export const openComments = (comments) => comments.filter((n) => n.status !== 'approved').sort((a, b) => (ORDER[a.status] ?? 1) - (ORDER[b.status] ?? 1));

// Each comment's number, 1 for the first one left; approved comments keep theirs, so a number never moves.
export const commentNumbers = (comments) => new Map([...comments].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((n, i) => [n.id, i + 1]));

// Comments as a thread: each round's comment (the user, right) and the agent's reply (left), oldest first; a comment sent back
// keeps its earlier rounds in history.
export const chat = (comments) => comments.flatMap((n) => [...(n.history || []), n].flatMap((r, i) => [
  { key: `${n.id}-${i}`, you: true, body: r.text },
  ...(r.reply ? [{ key: `${n.id}-${i}r`, body: r.reply }] : []),
]));

// Messages in a thread, with action (e.g. a Comment button) beside the latest.
export const Messages = ({ msgs, action }) => msgs.map((m, i) => (
  <div key={m.key} className="ft-say" data-you={m.you || undefined}>
    <div className={`ft-msg ft-msg--${m.you ? 'you' : 'ai'}`}>{m.body}</div>
    {i === msgs.length - 1 && action}
  </div>
));

// The comments on a video or a brief: open ones (ready to review first), or with the archive button the approved ones
// (newest first). lead(n) shows what a comment is on (its number and moment, or the text it quotes); onReview (optional)
// plays a done one's change; lit (an id, or a list) highlights the comments pointed at elsewhere and scrolls to the
// first, onLit(id | null) tells which one the pointer is on; footer goes under the list (the add-a-comment field).
export function Comments({ comments, focus, lit, onLit, onPick, onReview, onAction, lead, hint, footer }) {
  const [showArchived, setShowArchived] = useState(false);
  const archived = comments.filter((n) => n.status === 'approved').reverse();
  const open = openComments(comments);
  const ready = open.filter((n) => n.status === 'done');
  const list = showArchived ? archived : open;
  const approveAll = !showArchived && ready.length > 1;
  const lits = [lit].flat(), box = useRef(null);
  const jump = list.find((n) => lits.includes(n.id))?.id;
  useEffect(() => { box.current.querySelector(`[data-id="${jump}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [lit]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="ed__comments" ref={box}>
      <div className="ed__comments-head">
        <span className="ed__count">{list.length} {showArchived ? 'archived' : list.length === 1 ? 'comment' : 'comments'}</span>
        <div className="spacer" />
        {approveAll && (
          <button type="button" className="ed__history" onClick={() => ready.forEach((n) => onAction({ approve: n.id }))}>Approve all</button>
        )}
        <button
          type="button" className="ed__history" aria-pressed={showArchived} onClick={() => setShowArchived(!showArchived)}
          title="Archived comments" aria-label="Show archived comments"
        ><IcArchive /></button>
      </div>
      {!list.length && (showArchived || hint) && <p className="flow-note">{showArchived ? 'Approved comments land here.' : hint}</p>}
      {list.length > 0 && (
        <ul>
          {list.map((n) => (
            <Comment key={n.id} n={n} focused={n.id === focus} lit={lits.includes(n.id)} onLit={onLit} onPick={onPick} onReview={onReview} onAction={onAction} lead={lead} />
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}

// One comment as a card: what it's on and its stage, the thread, then what the user can do at that stage. A comment ready
// to review gets Approve, Watch change and Send back (with what's still off); the rest only Edit (while waiting) and
// Delete, on hover.
function Comment({ n, focused, lit, onLit, onPick, onReview, onAction, lead }) {
  const [state, label] = STAGE[n.status] || STAGE.open;
  const [say, setSay] = useState(null); // what's still off, being written
  const [edit, setEdit] = useState(null); // the comment's text, being edited
  const pick = (e) => { if (!e.target.closest('button, textarea')) onPick(n); };
  return (
    <li
      className="ed-comment" data-id={n.id} data-status={n.status} data-lit={lit || undefined} aria-current={focused || undefined} onClick={pick}
      onPointerEnter={onLit && (() => onLit(n.id))} onPointerLeave={onLit && (() => onLit(null))}
    >
      <div className="ed-comment__head">
        <button type="button" className="ed-comment__lead" onClick={() => onPick(n)}>{lead(n)}</button>
        <span className="ed-comment__stage"><Dot state={state} />{label}</span>
        {n.status !== 'approved' && (
          <span className="ed-comment__more">
            {n.status === 'open' && !n.edit && edit == null && (
              <button type="button" className="ed-comment__act" title="Edit" aria-label="Edit comment" onClick={() => setEdit(n.text)}><IcPen /></button>
            )}
            <button type="button" className="ed-comment__act" title="Delete" aria-label="Delete comment" onClick={() => onAction({ remove: n.id })}><IcX /></button>
          </span>
        )}
      </div>
      {edit != null
        ? <Compose className="ft-compose" value={edit} onChange={setEdit} onSend={(text) => onAction({ comment: { ...n, text } })} onClose={() => setEdit(null)} />
        : (
          <div className="ft-thread">
            <Messages msgs={chat([n])} />
            {say != null && (
              <div className="ft-say" data-you>
                <Compose className="ft-compose--bubble" placeholder="What's still off?" value={say} onChange={setSay} onSend={(text) => onAction({ sendBack: { id: n.id, text } })} onClose={() => setSay(null)} />
              </div>
            )}
          </div>
        )}
      {n.status === 'done' && say == null && (
        <div className="ed-comment__acts">
          <button type="button" className="btn btn--mini btn--primary" onClick={() => onAction({ approve: n.id })}><IcCheck />Approve</button>
          {onReview && <button type="button" className="btn btn--mini" onClick={() => onReview(n)}><IcPlay />Watch change</button>}
          <button type="button" className="btn btn--mini" onClick={() => setSay('')}>Send back</button>
        </div>
      )}
    </li>
  );
}
