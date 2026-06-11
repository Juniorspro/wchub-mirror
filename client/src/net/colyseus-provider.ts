// Single switch point between the real Colyseus transport and the in-browser
// offline room. Offline activates via ?offline=1 (runtime) or VITE_OFFLINE=1
// (build env) — same bundle serves both modes.
import * as real from 'colyseus.js';
import { FakeClient } from './fake-colyseus';

function offlineRequested(): boolean {
  try {
    if ((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_OFFLINE === '1') return true;
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    if (q.get('offline') === '0') return false;
    return q.has('offline') || window.location.protocol === 'file:';
  } catch {
    return false;
  }
}

export const OFFLINE_MODE = offlineRequested();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Client: typeof real.Client = (OFFLINE_MODE ? (FakeClient as any) : real.Client);
export type Room = real.Room;
