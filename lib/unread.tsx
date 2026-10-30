"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useStore } from "./store";

// Tracks which announcements/events a homeowner has not opened yet.
// "Seen" ids are saved in this browser, separately for each signed-in user.
export type NewKind = "announcements" | "events";
type Seen = Record<NewKind, string[]>;
type UnreadContext = { unseen: Record<NewKind, string[]>; counts: Record<NewKind, number>; markSeen: (kind: NewKind) => void };

const emptySeen: Seen = { announcements: [], events: [] };
const empty: UnreadContext = { unseen: { announcements: [], events: [] }, counts: { announcements: 0, events: 0 }, markSeen: () => {} };
const storageKey = (userId: string) => `iv-seen-${userId}`;
const Ctx = createContext<UnreadContext>(empty);

export function UnreadProvider({ userId, enabled, children }: { userId: string; enabled: boolean; children: React.ReactNode }) {
  const { announcements, events } = useStore();
  const [seen, setSeen] = useState<Seen>(emptySeen);
  const [ready, setReady] = useState(false);

  // Load this user's saved "seen" list before showing any badge, so it never flashes.
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey(userId)); setSeen(raw ? { ...emptySeen, ...JSON.parse(raw) } : emptySeen); } catch { setSeen(emptySeen); }
    setReady(true);
  }, [userId]);

  // Homeowners are notified of published announcements and of events that have not passed yet.
  const current = useMemo<Record<NewKind, string[]>>(() => {
    if (!enabled || !ready) return { announcements: [], events: [] };
    const today = new Date(); const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return { announcements: announcements.filter(a => a.status === "published").map(a => a.id), events: events.filter(e => e.date >= todayKey).map(e => e.id) };
  }, [announcements, events, enabled, ready]);

  const unseen = useMemo<Record<NewKind, string[]>>(() => ({
    announcements: current.announcements.filter(id => !seen.announcements.includes(id)),
    events: current.events.filter(id => !seen.events.includes(id)),
  }), [current, seen]);

  const markSeen = useCallback((kind: NewKind) => {
    setSeen(prev => {
      const next = { ...prev, [kind]: Array.from(new Set([...prev[kind], ...current[kind]])) };
      try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [current, userId]);

  const value = useMemo<UnreadContext>(() => ({ unseen, counts: { announcements: unseen.announcements.length, events: unseen.events.length }, markSeen }), [unseen, markSeen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useUnread = () => useContext(Ctx);

// Call this on the Announcements / Events page.
// It returns the ids that were new when the page was opened (so they can be highlighted)
// and immediately marks them as seen, which clears the sidebar badge.
export function useNewItems(kind: NewKind) {
  const { unseen, markSeen } = useUnread();
  const [fresh, setFresh] = useState<string[]>([]);
  const key = unseen[kind].join("|");
  useEffect(() => {
    if (!unseen[kind].length) return;
    setFresh(prev => Array.from(new Set([...prev, ...unseen[kind]])));
    markSeen(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => new Set(fresh), [fresh]);
}
