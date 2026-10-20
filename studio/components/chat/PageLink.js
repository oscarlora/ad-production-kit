'use client';
// Studio's side of the chat (/chat): tells it which page is open, and opens the pages the agent asks for.
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export const CHANNEL = 'ad-production-kit-studio:chat';

export default function PageLink() {
  const path = usePathname();
  const router = useRouter();
  const here = useRef(path);
  here.current = path;
  useEffect(() => {
    if (path === '/app' || path.startsWith('/chat')) return undefined; // the frame and the chat aren't Studio pages
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ page: path });
    ch.onmessage = (e) => {
      if (e.data?.open) router.push(e.data.open);
      if (e.data?.where) ch.postMessage({ page: here.current });
    };
    return () => ch.close();
  }, [path, router]);
  return null;
}
