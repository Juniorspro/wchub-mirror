// ══════════════════════════════════════════════
// Native bridge helper — identity + openGameDetail.
// @rezona/core only exposes bridge.getUsername(); the host App speaks a richer
// protocol (an identity card, and a deep-link into a game's detail page). This
// module talks the SAME WebKit message channel without clobbering core: it
// wraps the global RezonaBridge.onNativeResponse so core's getUsername keeps
// resolving, and routes its own 'g'-prefixed requestIds through a private
// pending map. Outside the App the channel is absent → identity() resolves
// null and openGameDetail() is a silent no-op (desktop / browser stays clean).
//
// Ported verbatim from the single-player colosseum reference — that's how the
// host App achieves "game jumping": a portal/gate fires openGameDetail(gameId)
// and the native shell deep-links into that game's detail page WITHOUT
// unloading this WebView (so location.href would be wrong inside the App).
// ══════════════════════════════════════════════

export interface Identity {
  uid: string;
  username: string;
  avatarImage: string;
}

interface NativeResponse {
  requestId: string;
  action: string;
  code: number;
  data?: unknown;
}

type ResponseHandler = (resp: NativeResponse) => void;

// ── private transport state ──
const PENDING = new Map<string, { resolve: (data: unknown) => void; timer: number }>();
let ridSeed = 0;
let wired = false;

function nextRequestId(): string {
  ridSeed += 1;
  return `g${ridSeed}_${Date.now().toString(36)}`;
}

function hasBridge(): boolean {
  try {
    return !!(window as any).webkit?.messageHandlers?.rezonaBridge;
  } catch {
    return false;
  }
}

/** True only inside the host App WebView (where the native channel exists).
 *  Callers use this to decide between a native game-jump (openGameDetail) and
 *  a plain URL navigation on desktop / browser. */
export function hasNativeBridge(): boolean {
  return hasBridge();
}

// Install our response router exactly once, AFTER core has registered its own
// handler (core does so at import time of @rezona/core; we wire lazily on the
// first call, which only happens post-mount). We resolve our own pending map
// first; everything else falls through to core's handler so both transports
// coexist on the single global callback the native side invokes.
function ensureWired(): void {
  if (wired) return;
  wired = true;
  const root = ((window as any).RezonaBridge ??= {});
  const previous = root.onNativeResponse as ResponseHandler | undefined;
  root.onNativeResponse = (resp: NativeResponse) => {
    const entry = resp && resp.requestId ? PENDING.get(resp.requestId) : undefined;
    if (entry) {
      window.clearTimeout(entry.timer);
      PENDING.delete(resp.requestId);
      entry.resolve(resp.data);
      return;
    }
    previous?.(resp);
  };
}

// Unified invocation — mirrors core's payload shape exactly so any host that
// already understands getUsername understands these too.
function callNative(action: string, params: Record<string, unknown> = {}, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!hasBridge()) {
      reject(new Error('no bridge'));
      return;
    }
    ensureWired();
    const requestId = nextRequestId();
    const timer = window.setTimeout(() => {
      PENDING.delete(requestId);
      reject(new Error(`bridge timeout: ${action}`));
    }, timeoutMs);
    PENDING.set(requestId, { resolve, timer });
    try {
      (window as any).webkit.messageHandlers.rezonaBridge.postMessage({
        action,
        requestId,
        version: '1.0',
        params,
      });
    } catch (error) {
      window.clearTimeout(timer);
      PENDING.delete(requestId);
      reject(error);
    }
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Fetch the host App identity card (uid / username / avatarImage). Resolves
// null outside the App or on any failure — the caller treats null as "no host
// identity" and keeps its placeholder, never an error path.
export async function identity(): Promise<Identity | null> {
  try {
    const data = (await callNative('identity')) as Partial<Identity> | undefined;
    if (!data) return null;
    return {
      uid: asString(data.uid),
      username: asString(data.username),
      avatarImage: asString(data.avatarImage),
    };
  } catch {
    return null;
  }
}

// Deep-link the host App to a game's detail page. Fire-and-forget; never throws
// (browser / desktop has no bridge → silent no-op).
export function openGameDetail(gameId: number | string): void {
  try {
    callNative('openGameDetail', { gameId }).catch(() => {});
  } catch {
    /* silent */
  }
}
