'use client';
// The Footage step (review-ugc-footage's footage.json): one row per scene of the brief with the delivered clip and a
// checklist of cards, each what was asked (the line, the action, …) over a chat thread: the AI's short verdict, then
// the user's comments and the agent's replies. Passed checks come ticked and an all-pass scene approved; the user ticks
// checks (all ticked approves the scene) or calls it (Approve ticks all; Reshoot with what to change).
import { useEffect, useState } from 'react';
import { editApi, fileUrl } from '../../lib/client/api.js';
import { IcAlert, IcCheck, IcX } from '../icons.js';
import Player from '../Player.js';
import { Inline } from './Markdown.js';
import { chat, Compose, Dot, Messages } from './parts.js';

const FILE = 'footage.json';
const optional = (row) => /\(optional\)/i.test(`${row.line} ${row.action}`);
const missing = (row) => (optional(row) ? { ok: false, note: 'Optional; not delivered.' } : { ok: false, reshoot: true, note: 'Not delivered yet.' });

// The AI's result: passed, the edit fixes it, or needs a reshoot.
const RESULT = { ok: [IcCheck, 'Passed'], fix: [IcAlert, 'The edit fixes it'], reshoot: [IcX, 'Needs a reshoot'] };

// One check as a card: the user's tick beside what was asked, then its thread.
function Check({ asked, ticked, onTick, ai, okText, comments, onComment }) {
  const [Icon, title] = RESULT[ai.ok ? 'ok' : ai.reshoot ? 'reshoot' : 'fix'];
  const [comment, setComment] = useState(null); // the comment being written
  return (
    <div className="ft-check">
      <div className="ft-check__asked">
        <button type="button" className="check" aria-pressed={ticked} aria-label="Checked" onClick={onTick} disabled={!onTick} />
        <div>{asked}</div>
      </div>
      <div className="ft-thread">
        <Messages
          msgs={[{ key: 'ai', body: <><span className="ft-result__icon" title={title} aria-label={title} role="img"><Icon /></span><span><Inline text={ai.note || (ai.ok ? okText : title)} /></span></> }, ...chat(comments)]}
          action={comment == null && <button type="button" className="ft-reply" onClick={() => setComment('')}>Comment</button>} />
        {comment != null && <Compose className="ft-compose" sendOnBlur placeholder="Comment for the agent" value={comment} onChange={setComment} onSend={onComment} onClose={() => setComment(null)} />}
      </div>
    </div>
  );
}

function Scene({ ws, brand, row, comments, onComment, onDecide }) {
  const [reason, setReason] = useState(null); // a reshoot's reason being written
  const [call, setCall] = useState(row.decision);
  const [ticked, setTicked] = useState(row.checked);
  useEffect(() => setCall(row.decision), [row.decision]);
  useEffect(() => setTicked(row.checked), [row.checked.join()]);
  // A scene with no clip still lists what it asks for, each check unticked and marked not delivered.
  const none = !row.clip && missing(row);
  const c = row.clip ? row.checks : { line: none, action: none, framing: none, audio: row.line ? none : null };
  const checks = [
    row.line && { key: 'line', asked: <span className="ft-line">“<Inline text={row.line} />”</span>, okText: 'Said as written.' },
    row.action && { key: 'action', asked: <Inline text={row.action} />, okText: 'Done as asked.' },
    { key: 'framing', asked: 'Face and product inside the 4:5 crop, above the Reels buttons; label readable.', okText: 'In the safe area.' },
    { key: 'audio', asked: 'Clear voice, easy to understand.', okText: 'Clear.' },
    c.file && { key: 'file', asked: `File named “${row.scene}”.`, okText: 'Named right.' },
  ].filter((x) => x && c[x.key]);
  const keys = checks.map((x) => x.key);
  // Saves ticks; ticking the last one approves the scene (and says so to the agent).
  const send = (ticks, decision, text) => {
    const next = keys.filter((k) => (k in ticks ? ticks[k] : ticked.includes(k)));
    setTicked(next);
    setCall(decision === 'reshoot' || (decision === undefined && call === 'reshoot') ? 'reshoot' : next.length === keys.length ? 'approved' : '');
    onDecide(row.scene, { ticks, ...(decision !== undefined && { decision }), ...(text && { text }) });
  };
  const tick = (k) => {
    const on = !ticked.includes(k), done = keys.every((x) => (x === k ? on : ticked.includes(x)));
    send({ [k]: on }, done && call !== 'approved' ? 'approved' : undefined);
  };
  const all = (on) => Object.fromEntries(keys.map((k) => [k, on]));
  const general = comments.filter((n) => !n.check);
  return (
    <article className="ft-row">
      <div className="ft-clip">
        {row.clip ? (
          <Player src={fileUrl(ws, brand, row.clip.p, row.clip.v, 720)} label={row.scene} />
        ) : <div className="ft-clip__empty">No clip</div>}
      </div>
      <div className="ft-body">
        <div className="ft-head">
          {call && <Dot state={call === 'approved' ? 'done' : 'warn'} title={call === 'approved' ? 'Approved' : 'Reshoot'} />}
          <span className="ft-scene">{row.scene}</span>
          <span className="ft-file">{ticked.length}/{keys.length}</span>
        </div>
        <div className="ft-checks">
          {checks.map((x) => (
            <Check key={x.key} asked={x.asked} ai={c[x.key]} okText={x.okText} ticked={ticked.includes(x.key)} onTick={row.clip ? () => tick(x.key) : undefined}
              comments={comments.filter((n) => n.check === x.key)} onComment={(text) => onComment({ quote: row.scene, check: x.key, text })} />
          ))}
        </div>
        {row.clip && (
          <div className="ft-actions">
            <button type="button" className="btn btn--mini" aria-pressed={call === 'approved'}
              onClick={() => (call === 'approved' ? send(all(false)) : send(all(true), 'approved'))}><IcCheck />{call === 'approved' ? 'Approved' : 'Approve'}</button>
            {call !== 'approved' && (
              <button type="button" className="btn btn--mini" aria-pressed={call === 'reshoot'}
                onClick={() => (call === 'reshoot' ? send({}, null) : setReason(''))}><IcX />Reshoot</button>
            )}
          </div>
        )}
        {general.length > 0 && <div className="ft-thread ft-thread--scene"><Messages msgs={chat(general)} /></div>}
        {reason != null && <Compose className="ft-compose" sendOnBlur placeholder="What should the reshoot change? (optional)" value={reason} onChange={setReason} onSend={(text) => send({}, 'reshoot', text)} onClose={() => setReason(null)} />}
      </div>
    </article>
  );
}

const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);

// The verdict as a checklist: clips delivered against the brief, what the AI flags, what the user approved.
function Verdict({ rows }) {
  const asked = rows.filter((r) => !r.extra), clips = rows.filter((r) => r.clip);
  const absent = asked.filter((r) => !r.clip), missing = absent.filter((r) => !optional(r)).map((r) => r.scene);
  const skipped = absent.filter(optional).map((r) => r.scene), extra = rows.filter((r) => r.extra).map((r) => r.scene);
  const failed = (r) => Object.values(r.checks).filter((c) => c && !c.ok);
  const reshoot = clips.filter((r) => failed(r).some((c) => c.reshoot)).map((r) => r.scene);
  const fixable = clips.filter((r) => !reshoot.includes(r.scene) && failed(r).length).map((r) => r.scene);
  const approved = clips.filter((r) => r.decision === 'approved').length, rejected = clips.filter((r) => r.decision === 'reshoot').map((r) => r.scene);
  const items = [
    missing.length ? ['reshoot', `${asked.length - absent.length} of ${asked.length} clips delivered; ${list(missing)} ${missing.length > 1 ? 'are' : 'is'} missing.`] : ['ok', skipped.length ? `All ${asked.length - skipped.length} required clips delivered.` : `All ${asked.length} clips delivered.`],
    skipped.length && ['fix', `${list(skipped)} ${skipped.length > 1 ? 'were' : 'was'} optional and not delivered.`],
    extra.length && ['fix', `${list(extra)} ${extra.length > 1 ? 'aren’t' : 'isn’t'} in the brief.`],
    reshoot.length ? ['reshoot', `The AI says ${list(reshoot)} ${reshoot.length > 1 ? 'need' : 'needs'} a reshoot.`] : ['ok', 'The AI found nothing that needs a reshoot.'],
    fixable.length && ['fix', `The edit can fix ${list(fixable)}.`],
    rejected.length ? ['reshoot', `You sent ${list(rejected)} back for a reshoot.`]
      : approved === clips.length && clips.length ? ['ok', `You approved all ${clips.length} clips.`] : ['fix', `You approved ${approved} of ${clips.length} clips so far.`],
  ].filter(Boolean);
  return (
    <div className="ft-callout">
      <div className="eyebrow">AI analysis verdict</div>
      {items.map(([state, text]) => {
        const [Icon] = RESULT[state];
        return <p key={text} className="ft-callout__item"><Icon />{text}</p>;
      })}
    </div>
  );
}

export default function Footage({ ws, brand, ad, footage, comments }) {
  // "Approved" comments only tell the agent; a reshoot's reason shows under its scene.
  const mine = comments.filter((n) => n.file === FILE && !/^Approved$/.test(n.text));
  const api = (body) => editApi(ws, brand, ad)(body).catch(() => {});
  return (
    <>
      <Verdict rows={footage.rows} />
      <div className="ft-rows">
        {footage.rows.map((r) => (
          <Scene key={r.scene} ws={ws} brand={brand} row={r} comments={mine.filter((n) => n.quote === r.scene)}
            onComment={(comment) => api({ comment: { file: FILE, ...comment } })}
            onDecide={(scene, review) => api({ decide: { scene, ...review } })} />
        ))}
      </div>
    </>
  );
}
