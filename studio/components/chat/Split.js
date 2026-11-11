'use client';
// `/app`: Studio and the chat side by side, what the Mac app shows. Drag the line between them to resize the chat;
// window.toggleChat() (the app's ⌘J) hides or shows it.
import { useEffect, useState } from 'react';
import { useDragWidth } from '../../lib/client/hooks.js';

const MEDIA = 'fullscreen; clipboard-read; clipboard-write; autoplay';

export default function Split() {
  const [width, dragging, line] = useDragWidth('ad-production-kit-studio:chat-width', 420,
    (e) => Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth * 0.6));
  const [shown, setShown] = useState(true);
  useEffect(() => { window.toggleChat = () => setShown((v) => !v); }, []);

  return (
    <div className="split" data-dragging={dragging || undefined} style={{ '--chat-w': shown ? `${width}px` : '0px' }}>
      <iframe className="split__pane" src="/" title="Studio" allow={MEDIA} />
      <div className="split__line" hidden={!shown} {...line} />
      <iframe className="split__pane" src="/chat" title="Chat" allow={MEDIA} hidden={!shown} />
    </div>
  );
}
