/**
 * External store for the local session, read with useSyncExternalStore so the
 * server render (no localStorage) and the client render reconcile without
 * setState-in-effect hydration tricks.
 *
 * Each tab keeps its own in-memory session after the first read. Tabs do NOT
 * follow each other's changes live — a job under review in one tab is never
 * switched by another tab. localStorage only restores the last session on
 * reload.
 */

import { emptySession, loadSessionFromStorage, saveSessionToStorage } from "./sessionState.js";

const SERVER_SNAPSHOT = Object.freeze({ session: emptySession(), notice: null, hydrated: false, persistent: false });

let state = null;
const listeners = new Set();

function storage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load() {
  if (state) return state;
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  const s = storage();
  const { session, notice } = s ? loadSessionFromStorage(s) : { session: emptySession(), notice: "Browser storage is unavailable; the session will not survive a reload." };
  state = { session, notice, hydrated: true, persistent: !!s };
  return state;
}

const emit = () => listeners.forEach((fn) => fn());

export const sessionStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot: load,
  getServerSnapshot: () => SERVER_SNAPSHOT,
  update(patch) {
    const current = load();
    const session = { ...current.session, ...patch };
    const s = storage();
    const persistent = s ? saveSessionToStorage(s, session) : false;
    state = { ...current, session, persistent };
    emit();
  },
  dismissNotice() {
    const current = load();
    state = { ...current, notice: null };
    emit();
  },
  /** Test hook. */
  _reset() {
    state = null;
  },
};
