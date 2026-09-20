import type { ReactNode } from 'react'

export function Icon({ name, size = 16 }: { readonly name: string; readonly size?: number }) {
  const paths: Record<string, ReactNode> = {
    knot: <><circle cx="7" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><circle cx="12" cy="17" r="3"/><path d="M9.5 8.8 11 14M14.5 8.8 13 14M10 7h4"/></>,
    play: <path d="m8 5 11 7-11 7Z"/>, studio: <><path d="M4 6h16M7 3v6M4 18h16M16 15v6"/></>, plus: <path d="M12 5v14M5 12h14"/>, chevron: <path d="m9 18 6-6-6-6"/>, down: <path d="m6 9 6 6 6-6"/>,
    message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>,
    case: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 10 2 2-2 2M13 15h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10M8 7h5a5 5 0 0 1 5 5V9"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, pause: <><path d="M9 5v14M15 5v14"/></>, terminal: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>, check: <path d="m5 12 4 4L19 6"/>, code: <path d="m8 9-3 3 3 3M16 9l3 3-3 3M14 5l-4 14"/>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>, close: <path d="m6 6 12 12M18 6 6 18"/>, panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></>, folder: <path d="M3 7h7l2 2h9v10H3Z"/>, database: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/></>, activity: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
