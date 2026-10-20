'use client';
// `/app`: Studio and the chat side by side, what the Mac app shows. Drag the line between them to resize the chat;
// window.toggleChat() (the app's ⌘J) hides or shows it.
import { useEffect, useState } from 'react';

const KEY = 'ad-production-kit-studio:chat-width';
const MEDIA = 'fullscreen; clipboard-read; clipboard-write; autoplay';

export default function Split() {
  const [width, setWidth] = useState(420);
  const [shown, setShown] = useState(true);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try { const w = Number(localStorage.getItem(KEY)); if (w) setWidth(w); } catch {}
    window.toggleChat = () => setShown((v) => !v);
  }, []);

  const drag = (e) => {
    if (!dragging) return;
    setWidth(Math.round(Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth * 0.6)));
  };
  const drop = () => {
    setDragging(false);
    try { localStorage.setItem(KEY, String(width)); } catch {}
  };

  return (
    <div className="split" data-dragging={dragging || undefined} style={{ '--chat-w': shown ? `${width}px` : '0px' }}>
      <iframe className="split__pane" src="/" title="Studio" allow={MEDIA} />
      <div
        className="split__line" role="separator" aria-orientation="vertical" hidden={!shown}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
        onPointerMove={drag} onPointerUp={drop}
      />
      <iframe className="split__pane" src="/chat" title="Chat" allow={MEDIA} hidden={!shown} />
    </div>
  );
}
