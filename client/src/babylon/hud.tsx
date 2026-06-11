// ══════════════════════════════════════════════
// Fairground HUD — DOM overlay above the Babylon canvas.
//
// Three panels:
//   1. Top-left badge — room code + connection state + nearby-stall hint.
//   2. RIGHT side: stall-scoped browser. Only visible when the local player
//      stands within range of a stall. Lists items in that stall's category
//      and toggles them on the local outfit. Equip flows through
//      net.send('equip', ...) via store → game.ts subscriber.
//   3. BOTTOM-left chat — scrolling feed + text input. Send writes through
//      net.send('chat', { text }).
//
// The HUD never touches Babylon directly — it reads/writes the store and
// uses a NetClient handle threaded down from App.tsx.
// ══════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import type { Phase } from '@rezona/core/3d';
import {
  clearBetResult,
  deleteLook,
  equipCustomDesign,
  getGameSnapshot,
  hydratePresetsFromStorage,
  isItemOwned,
  placeLocalBet,
  priceFor,
  purchaseItem,
  saveLook,
  setAvatarExpression,
  subscribeGameStore,
  toggleAccessoryItem,
  toggleTextureItem,
  type CustomSlot,
  type GameStoreSnapshot,
  type SavedLook,
} from './store';
import {
  JERSEY_PRESETS,
  WARDROBE_ACCESSORY_ITEMS,
  WARDROBE_TEXTURE_ITEMS,
  type AccessoryItemDef,
  type TextureItemDef,
} from './items';
import { drawDesignPanelsSync, patternSwatchCss, uniformDesign, type GarmentDesign, type Pattern } from './textures';
import { STALL_LAYOUT, type StallCategory, type StallDef } from './entities';
import { isPortraitRotated } from './touch';
import { hasNativeBridge, openGameDetail } from './bridge';
import type { NetClient } from '../net';

interface HudProps {
  phaseRef: MutableRefObject<Phase>;
  net?: NetClient;
}

export function Hud({ phaseRef: _phaseRef, net }: HudProps) {
  const [snap, setSnap] = useState<GameStoreSnapshot>(() => getGameSnapshot());

  useEffect(() => {
    hydratePresetsFromStorage();
    return subscribeGameStore(setSnap);
  }, []);

  const stall: StallDef | null = useMemo(() => {
    if (!snap.nearbyStallId) return null;
    return STALL_LAYOUT.find((s) => s.id === snap.nearbyStallId) ?? null;
  }, [snap.nearbyStallId]);

  const stallItems = useMemo<{ kind: 'texture' | 'accessory'; items: Array<TextureItemDef | AccessoryItemDef> }>(() => {
    if (!stall) return { kind: 'texture', items: [] };
    return itemsForStall(stall.category);
  }, [stall]);

  const equippedTextureIds = new Set(snap.outfit.textureItemIds);
  const equippedAccessoryIds = new Set(snap.outfit.accessoryItemIds);

  const handleItemClick = (item: TextureItemDef | AccessoryItemDef) => {
    if (!stallItems) return;
    // Economy gate: free items (priceFor === 0) and already-owned items
    // toggle directly. Priced items require purchase first. If the player
    // can't afford it, do nothing (the chip shows the locked state so the
    // failure is visible without a popup).
    if (!isItemOwned(item.id)) {
      const bought = purchaseItem(item.id);
      if (!bought) return;
    }
    if (stallItems.kind === 'texture') toggleTextureItem(item.id);
    else toggleAccessoryItem(item.id);
  };

  // ── Exclusive drawer state — at most ONE heavy panel open at a time, so
  //    panels can never overlap each other or the touch controls.
  const [openDrawer, setOpenDrawer] = useState<DrawerKey | null>(null);
  const toggleDrawer = (key: DrawerKey) => setOpenDrawer((v) => (v === key ? null : key));

  // Unread-chat badge: count messages from OTHERS newer than the last one
  // seen with the chat drawer open. Timestamp-based (not length-based) so
  // the capped/trimmed history can't desync the counter. Compares localT
  // (client arrival clock) — NOT the server-stamped m.t, which lives in a
  // different clock domain and goes permanently quiet when the phone's
  // clock runs ahead of the server's.
  const seenAt = (m: { t: number; localT?: number }) => m.localT ?? m.t;
  const [chatSeenT, setChatSeenT] = useState<number>(() => Date.now());
  useEffect(() => {
    if (openDrawer !== 'chat' || snap.chat.length === 0) return;
    const lastT = seenAt(snap.chat[snap.chat.length - 1]);
    setChatSeenT((prev) => (lastT > prev ? lastT : prev));
  }, [openDrawer, snap.chat]);
  const unreadChat = openDrawer === 'chat'
    ? 0
    : snap.chat.filter((m) => seenAt(m) > chatSeenT && m.from !== snap.selfId).length;

  // Walking away from a stall closes its browser (can't shop from afar).
  useEffect(() => {
    if (!snap.nearbyStallId && openDrawer === 'stall') setOpenDrawer(null);
  }, [snap.nearbyStallId, openDrawer]);

  // Keyboard-verb hint cards only make sense with a fine pointer and a
  // viewport tall enough to keep them out of the action.
  const desktopHints = useDesktopHints();

  // LLM-EXTENSION:HUD — Fairground multiplayer overlay, landscape-phone-first. A compact top-left chip shows coins + room. Every heavy panel (chat / betting / standings / expressions / stall browser) hides behind a top-right toggle rail and opens as an EXCLUSIVE right-side drawer — opening one closes the rest, so panels can never overlap each other, the left-thumb joystick, or the bottom-right touch action buttons (jump / wave / compliment / browse / portal — these send the same net messages the keyboard verbs in game.ts use). The stall browser no longer auto-opens on proximity; proximity surfaces a Browse action button instead. All multiplayer interaction is funneled through this component.
  // DO NOT REMOVE the LLM-EXTENSION:HUD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return (
    <>
      <div style={topBadgeStyle}>
        <span style={coinBadgeStyle} title="Coins — earn the daily bonus by checking in every 24h">
          🪙 {snap.balance}
        </span>
        <span style={{ opacity: 0.75, fontSize: '0.7rem' }}>
          {snap.roomCode ? `Room ${snap.roomCode}` : snap.message}
        </span>
      </div>

      <ToggleRail
        open={openDrawer}
        onToggle={toggleDrawer}
        unreadChat={unreadChat}
        fixtures={snap.bettingFixtures}
        myBets={snap.myBets}
        hasStandings={snap.bettingStandings.length > 0}
      />

      {openDrawer === 'chat' ? (
        <div style={{ ...drawerStyle, width: 'min(320px, 44vw)', height: 'calc(100% - 92px)' }}>
          <ChatPanel net={net} chat={snap.chat} selfId={snap.selfId} />
        </div>
      ) : null}
      {openDrawer === 'betting' ? (
        <div style={{ ...drawerStyle, width: 292 }}>
          <BettingPanel net={net} fixtures={snap.bettingFixtures} myBets={snap.myBets} balance={snap.balance} />
        </div>
      ) : null}
      {openDrawer === 'standings' ? (
        <div style={{ ...drawerStyle, width: 'min(560px, 70vw)' }}>
          <LeaderboardPanel standings={snap.bettingStandings} onClose={() => setOpenDrawer(null)} />
        </div>
      ) : null}
      {openDrawer === 'emotes' ? (
        <div style={drawerStyle}>
          <ExpressionBar />
        </div>
      ) : null}
      {openDrawer === 'stall' && stall ? (
        <StallPanel
          stall={stall}
          items={stallItems.items}
          isEquipped={(id) =>
            equippedTextureIds.has(id) || equippedAccessoryIds.has(id)
          }
          onItemClick={handleItemClick}
          savedLooks={snap.savedLooks}
          balance={snap.balance}
        />
      ) : null}

      {desktopHints && openDrawer === null ? (
        <SocialPanel
          nearestName={snap.nearestOtherName}
          crowdCount={snap.crowdCount}
          crowdTimer={snap.crowdTimer}
        />
      ) : (
        <CrowdPill crowdCount={snap.crowdCount} crowdTimer={snap.crowdTimer} />
      )}
      {snap.nearbySignpost ? <SignpostPanel /> : null}

      <ActionCluster
        net={net}
        stallLabel={stall ? stall.label : ''}
        browseOpen={openDrawer === 'stall'}
        onBrowse={() => toggleDrawer('stall')}
        nearestOtherId={snap.nearestOtherId}
        nearestOtherName={snap.nearestOtherName}
        portalLabel={snap.nearbyPortalLabel}
        portalUrl={snap.nearbyPortalUrl}
        portalGameId={snap.nearbyPortalGameId}
      />

      {snap.lastBetResult ? (
        <BetResultToast result={snap.lastBetResult} fixtures={snap.bettingFixtures} />
      ) : null}
      <SoccerScoreboard goal={snap.lastSoccerGoal} />
      <SoccerGoalBanner goal={snap.lastSoccerGoal} />
    </>
  );
}

// ─── Drawer chrome: toggle rail + touch action buttons ──────────────────────

type DrawerKey = 'chat' | 'betting' | 'standings' | 'emotes' | 'stall';

// True on mouse-driven, reasonably tall viewports — gates the keyboard-verb
// hint cards that are useless (and in the way) on a landscape phone. The
// rotated check matters because under rotation window.innerHeight is the
// PORTRAIT height (tall) while the game lays out at phone height.
function computeDesktopHints(): boolean {
  if (typeof window === 'undefined') return false;
  if (isPortraitRotated()) return false;
  return window.matchMedia('(pointer: fine)').matches && window.innerHeight >= 500;
}
function useDesktopHints(): boolean {
  const [v, setV] = useState(computeDesktopHints);
  useEffect(() => {
    const onResize = () => setV(computeDesktopHints());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return v;
}

// Top-right column of 44px toggle buttons. Each badge keeps the collapsed
// panel's one load-bearing live datum visible: unread count for chat, the
// bet-window countdown / LIVE / ✓-bet-placed for betting.
function ToggleRail({
  open,
  onToggle,
  unreadChat,
  fixtures,
  myBets,
  hasStandings,
}: {
  open: DrawerKey | null;
  onToggle: (key: DrawerKey) => void;
  unreadChat: number;
  fixtures: ReadonlyArray<import('./store').BettingFixtureSnapshot>;
  myBets: ReadonlyMap<string, { camp: 'HOME' | 'DRAW' | 'AWAY'; amount: number }>;
  hasStandings: boolean;
}) {
  // 1s tick keeps the betting badge countdown live while the panel itself
  // is unmounted (the collapsed state must not freeze the bet window).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (fixtures.length === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [fixtures.length]);

  const primary = fixtures.find((f) => f.phase !== 'RESOLVED') ?? fixtures[0];
  let betBadge = '';
  if (primary) {
    const dt = primary.kickoffMs - Date.now();
    if (primary.phase === 'LIVE') {
      betBadge = 'LIVE';
    } else if (primary.phase === 'BET_WINDOW') {
      const mins = Math.max(0, Math.floor(dt / 60000));
      const secs = Math.max(0, Math.floor((dt % 60000) / 1000));
      betBadge = myBets.get(primary.id) ? '✓' : `${mins}:${secs.toString().padStart(2, '0')}`;
    } else if (primary.phase === 'AWAIT_BET') {
      const hours = Math.floor(dt / 3600000);
      betBadge = hours > 0 ? `${hours}h` : `${Math.max(0, Math.floor(dt / 60000))}m`;
    }
  }

  return (
    <div style={railStyle}>
      <RailButton
        emoji="💬" label="Chat" active={open === 'chat'}
        badge={unreadChat > 0 ? (unreadChat > 9 ? '9+' : String(unreadChat)) : ''}
        onClick={() => onToggle('chat')}
      />
      {fixtures.length > 0 ? (
        <RailButton
          emoji="🎲" label="Match bets" active={open === 'betting'}
          badge={betBadge}
          onClick={() => onToggle('betting')}
        />
      ) : null}
      {hasStandings ? (
        <RailButton
          emoji="🏆" label="World Cup standings" active={open === 'standings'}
          badge=""
          onClick={() => onToggle('standings')}
        />
      ) : null}
      <RailButton
        emoji="😊" label="Expressions" active={open === 'emotes'}
        badge=""
        onClick={() => onToggle('emotes')}
      />
    </div>
  );
}

function RailButton({
  emoji,
  label,
  badge,
  active,
  onClick,
}: {
  emoji: string;
  label: string;
  badge: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button" className="btn-press"
      onClick={onClick}
      title={label} aria-label={label} aria-pressed={active}
      style={active ? { ...railButtonStyle, ...railButtonActiveStyle } : railButtonStyle}
    >
      {emoji}
      {badge ? <span style={railBadgeStyle}>{badge}</span> : null}
    </button>
  );
}

// Bottom-right touch verbs. Each sends the SAME net message its keyboard
// twin in game.ts sends (Space/F/E/G stay live for desktop) — the server
// rate-limits all of them, so button mashing is safe.
function ActionCluster({
  net,
  stallLabel,
  browseOpen,
  onBrowse,
  nearestOtherId,
  nearestOtherName,
  portalLabel,
  portalUrl,
  portalGameId,
}: {
  net: NetClient | undefined;
  stallLabel: string;
  browseOpen: boolean;
  onBrowse: () => void;
  nearestOtherId: string | null;
  nearestOtherName: string;
  portalLabel: string;
  portalUrl: string;
  portalGameId: number;
}) {
  const send = (type: string, payload?: unknown) => {
    if (net?.isOpen()) net.send(type, payload);
  };
  // Jump to the portal's game. Inside the host App, deep-link via the native
  // bridge (keeps this WebView alive); on desktop/browser fall back to a URL
  // navigation. Mirrors the G-key path in game.ts.
  const enterPortal = () => {
    if (hasNativeBridge()) {
      openGameDetail(portalGameId);
    } else if (portalUrl) {
      try { window.location.href = portalUrl; } catch { /* ignore */ }
    }
  };
  return (
    <div style={actionClusterStyle}>
      {portalUrl ? (
        <ActionButton
          emoji="🌀" label="Play" title={`Play ${portalLabel}`} accent
          onClick={enterPortal}
        />
      ) : null}
      {stallLabel ? (
        <ActionButton
          emoji="🛍️" label={browseOpen ? 'Close' : 'Browse'} title={`Browse ${stallLabel}`}
          active={browseOpen} onClick={onBrowse}
        />
      ) : null}
      {nearestOtherId ? (
        <ActionButton
          emoji="💝" label="Praise" title={`Compliment ${nearestOtherName} (+5🪙 to them)`}
          onClick={() => send('compliment', { to: nearestOtherId })}
        />
      ) : null}
      <ActionButton emoji="👋" label="Wave" title="Wave at everyone" onClick={() => send('wave')} />
      <ActionButton emoji="⬆️" label="Jump" title="Jump" onClick={() => send('jump')} />
    </div>
  );
}

function ActionButton({
  emoji,
  label,
  title,
  onClick,
  active = false,
  accent = false,
}: {
  emoji: string;
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  accent?: boolean;
}) {
  // Fire on POINTERDOWN, not click. The browser only synthesises a `click`
  // for the PRIMARY pointer, so while the left thumb holds the movement
  // joystick (the primary pointer) a second-finger tap here was non-primary
  // and never produced a click — you couldn't move + jump (or wave/praise)
  // at the same time. pointerdown fires for every pointer. We stop the touch
  // from bubbling to the camera-drag/canvas layers, and keep a keyboard-only
  // onClick fallback (keyboard-activated clicks report detail === 0).
  const press = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClick();
  };
  const keyboardClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0) onClick();
  };
  return (
    <button
      type="button" className="btn-press"
      title={title} aria-label={title}
      onPointerDown={press}
      onClick={keyboardClick}
      style={{
        ...actionButtonStyle,
        ...(accent ? actionButtonAccentStyle : {}),
        ...(active ? actionButtonActiveStyle : {}),
      }}
    >
      <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{emoji}</span>
      <span style={{ fontSize: '0.55rem', opacity: 0.9 }}>{label}</span>
    </button>
  );
}

// Touch-mode stand-in for SocialPanel's crowd-bonus bar: a slim bottom-center
// pill that only appears while ≥2 other players are in range.
function CrowdPill({ crowdCount, crowdTimer }: { crowdCount: number; crowdTimer: number }) {
  if (crowdCount < 2) return null;
  const pct = Math.min(100, Math.round((crowdTimer / 30) * 100));
  return (
    <div style={crowdPillStyle} title="+50🪙 when this bar fills">
      <span style={{ fontSize: '0.7rem' }}>👥 Crowd bonus</span>
      <div style={crowdBarOuterStyle}>
        <div style={{ ...crowdBarFillStyle, width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Stall panel ────────────────────────────────────────────────────────────

function StallPanel({
  stall,
  items,
  isEquipped,
  onItemClick,
  savedLooks,
  balance,
}: {
  stall: StallDef;
  items: Array<TextureItemDef | AccessoryItemDef>;
  isEquipped: (id: string) => boolean;
  onItemClick: (item: TextureItemDef | AccessoryItemDef) => void;
  savedLooks: readonly SavedLook[];
  balance: number;
}) {
  // Customize is only meaningful for garment slots (shirt / pants / shoes).
  const inlineSlot: CustomSlot | null =
    stall.category === 'shirt' || stall.category === 'pants' || stall.category === 'shoes'
      ? (stall.category as CustomSlot)
      : null;
  const [showInlineCustom, setShowInlineCustom] = useState(false);

  // The Design Bench is a dedicated stall — render the editor straight away
  // with a slot picker on top, no catalog grid.
  if (stall.category === 'customize') {
    return (
      <div style={{ ...stallPanelStyle, borderTopColor: stall.color }}>
        <div style={stallHeaderStyle}>
          <strong>{stall.label}</strong>
          <span style={{ opacity: 0.6, fontSize: '0.72rem' }}>{categoryLabel(stall.category)}</span>
        </div>
        <CustomizeStallBody savedLooks={savedLooks} />
      </div>
    );
  }

  return (
    <div style={{ ...stallPanelStyle, borderTopColor: stall.color }}>
      <div style={stallHeaderStyle}>
        <strong>{stall.label}</strong>
        <span style={{ opacity: 0.6, fontSize: '0.72rem' }}>{categoryLabel(stall.category)}</span>
        {inlineSlot ? (
          <button
            type="button"
            style={customToggleStyle}
            onClick={() => setShowInlineCustom((v) => !v)}
            aria-pressed={showInlineCustom}
          >
            {showInlineCustom ? '← Catalog' : '✎ Customize'}
          </button>
        ) : null}
      </div>
      {showInlineCustom && inlineSlot ? (
        <CustomizePanel
          slot={inlineSlot}
          savedLooks={savedLooks.filter((l) => l.slot === inlineSlot)}
        />
      ) : (
        <div style={stallGridStyle}>
          {items.map((item) => {
            const equipped = isEquipped(item.id);
            const owned = isItemOwned(item.id);
            const cost = priceFor(item.id);
            // Locked = priced + not owned. We still let the click handler
            // run (it'll call purchaseItem under the hood) — but visually
            // dim the tile when the player can't afford it yet.
            const locked = !owned;
            const canAfford = owned || balance >= cost;
            const tileStyle: CSSProperties = {
              ...itemTileStyle,
              ...(equipped ? itemTileEquippedStyle : {}),
              ...(locked && !canAfford ? itemTileLockedStyle : {}),
            };
            return (
              <button
                key={item.id}
                style={tileStyle}
                onClick={() => onItemClick(item)}
                aria-pressed={equipped}
                title={
                  equipped ? 'Equipped'
                  : owned ? 'Owned — click to equip'
                  : canAfford ? `Buy for ${cost} coins`
                  : `Need ${cost - balance} more coins`
                }
              >
                <span style={{ ...swatchStyle, background: patternSwatchCss(item.swatch) }} />
                <span style={itemLabelStyle}>{item.label}</span>
                {equipped ? (
                  <span style={equippedDotStyle}>✓</span>
                ) : locked ? (
                  <span style={priceDotStyle}>🪙{cost}</span>
                ) : null}
              </button>
            );
          })}
          {items.length === 0 ? <div style={{ opacity: 0.5, padding: 8 }}>(empty)</div> : null}
        </div>
      )}
    </div>
  );
}

// Dedicated Customize stall body — slot picker + the standard CustomizePanel.
// Filters savedLooks to the active slot so the gallery beneath the editor
// shows only relevant designs.
function CustomizeStallBody({ savedLooks }: { savedLooks: readonly SavedLook[] }) {
  const [slot, setSlot] = useState<CustomSlot>('shirt');
  return (
    <>
      <div style={slotPickerRowStyle}>
        {(['shirt', 'pants', 'shoes'] as CustomSlot[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSlot(s)}
            style={s === slot ? { ...slotPickerButtonStyle, ...slotPickerButtonActiveStyle } : slotPickerButtonStyle}
          >{slotLabel(s)}</button>
        ))}
      </div>
      <CustomizePanel
        key={slot} // remount so internal editing-state resets when slot changes
        slot={slot}
        savedLooks={savedLooks.filter((l) => l.slot === slot)}
      />
    </>
  );
}

function slotLabel(s: CustomSlot): string {
  switch (s) {
    case 'shirt': return 'Shirt';
    case 'pants': return 'Pants';
    case 'shoes': return 'Shoes';
  }
}

// ─── Customize panel ───────────────────────────────────────────────────────
// Per-panel garment editor. The user picks the active panel by clicking the
// 2×2 diagram, then picks a pattern KIND and one or two colors from the
// palette below. The live <canvas> preview renders via drawDesignPanelsSync,
// the same routine the Babylon scene uses for the real texture — what you
// see in the preview is exactly what the avatar will wear once equipped.

type PanelKey = keyof Pick<GarmentDesign, 'back' | 'front' | 'sleeveL' | 'sleeveR'>;

const PALETTE: string[] = [
  '#f5f5f5', '#1a1a1d', '#c14444', '#3a6ea5',
  '#e8c84a', '#3aa898', '#a8589a', '#4a5d3a',
  '#7a4a26', '#dccfb4', '#2c557d', '#a89868',
];

const KIND_OPTIONS: Array<{ key: Pattern['kind']; label: string; make: (a: string, b: string) => Pattern }> = [
  { key: 'solid',    label: 'Solid',    make: (a) => ({ kind: 'solid', color: a }) },
  { key: 'hStripes', label: 'H-stripes',make: (a, b) => ({ kind: 'hStripes', colors: [a, b], thickness: 24 }) },
  { key: 'vStripes', label: 'V-stripes',make: (a, b) => ({ kind: 'vStripes', colors: [a, b], thickness: 24 }) },
  { key: 'dots',     label: 'Dots',     make: (a, b) => ({ kind: 'dots', bg: a, dot: b, size: 28 }) },
  { key: 'checker',  label: 'Check',    make: (a, b) => ({ kind: 'checker', colorA: a, colorB: b, size: 32 }) },
  { key: 'hatch',    label: 'Hatch',    make: (a, b) => ({ kind: 'hatch', bg: a, line: b, spacing: 14 }) },
  { key: 'twoTone',  label: 'Two-tone', make: (a, b) => ({ kind: 'twoTone', top: a, bottom: b }) },
];

const PANEL_LABEL: Record<PanelKey, string> = {
  back: 'Back', front: 'Front', sleeveL: 'Sleeve L', sleeveR: 'Sleeve R',
};

// Pants alias for the same four storage slots, so the diagram labels match
// what the wearer actually sees on the leg.
const PANTS_PANEL_LABEL: Record<PanelKey, string> = {
  back: 'L front', front: 'R front', sleeveL: 'L back', sleeveR: 'R back',
};

function defaultDesign(): GarmentDesign {
  return uniformDesign({ kind: 'solid', color: '#f5f5f5' });
}

function CustomizePanel({ slot, savedLooks }: { slot: CustomSlot; savedLooks: readonly SavedLook[] }) {
  const [design, setDesign] = useState<GarmentDesign>(defaultDesign);
  const [active, setActive] = useState<PanelKey>('front');
  const [name, setName] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Pattern editor state — kind + two colors. Re-applies to the active panel.
  const [kind, setKind] = useState<Pattern['kind']>('solid');
  const [colorA, setColorA] = useState<string>('#f5f5f5');
  const [colorB, setColorB] = useState<string>('#1a1a1d');

  // Personalization (shirt slot only) — back-name + back-number text. Both
  // baked into design.overlay so they round-trip through the look: id and
  // remote players see them too.
  const [numberText, setNumberText] = useState<string>('');
  const [nameText, setNameText] = useState<string>('');

  // Re-draw the preview canvas whenever the design changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawDesignPanelsSync(ctx, design, c.width);
  }, [design]);

  // LIVE APPLY — any design change (typing a number/name, picking a
  // color or pattern, drawing pixels) equips automatically after a
  // 350ms settle, so the avatar updates as you type without pressing
  // Equip. Guards: skip the initial mount, and skip slot-only changes
  // (switching tabs at the Design Bench must not stamp the previous
  // slot's design onto the new slot).
  const lastAppliedDesignRef = useRef<GarmentDesign | null>(null);
  useEffect(() => {
    if (lastAppliedDesignRef.current === design) return;  // slot switch only
    if (lastAppliedDesignRef.current === null) {
      lastAppliedDesignRef.current = design;              // mount
      return;
    }
    lastAppliedDesignRef.current = design;
    const t = setTimeout(() => equipCustomDesign(slot, design), 350);
    return () => clearTimeout(t);
  }, [design, slot]);

  // ─── Pixel-draw editor state ────────────────────────────────────────────
  // 24×24 grid, palette-indexed nibbles ('f' = transparent). The grid
  // lives INSIDE design.pixelArt so it round-trips through the look: id
  // and other players see the drawing.
  const DRAW_N = 24;
  const ERASER = -1;
  const [drawOpen, setDrawOpen] = useState(false);
  const [drawColor, setDrawColor] = useState(2);
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintingRef = useRef(false);

  const paintAt = (clientX: number, clientY: number) => {
    const c = drawCanvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    // clientX/Y are viewport coords and are NOT inverse-mapped through the
    // shell's landscape-in-portrait rotation (only offsetX/Y would be).
    // Under rotate(90deg) the canvas-local axes are: u = screen-down,
    // v = screen-left — remap so strokes land under the finger.
    const rot = isPortraitRotated();
    const u = rot ? clientY - r.top : clientX - r.left;
    const v = rot ? r.right - clientX : clientY - r.top;
    const gx = Math.min(DRAW_N - 1, Math.floor((u / r.width) * DRAW_N));
    const gy = Math.min(DRAW_N - 1, Math.floor((v / r.height) * DRAW_N));
    if (gx < 0 || gy < 0) return;
    setDesign((prev) => {
      const cur = prev.pixelArt && prev.pixelArt.w === DRAW_N
        ? prev.pixelArt.data
        : 'f'.repeat(DRAW_N * DRAW_N);
      const idx = gy * DRAW_N + gx;
      const nib = drawColor === ERASER ? 'f' : drawColor.toString(16);
      if (cur[idx] === nib) return prev;
      const data = cur.slice(0, idx) + nib + cur.slice(idx + 1);
      return { ...prev, pixelArt: { palette: PALETTE, data, w: DRAW_N, h: DRAW_N } };
    });
  };

  // Redraw the editor grid whenever the pixel data changes.
  useEffect(() => {
    if (!drawOpen) return;
    const c = drawCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const cell = c.width / DRAW_N;
    for (let y = 0; y < DRAW_N; y++) {
      for (let x = 0; x < DRAW_N; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#e8e4da' : '#dcd6c8';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    const art = design.pixelArt;
    if (art && art.w === DRAW_N) {
      for (let i = 0; i < art.data.length; i++) {
        const ch = art.data[i];
        if (ch === 'f') continue;
        const nib = parseInt(ch, 16);
        if (!Number.isFinite(nib) || nib >= PALETTE.length) continue;
        ctx.fillStyle = PALETTE[nib];
        ctx.fillRect((i % DRAW_N) * cell, Math.floor(i / DRAW_N) * cell, cell, cell);
      }
    }
  }, [design.pixelArt, drawOpen]);

  // For shoes, hide the per-panel diagram and apply the active pattern to
  // ALL four panels — the shoe sphere UV doesn't split into quadrants.
  const isShoes = slot === 'shoes';
  const isShirt = slot === 'shirt';
  const labels: Record<PanelKey, string> = slot === 'pants' ? PANTS_PANEL_LABEL : PANEL_LABEL;

  const applyKindColors = (k: Pattern['kind'], a: string, b: string) => {
    const maker = KIND_OPTIONS.find((o) => o.key === k);
    if (!maker) return;
    const pattern = maker.make(a, b);
    setDesign((prev) => {
      if (isShoes) return uniformDesign(pattern);
      return { ...prev, [active]: pattern };
    });
  };

  const onPickKind = (k: Pattern['kind']) => {
    setKind(k);
    applyKindColors(k, colorA, colorB);
  };
  const onPickColorA = (c: string) => { setColorA(c); applyKindColors(kind, c, colorB); };
  const onPickColorB = (c: string) => { setColorB(c); applyKindColors(kind, colorA, c); };

  const onEquip = () => equipCustomDesign(slot, design);
  const onSave = () => { saveLook(name || `${slot}-${Date.now() % 10000}`, slot, design); setName(''); };
  const onLoad = (l: SavedLook) => {
    setDesign(l.design);
    setNumberText(l.design.overlay?.numberText ?? '');
    setNameText(l.design.overlay?.nameText ?? '');
  };

  // Load a World Cup jersey preset as the starting point. After this the
  // player typically just tweaks number + name, hits Equip.
  const onLoadPreset = (preset: { id: string; design: GarmentDesign }) => {
    setDesign(preset.design);
    setNumberText(preset.design.overlay?.numberText ?? '');
    setNameText(preset.design.overlay?.nameText ?? '');
  };

  // Number input — digits only, max 3 chars. Updates design.overlay.numberText
  // and supplies default colors if the design has no overlay yet.
  const onNumberChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 3);
    setNumberText(cleaned);
    setDesign((prev) => ({
      ...prev,
      overlay: {
        ...prev.overlay,
        numberText: cleaned || undefined,
        numberColor: prev.overlay?.numberColor ?? '#1a1a1d',
      },
    }));
  };

  // Name input — letters + spaces, uppercased on render, max 14 chars.
  const onNameChange = (raw: string) => {
    const cleaned = raw.replace(/[^A-Za-z .-]/g, '').slice(0, 14);
    setNameText(cleaned);
    setDesign((prev) => ({
      ...prev,
      overlay: {
        ...prev.overlay,
        nameText: cleaned || undefined,
        nameColor: prev.overlay?.nameColor ?? '#1a1a1d',
      },
    }));
  };

  return (
    <div style={customPanelStyle}>
      {isShirt ? (
        <>
          <div style={presetRowStyle}>
            <span style={presetLabelStyle}>Preset</span>
            <div style={presetChipsStyle}>
              {JERSEY_PRESETS.map((p) => (
                <button
                  key={p.id} type="button"
                  onClick={() => onLoadPreset(p)}
                  style={presetChipStyle}
                  title={p.label}
                >{p.label}</button>
              ))}
            </div>
          </div>
          <div style={personalizeRowStyle}>
            <label style={personalizeLabelStyle}>
              <span style={fieldLabelStyle}>Number</span>
              <input
                type="text" inputMode="numeric"
                value={numberText} onChange={(e) => onNumberChange(e.target.value)}
                placeholder="10" maxLength={3}
                style={personalizeNumberInputStyle}
              />
            </label>
            <label style={personalizeLabelStyle}>
              <span style={fieldLabelStyle}>Name</span>
              <input
                type="text"
                value={nameText} onChange={(e) => onNameChange(e.target.value)}
                placeholder="YOUR NAME" maxLength={14}
                style={personalizeNameInputStyle}
              />
            </label>
          </div>
        </>
      ) : null}
      <div style={customPreviewRowStyle}>
        <canvas ref={canvasRef} width={160} height={160} style={previewCanvasStyle} />
        {!isShoes ? (
          <div style={panelGridStyle}>
            {(['back', 'front', 'sleeveL', 'sleeveR'] as PanelKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setActive(k)}
                style={k === active ? { ...panelButtonStyle, ...panelButtonActiveStyle } : panelButtonStyle}
              >{labels[k]}</button>
            ))}
          </div>
        ) : (
          <div style={{ ...panelGridStyle, gridTemplateColumns: '1fr', alignContent: 'center' }}>
            <div style={{ ...panelButtonStyle, ...panelButtonActiveStyle, cursor: 'default' }}>All over</div>
            <small style={{ opacity: 0.55 }}>Shoes use one pattern.</small>
          </div>
        )}
      </div>

      <div style={kindRowStyle}>
        {KIND_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onPickKind(o.key)}
            style={o.key === kind ? { ...kindChipStyle, ...kindChipActiveStyle } : kindChipStyle}
          >{o.label}</button>
        ))}
      </div>

      <div style={paletteRowStyle}>
        <span style={paletteLabelStyle}>A</span>
        {PALETTE.map((c) => (
          <button
            key={`a-${c}`} type="button"
            onClick={() => onPickColorA(c)}
            style={{ ...swatchDotStyle, background: c, outline: c === colorA ? '2px solid #1a1a1d' : 'none' }}
            aria-label={`color A ${c}`}
          />
        ))}
      </div>
      {kind !== 'solid' ? (
        <div style={paletteRowStyle}>
          <span style={paletteLabelStyle}>B</span>
          {PALETTE.map((c) => (
            <button
              key={`b-${c}`} type="button"
              onClick={() => onPickColorB(c)}
              style={{ ...swatchDotStyle, background: c, outline: c === colorB ? '2px solid #1a1a1d' : 'none' }}
              aria-label={`color B ${c}`}
            />
          ))}
        </div>
      ) : null}

      {!isShoes ? (
        <div style={{ marginTop: 6 }}>
          <button type="button" onClick={() => setDrawOpen((v) => !v)} style={drawToggleStyle}>
            ✏️ {drawOpen ? 'Hide drawing' : 'Draw on the cloth'}
          </button>
          {drawOpen ? (
            <>
              <canvas
                ref={drawCanvasRef}
                width={240} height={240}
                style={drawCanvasStyle}
                onPointerDown={(e) => {
                  paintingRef.current = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  paintAt(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => { if (paintingRef.current) paintAt(e.clientX, e.clientY); }}
                onPointerUp={() => { paintingRef.current = false; }}
              />
              <div style={paletteRowStyle}>
                <span style={paletteLabelStyle}>✏️</span>
                {PALETTE.map((c, i) => (
                  <button
                    key={`d-${c}`} type="button"
                    onClick={() => setDrawColor(i)}
                    style={{ ...swatchDotStyle, background: c, outline: i === drawColor ? '2px solid #1a1a1d' : 'none' }}
                    aria-label={`draw color ${c}`}
                  />
                ))}
                <button
                  type="button" onClick={() => setDrawColor(ERASER)}
                  style={{
                    ...swatchDotStyle,
                    background: 'repeating-linear-gradient(45deg, #fff, #fff 3px, #ccc 3px, #ccc 6px)',
                    outline: drawColor === ERASER ? '2px solid #1a1a1d' : 'none',
                  }}
                  aria-label="eraser" title="Eraser"
                />
                <button
                  type="button"
                  onClick={() => setDesign((prev) => {
                    const { pixelArt: _drop, ...rest } = prev;
                    return rest as GarmentDesign;
                  })}
                  style={drawClearStyle}
                >Clear</button>
              </div>
              <small style={{ opacity: 0.55, display: 'block', marginTop: 2 }}>
                Your drawing prints on the chest + back. Applies live.
              </small>
            </>
          ) : null}
        </div>
      ) : null}

      <div style={customActionsRowStyle}>
        <button type="button" onClick={onEquip} style={customPrimaryButtonStyle}>Equip</button>
        <input
          type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Name…" maxLength={24} style={customInputStyle}
        />
        <button type="button" onClick={onSave} style={customSecondaryButtonStyle}>Save</button>
      </div>

      {savedLooks.length > 0 ? (
        <div style={savedLooksStyle}>
          <div style={{ fontSize: '0.7rem', opacity: 0.7, marginBottom: 4 }}>Saved looks</div>
          <div style={savedLooksGridStyle}>
            {savedLooks.map((l) => (
              <div key={`${l.slot}-${l.name}`} style={savedLookTileStyle}>
                <SavedLookSwatch design={l.design} />
                <span style={savedLookNameStyle}>{l.name}</span>
                <div style={savedLookActionsStyle}>
                  <button type="button" onClick={() => onLoad(l)} style={savedLookButtonStyle}>Load</button>
                  <button type="button" onClick={() => equipCustomDesign(l.slot, l.design)} style={savedLookButtonStyle}>Equip</button>
                  <button type="button" onClick={() => deleteLook(l.name, l.slot)} style={{ ...savedLookButtonStyle, color: '#a52020' }} aria-label="delete">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SavedLookSwatch({ design }: { design: GarmentDesign }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    drawDesignPanelsSync(ctx, design, c.width);
  }, [design]);
  return <canvas ref={ref} width={56} height={56} style={savedLookCanvasStyle} />;
}

// ─── Chat panel ─────────────────────────────────────────────────────────────

// ─── Social panel ───────────────────────────────────────────────────────────
// Bottom-center floating prompts that promote multiplayer interaction:
//   • "Press E to compliment <name>" — appears when a player is within
//     compliment range. Compliments give the recipient +5 coins (anti-farm
//     rate-limited on the server) and pop a floating heart on their avatar.
//   • Crowd bonus progress — fills while ≥2 other players are within range;
//     awards +50 coins at 30s of sustained crowd time, then resets.
//   • "Press F to wave" — always-visible secondary hint.
// All three are read-only displays; the input handlers live in game.ts.
function SocialPanel({
  nearestName,
  crowdCount,
  crowdTimer,
}: {
  nearestName: string;
  crowdCount: number;
  crowdTimer: number;
}) {
  const CROWD_THRESHOLD = 30;
  const crowdPct = Math.min(100, Math.round((crowdTimer / CROWD_THRESHOLD) * 100));
  const crowdActive = crowdCount >= 2;
  return (
    <div style={socialPanelStyle}>
      {nearestName ? (
        <div style={socialHintStyle}>
          <kbd style={kbdStyle}>E</kbd>
          <span>compliment <strong>{nearestName}</strong> (+5🪙 to them)</span>
        </div>
      ) : null}
      <div style={{ ...socialHintStyle, opacity: 0.7 }}>
        <kbd style={kbdStyle}>F</kbd>
        <span>wave 👋</span>
      </div>
      {crowdActive ? (
        <div style={socialHintStyle} title={`+50🪙 when this bar fills`}>
          <span style={{ fontSize: '0.85rem' }}>👥 Crowd bonus</span>
          <div style={crowdBarOuterStyle}>
            <div style={{ ...crowdBarFillStyle, width: `${crowdPct}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Leaderboard panel ──────────────────────────────────────────────────────
// Full standings table for every group of the 2026 World Cup (MP / W / D /
// L / GD / Pts, daily-refreshed on the server). The open/close toggle lives
// in ToggleRail; this is just the drawer content.
function LeaderboardPanel({
  standings,
  onClose,
}: {
  standings: ReadonlyArray<import('./store').GroupStandingSnapshot>;
  onClose: () => void;
}) {
  return (
    <div style={leaderboardPanelStyle}>
      <div style={leaderboardHeaderStyle}>
        <strong>2026 FIFA World Cup — Group Stage</strong>
        <button onClick={onClose} style={leaderboardCloseStyle} title="Close">✕</button>
      </div>
      <div style={leaderboardGroupsStyle}>
        {standings.map((g) => (
          <LeaderboardGroupTable key={g.group} group={g} />
        ))}
      </div>
      <div style={leaderboardFooterStyle}>
        Standings refresh once per day from Football-Data.org.
      </div>
    </div>
  );
}

function LeaderboardGroupTable({
  group,
}: {
  group: import('./store').GroupStandingSnapshot;
}) {
  return (
    <div style={leaderboardGroupCardStyle}>
      <div style={leaderboardGroupTitleStyle}>Group {group.group}</div>
      <table style={leaderboardTableStyle}>
        <thead>
          <tr>
            <th style={{ ...leaderboardThStyle, textAlign: 'left' }}>Team</th>
            <th style={leaderboardThStyle}>MP</th>
            <th style={leaderboardThStyle}>W</th>
            <th style={leaderboardThStyle}>D</th>
            <th style={leaderboardThStyle}>L</th>
            <th style={leaderboardThStyle}>GD</th>
            <th style={leaderboardThPointsStyle}>Pts</th>
          </tr>
        </thead>
        <tbody>
          {group.teams.map((t, idx) => {
            // Top 2 of each group advance — highlight them.
            const advances = idx < 2;
            return (
              <tr key={t.team} style={advances ? leaderboardAdvanceRowStyle : undefined}>
                <td style={{ ...leaderboardTdStyle, textAlign: 'left' }}>
                  <span style={leaderboardTeamCodeStyle}>{t.code}</span>
                  <span style={{ marginLeft: 6 }}>{t.team}</span>
                </td>
                <td style={leaderboardTdStyle}>{t.played}</td>
                <td style={leaderboardTdStyle}>{t.won}</td>
                <td style={leaderboardTdStyle}>{t.draw}</td>
                <td style={leaderboardTdStyle}>{t.lost}</td>
                <td style={leaderboardTdStyle}>{t.goalDifference > 0 ? '+' : ''}{t.goalDifference}</td>
                <td style={leaderboardTdPointsStyle}>{t.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Betting panel ──────────────────────────────────────────────────────────
// Bottom-right corner widget showing the next match + (during the bet
// window) three camp buttons. Click a camp + amount to place a bet. A
// stake slider/buttons control how many coins to stake.
function BettingPanel({
  net,
  fixtures,
  myBets,
  balance,
}: {
  net: NetClient | undefined;
  fixtures: ReadonlyArray<import('./store').BettingFixtureSnapshot>;
  myBets: ReadonlyMap<string, { camp: 'HOME' | 'DRAW' | 'AWAY'; amount: number }>;
  balance: number;
}) {
  // Default stake — players can step up/down with the buttons.
  const [stake, setStake] = useState<number>(50);
  // Tick every second so the kick-off countdown updates.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (fixtures.length === 0) return null;
  // Find the "primary" match — first one not yet resolved.
  const primary = fixtures.find((f) => f.phase !== 'RESOLVED') ?? fixtures[0];
  const now = Date.now();
  const timeToKickoff = primary.kickoffMs - now;
  const myBet = myBets.get(primary.id);

  // Format the headline based on phase.
  let headline = '';
  if (primary.phase === 'BET_WINDOW') {
    const mins = Math.floor(timeToKickoff / 60000);
    const secs = Math.max(0, Math.floor((timeToKickoff % 60000) / 1000));
    headline = `Kick-off in ${mins}:${secs.toString().padStart(2, '0')}`;
  } else if (primary.phase === 'LIVE') {
    headline = `LIVE · ${primary.minute}'`;
  } else if (primary.phase === 'AWAIT_BET') {
    const hours = Math.floor(timeToKickoff / 3600000);
    const mins = Math.floor((timeToKickoff % 3600000) / 60000);
    headline = `Bets open in ${hours > 0 ? `${hours}h ` : ''}${mins}m`;
  } else if (primary.phase === 'RESOLVED') {
    headline = `Final: ${primary.scoreHome}–${primary.scoreAway}`;
  }

  const totalPool = primary.poolHome + primary.poolDraw + primary.poolAway;
  const oddsMult = (campPool: number): number => {
    if (campPool <= 0 || totalPool <= 0) return 0;
    return totalPool / campPool;
  };
  const odds = (campPool: number): string => {
    const m = oddsMult(campPool);
    return m > 0 ? `×${m.toFixed(2)}` : '—';
  };
  // Pari-mutuel payout estimate IF you bet `stake` on this camp AND it
  // wins. The pool grows by your stake first; payout = (total + stake) /
  // (campPool + stake) × stake. Reads as "win this many coins". Shown
  // in big bold text on each camp button so the value is obvious.
  const winIfBet = (campPool: number): number => {
    if (stake <= 0) return 0;
    const newTotal = totalPool + stake;
    const newCamp = campPool + stake;
    if (newCamp <= 0) return 0;
    return Math.floor((newTotal / newCamp) * stake);
  };

  const placeBet = (camp: 'HOME' | 'DRAW' | 'AWAY') => {
    if (!net || primary.phase !== 'BET_WINDOW') return;
    if (myBet) return;  // one bet per match
    if (balance < stake) return;
    // Optimistically deduct + record locally; server confirms via
    // `event:bet-ok` (no-op when it arrives since we already deducted).
    const ok = placeLocalBet(primary.id, camp, stake);
    if (!ok) return;
    net.send('event:bet', { matchId: primary.id, camp, amount: stake });
  };

  const stakeOptions = [10, 50, 100, 200];

  return (
    <div style={bettingPanelStyle}>
      <div style={bettingHeaderStyle}>
        <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>🏟️ {primary.homeTeam} vs {primary.awayTeam}</span>
        <span style={{ fontSize: '0.78rem', opacity: 0.8 }}>{headline}</span>
      </div>
      {(primary.phase === 'LIVE' || primary.phase === 'RESOLVED') ? (
        <div style={liveScoreStyle}>
          {primary.scoreHome} – {primary.scoreAway}
        </div>
      ) : null}
      {primary.phase === 'BET_WINDOW' && !myBet ? (
        <div style={{
          fontSize: '0.72rem', opacity: 0.78, textAlign: 'center',
          padding: '4px 8px 0', lineHeight: 1.35,
        }}>
          Pari-mutuel: every bet on the winning side splits the WHOLE pool
          (in proportion to its stake). Big numbers below = what you win
          if you put <strong>{stake}</strong> 🪙 on that side and it wins.
        </div>
      ) : null}
      <div style={bettingCampsStyle}>
        {(['HOME', 'DRAW', 'AWAY'] as const).map((camp) => {
          const label = camp === 'HOME' ? primary.homeCode : camp === 'AWAY' ? primary.awayCode : 'DRAW';
          const pool = camp === 'HOME' ? primary.poolHome : camp === 'AWAY' ? primary.poolAway : primary.poolDraw;
          const count = camp === 'HOME' ? primary.countHome : camp === 'AWAY' ? primary.countAway : primary.countDraw;
          const isMine = myBet?.camp === camp;
          const disabled = primary.phase !== 'BET_WINDOW' || !!myBet || balance < stake;
          const won = primary.phase === 'RESOLVED' && primary.result === camp;
          const projectedWin = winIfBet(pool);
          return (
            <button
              key={camp}
              onClick={() => placeBet(camp)}
              disabled={disabled}
              style={{
                ...bettingCampButtonStyle,
                ...(isMine ? bettingCampMineStyle : {}),
                ...(won ? bettingCampWonStyle : {}),
                opacity: disabled && !isMine && !won ? 0.55 : 1,
                cursor: disabled ? 'default' : 'pointer',
              }}
            >
              <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>{label}</div>
              {primary.phase === 'BET_WINDOW' && !myBet && projectedWin > 0 ? (
                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#e6c34a' }}>
                  WIN +{projectedWin} 🪙
                </div>
              ) : (
                <div style={{ fontSize: '0.72rem', opacity: 0.85 }}>{odds(pool)}</div>
              )}
              <div style={{ fontSize: '0.62rem', opacity: 0.65 }}>
                {count} bets · pool {pool} 🪙
              </div>
            </button>
          );
        })}
      </div>
      {primary.phase === 'BET_WINDOW' && !myBet ? (
        <div style={bettingStakeRowStyle}>
          <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>Stake</span>
          {stakeOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setStake(opt)}
              style={{
                ...bettingStakeButtonStyle,
                ...(stake === opt ? bettingStakeButtonActiveStyle : {}),
              }}
              disabled={balance < opt}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      {myBet ? (
        <div style={bettingMyBetStyle}>
          You bet {myBet.amount} 🪙 on <strong>{myBet.camp === 'HOME' ? primary.homeCode : myBet.camp === 'AWAY' ? primary.awayCode : 'DRAW'}</strong>
        </div>
      ) : null}
    </div>
  );
}

// ─── Bet-result toast ───────────────────────────────────────────────────────
// Briefly shown center-screen when a bet you placed resolves. Auto-clears.
function BetResultToast({
  result,
  fixtures,
}: {
  result: { matchId: string; profit: number; payout: number };
  fixtures: ReadonlyArray<import('./store').BettingFixtureSnapshot>;
}) {
  useEffect(() => {
    const id = setTimeout(() => clearBetResult(), 5500);
    return () => clearTimeout(id);
  }, [result.matchId]);
  const f = fixtures.find((x) => x.id === result.matchId);
  const won = result.profit > 0;
  const drawnEven = result.profit === 0 && result.payout > 0;
  return (
    <div style={{ ...betToastStyle, ...(won ? betToastWonStyle : drawnEven ? betToastEvenStyle : betToastLostStyle) }}>
      <div style={{ fontSize: '1.05rem', fontWeight: 800 }}>
        {won ? '🎉 You won!' : drawnEven ? '↩ Refunded' : '🪨 You lost'}
      </div>
      <div style={{ fontSize: '0.85rem', opacity: 0.92 }}>
        {f ? `${f.homeTeam} ${f.scoreHome}–${f.scoreAway} ${f.awayTeam}` : 'Match'}
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>
        {result.profit > 0 ? '+' : ''}{result.profit} 🪙
      </div>
    </div>
  );
}

// ─── Signpost panel ─────────────────────────────────────────────────────────
// Bottom-center cheat sheet shown when the player stands near the
// signpost. Lists the keyboard controls + community emotes — works as
// a "tutorial" surface that's always available but never in the way.
function SignpostPanel() {
  return (
    <div style={signpostPanelStyle}>
      <div style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 6 }}>
        🗺️ Park guide
      </div>
      <div style={signpostRowStyle}><span>🕹️</span><span>stick walks · drag elsewhere orbits</span></div>
      <div style={signpostRowStyle}><span>⬆️👋💝</span><span>bottom-right buttons: jump · wave · praise</span></div>
      <div style={signpostRowStyle}><kbd style={kbdStyle}>WASD</kbd><span>walk · <kbd style={kbdStyle}>Space</kbd> jump</span></div>
      <div style={signpostRowStyle}><kbd style={kbdStyle}>E</kbd><span>compliment (+5 🪙) · <kbd style={kbdStyle}>F</kbd> wave</span></div>
      <div style={signpostRowStyle}><kbd style={kbdStyle}>G</kbd><span>enter portal (when near one)</span></div>
    </div>
  );
}

// ─── Expression bar ─────────────────────────────────────────────────────────
// Always-visible vertical strip of face buttons on the left edge. The
// selection rides the accessory CSV as a face-<expr> token through the
// normal equip pipeline, so every other player sees the new face.
type ExpressionKey = 'neutral' | 'happy' | 'surprised' | 'wink' | 'cool';
const EXPRESSION_OPTIONS: Array<{ key: ExpressionKey; emoji: string; label: string }> = [
  { key: 'neutral',   emoji: '😐', label: 'Neutral' },
  { key: 'happy',     emoji: '😄', label: 'Happy' },
  { key: 'surprised', emoji: '😮', label: 'Surprised' },
  { key: 'wink',      emoji: '😉', label: 'Wink' },
  { key: 'cool',      emoji: '😎', label: 'Cool' },
];
function ExpressionBar() {
  const [active, setActive] = useState<ExpressionKey>('neutral');
  return (
    <div style={expressionBarStyle}>
      {EXPRESSION_OPTIONS.map((e) => (
        <button
          key={e.key} type="button" title={e.label}
          onClick={() => { setActive(e.key); setAvatarExpression(e.key); }}
          style={e.key === active
            ? { ...expressionButtonStyle, ...expressionButtonActiveStyle }
            : expressionButtonStyle}
        >{e.emoji}</button>
      ))}
    </div>
  );
}

// ─── Soccer scoreboard ──────────────────────────────────────────────────────
// Always-visible scoreboard chip showing the current "North vs South"
// soccer-pitch tally. The score lives on the server (broadcast inside
// the `ball:state` channel); the HUD reads the latest values from the
// last goal event (server resets on every goal so scoreN/scoreS arrive
// fresh in each ball:goal). Hidden until the first goal is scored.
function SoccerScoreboard({
  goal,
}: {
  goal: GameStoreSnapshot['lastSoccerGoal'];
}) {
  if (!goal) return null;
  return (
    <div style={soccerScoreboardStyle}>
      <span style={soccerScoreboardLabelStyle}>⚽ Pitch</span>
      <span style={soccerScoreboardTallyStyle}>
        <span style={soccerScoreboardSideStyle}>N {goal.scoreN}</span>
        <span style={{ opacity: 0.4 }}>·</span>
        <span style={soccerScoreboardSideStyle}>{goal.scoreS} S</span>
      </span>
    </div>
  );
}

// ─── Goal banner ───────────────────────────────────────────────────────────
// Big "GOAL!" banner that fades in for ~2.6s after a goal is scored,
// then fades out. Different copy if YOU scored vs someone else.
function SoccerGoalBanner({
  goal,
}: {
  goal: GameStoreSnapshot['lastSoccerGoal'];
}) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!goal) return;
    const id = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(id);
  }, [goal?.at]);
  if (!goal) return null;
  const age = Date.now() - goal.at;
  const lifetimeMs = 2600;
  if (age > lifetimeMs) return null;
  // Fade-in 200ms / hold / fade-out last 500ms.
  const fadeIn = Math.min(1, age / 200);
  const fadeOut = Math.min(1, (lifetimeMs - age) / 500);
  const opacity = Math.min(fadeIn, fadeOut);
  return (
    <div style={{ ...soccerGoalBannerStyle, opacity }}>
      <div style={soccerGoalBannerTitleStyle}>
        ⚽ GOAL!
      </div>
      <div style={soccerGoalBannerSubtitleStyle}>
        {goal.mine
          ? <>Nice strike!</>
          : <><strong>{goal.scorerName}</strong> scored on the {goal.side === 'N' ? 'north' : 'south'} goal</>}
      </div>
      <div style={soccerGoalBannerScoreStyle}>
        N {goal.scoreN} · {goal.scoreS} S
      </div>
    </div>
  );
}

// (The old center-screen PortalPrompt is gone — portal proximity now
// surfaces the 🌀 Play button in ActionCluster, which performs the same
// redirect on tap; the G key in game.ts still works for desktop.)

function ChatPanel({
  net,
  chat,
  selfId,
}: {
  net: NetClient | undefined;
  chat: readonly { from: string; name: string; text: string; t: number }[];
  selfId: string;
}) {
  const [draft, setDraft] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Keep scrolled to bottom on new messages.
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [chat.length]);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || !net?.isOpen()) return;
    net.send('chat', { text: trimmed });
    setDraft('');
  };

  return (
    <div style={chatPanelStyle}>
      <div ref={feedRef} style={chatFeedStyle}>
        {chat.length === 0 ? (
          <div style={{ opacity: 0.4, fontSize: '0.78rem' }}>Say hi to the fairground →</div>
        ) : (
          chat.map((entry, i) => (
            <div key={`${entry.t}-${i}`} style={chatLineStyle}>
              <strong style={entry.from === selfId ? chatSelfNameStyle : chatNameStyle}>
                {entry.name}
              </strong>
              <span> {entry.text}</span>
            </div>
          ))
        )}
      </div>
      <div style={chatInputRowStyle}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Type a message…"
          maxLength={200}
          style={chatInputStyle}
        />
        <button onClick={submit} style={chatSendStyle}>Send</button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function itemsForStall(category: StallCategory): { kind: 'texture' | 'accessory'; items: Array<TextureItemDef | AccessoryItemDef> } {
  if (category === 'customize') {
    // The customize stall has no item list — the panel renders the editor
    // directly. Return an empty list so StallPanel's grid is suppressed.
    return { kind: 'texture', items: [] };
  }
  if (category === 'bodypaint' || category === 'shirt' || category === 'pants' || category === 'shoes') {
    return {
      kind: 'texture',
      items: WARDROBE_TEXTURE_ITEMS.filter((i) => i.slot === category),
    };
  }
  const socketKey = stallCategoryToSocket(category);
  return {
    kind: 'accessory',
    items: WARDROBE_ACCESSORY_ITEMS.filter((i) => i.socket === socketKey),
  };
}

function stallCategoryToSocket(c: StallCategory): string {
  switch (c) {
    case 'hat': return 'head_top';
    case 'glasses': return 'head_front';
    case 'scarf': return 'neck_front';
    case 'bag': return 'back_center';
    default: return '';
  }
}

function categoryLabel(c: StallCategory): string {
  switch (c) {
    case 'bodypaint': return 'Skin tones';
    case 'shirt': return 'Tops';
    case 'pants': return 'Bottoms';
    case 'shoes': return 'Footwear';
    case 'hat': return 'Hats';
    case 'glasses': return 'Eyewear';
    case 'scarf': return 'Scarves';
    case 'bag': return 'Bags';
    case 'customize': return 'Design your own';
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

// Compact single-row status chip — the only always-on element top-left.
const topBadgeStyle: CSSProperties = {
  position: 'absolute', top: 10, left: 12,
  display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8,
  padding: '0.3rem 0.6rem', borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#1a1a1d', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.78rem', lineHeight: 1.2,
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.06)',
};

// ─── Toggle rail + drawers + touch actions ──────────────────────────────────
const railStyle: CSSProperties = {
  position: 'absolute', top: 10, right: 10,
  display: 'flex', flexDirection: 'column', gap: 8,
  pointerEvents: 'auto',
};
const railButtonStyle: CSSProperties = {
  position: 'relative',
  width: 44, height: 44, borderRadius: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(0,0,0,0.08)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
  fontSize: '1.2rem', lineHeight: 1, padding: 0,
  cursor: 'pointer',
};
const railButtonActiveStyle: CSSProperties = {
  background: '#1a1a1d',
  borderColor: '#1a1a1d',
  boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
};
const railBadgeStyle: CSSProperties = {
  position: 'absolute', top: -5, right: -5,
  minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#c14444', color: '#fff',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.56rem', fontWeight: 700, whiteSpace: 'nowrap',
  pointerEvents: 'none',
};
// Drawer container left of the rail. bottom reserve (92px) keeps every
// drawer clear of the ActionCluster row. Scrolls when content is taller
// than a 375px-high phone allows (e.g. BettingPanel in BET_WINDOW phase).
const drawerStyle: CSSProperties = {
  position: 'absolute', top: 10, right: 62,
  maxHeight: 'calc(100% - 92px)',
  display: 'flex', flexDirection: 'column',
  overflowY: 'auto',
  touchAction: 'pan-y',
  pointerEvents: 'auto',
};
const actionClusterStyle: CSSProperties = {
  position: 'absolute', right: 12, bottom: 14,
  display: 'flex', flexDirection: 'row', alignItems: 'flex-end', gap: 10,
  pointerEvents: 'auto',
};
const actionButtonStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
  width: 54, height: 54, borderRadius: 16,
  background: 'rgba(20,24,36,0.62)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.22)',
  backdropFilter: 'blur(6px)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
  fontFamily: 'Inter, system-ui, sans-serif',
  cursor: 'pointer', userSelect: 'none', padding: 0,
  touchAction: 'none',
};
const actionButtonActiveStyle: CSSProperties = {
  background: 'rgba(230, 195, 74, 0.9)', color: '#1a1a1d',
  borderColor: '#e6c34a',
};
const actionButtonAccentStyle: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(58,134,52,0.92), rgba(34,98,30,0.92))',
  borderColor: 'rgba(255,255,255,0.35)',
};
const crowdPillStyle: CSSProperties = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '0.35rem 0.7rem', borderRadius: 999,
  background: 'rgba(255,255,255,0.85)',
  color: '#1a1a1d', fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.06)',
};

// Social prompts cluster — bottom-center, above chat. Non-interactive
// (pointerEvents: none) so it doesn't block clicks on stalls behind it.
const socialPanelStyle: CSSProperties = {
  position: 'absolute', bottom: 110, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', gap: 6,
  padding: '0.5rem 0.75rem', borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#1a1a1d', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.78rem', lineHeight: 1.3,
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.06)',
  minWidth: 220,
  alignItems: 'flex-start',
};
const socialHintStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const kbdStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  minWidth: 22, height: 22, padding: '0 6px', borderRadius: 6,
  background: '#1a1a1d', color: '#fff',
  fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem', fontWeight: 700,
  boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.35)',
};
// ─── Leaderboard styles ─────────────────────────────────────────────────────
// Drawer content — the wrapper in Hud owns position/width; this fills it.
const leaderboardPanelStyle: CSSProperties = {
  width: '100%',
  maxHeight: '100%',
  display: 'flex', flexDirection: 'column',
  padding: '0.8rem 1rem',
  borderRadius: 14,
  background: 'rgba(255,255,255,0.96)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif',
  boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
  border: '1px solid rgba(0,0,0,0.08)',
  pointerEvents: 'auto',
  overflow: 'hidden',
};
const leaderboardHeaderStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  paddingBottom: 8,
  borderBottom: '1px solid rgba(0,0,0,0.1)',
  fontSize: '0.95rem',
};
const leaderboardCloseStyle: CSSProperties = {
  background: 'transparent', border: 'none',
  fontSize: '1.1rem', cursor: 'pointer',
  color: '#1a1a1d', padding: '0 4px',
};
const leaderboardGroupsStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 12,
  padding: '10px 0',
  overflowY: 'auto',
  touchAction: 'pan-y',
};
const leaderboardGroupCardStyle: CSSProperties = {
  background: '#f7f4ee',
  borderRadius: 10,
  padding: '8px 10px',
  border: '1px solid rgba(0,0,0,0.06)',
};
const leaderboardGroupTitleStyle: CSSProperties = {
  fontSize: '0.82rem', fontWeight: 700,
  paddingBottom: 4,
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};
const leaderboardTableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.74rem',
  marginTop: 4,
};
const leaderboardThStyle: CSSProperties = {
  padding: '4px 2px',
  textAlign: 'center', fontWeight: 600,
  color: '#666',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};
const leaderboardThPointsStyle: CSSProperties = {
  ...leaderboardThStyle,
  color: '#3a6ea5',
};
const leaderboardTdStyle: CSSProperties = {
  padding: '4px 2px',
  textAlign: 'center',
};
const leaderboardTdPointsStyle: CSSProperties = {
  ...leaderboardTdStyle,
  fontWeight: 700, color: '#3a6ea5',
};
const leaderboardAdvanceRowStyle: CSSProperties = {
  background: 'rgba(58, 134, 52, 0.07)',
};
const leaderboardTeamCodeStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: 30,
  padding: '1px 4px',
  borderRadius: 3,
  background: '#1a1a1d',
  color: '#fff',
  fontSize: '0.66rem', fontWeight: 700,
  textAlign: 'center',
};
const leaderboardFooterStyle: CSSProperties = {
  borderTop: '1px solid rgba(0,0,0,0.08)',
  paddingTop: 6,
  fontSize: '0.7rem', opacity: 0.65,
  textAlign: 'center',
};

// ─── Betting panel styles ───────────────────────────────────────────────────
// Drawer content — wrapper owns position/width.
const bettingPanelStyle: CSSProperties = {
  width: '100%',
  display: 'flex', flexDirection: 'column', gap: 8,
  padding: '0.7rem 0.85rem', borderRadius: 14,
  background: 'rgba(255,255,255,0.92)',
  color: '#1a1a1d', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.78rem',
  pointerEvents: 'auto', userSelect: 'none',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
};
const bettingHeaderStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2,
  paddingBottom: 4,
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};
const liveScoreStyle: CSSProperties = {
  textAlign: 'center', fontSize: '1.4rem', fontWeight: 800,
  padding: '4px 0',
  color: '#c14444',
};
const bettingCampsStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
};
const bettingCampButtonStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  padding: '8px 4px', borderRadius: 8,
  background: '#f1eee5',
  border: '1px solid rgba(0,0,0,0.1)',
  color: '#1a1a1d',
  fontFamily: 'inherit',
};
const bettingCampMineStyle: CSSProperties = {
  background: '#3a6ea5',
  color: '#fff',
  borderColor: '#3a6ea5',
};
const bettingCampWonStyle: CSSProperties = {
  background: '#3a8634',
  color: '#fff',
  borderColor: '#3a8634',
};
const bettingStakeRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
};
const bettingStakeButtonStyle: CSSProperties = {
  flex: 1,
  padding: '5px 0', borderRadius: 6,
  background: '#e8e2d4',
  border: '1px solid rgba(0,0,0,0.08)',
  color: '#1a1a1d',
  fontFamily: 'inherit', fontSize: '0.72rem', fontWeight: 600,
  cursor: 'pointer',
};
const bettingStakeButtonActiveStyle: CSSProperties = {
  background: '#1a1a1d',
  color: '#fff',
  borderColor: '#1a1a1d',
};
const bettingMyBetStyle: CSSProperties = {
  textAlign: 'center', fontSize: '0.75rem', opacity: 0.85,
  paddingTop: 4,
  borderTop: '1px dashed rgba(0,0,0,0.15)',
};
// Toast slots are staggered fixed offsets (goal banner at 44, bet toast at
// 170) so simultaneous toasts stack instead of covering each other on a
// 375px-tall landscape phone.
const betToastStyle: CSSProperties = {
  position: 'absolute', top: 170, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  padding: '1.1rem 1.6rem', borderRadius: 18,
  color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(10px)',
  boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.2)',
  animation: 'fadeIn 0.3s',
};
const betToastWonStyle: CSSProperties = {
  background: 'rgba(58, 134, 52, 0.92)',
};
const betToastLostStyle: CSSProperties = {
  background: 'rgba(193, 68, 68, 0.92)',
};
const betToastEvenStyle: CSSProperties = {
  background: 'rgba(60, 60, 80, 0.92)',
};

// Compact controls cheat-sheet, anchored top-left under the status chip —
// the only free corner at 375px height (joystick owns bottom-left, drawers
// own the right, toasts own top-center).
const signpostPanelStyle: CSSProperties = {
  position: 'absolute', top: 52, left: 12,
  display: 'flex', flexDirection: 'column', gap: 3,
  padding: '0.5rem 0.7rem', borderRadius: 12,
  background: 'rgba(244, 235, 214, 0.96)',
  color: '#3a2410', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.72rem',
  pointerEvents: 'none', userSelect: 'none',
  border: '2px solid #7a5836',
  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  maxWidth: 250,
};
const signpostRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
};

// Horizontal emote strip — drawer content (wrapper owns position).
const expressionBarStyle: CSSProperties = {
  display: 'flex', flexDirection: 'row', gap: 6,
  padding: '0.4rem', borderRadius: 999,
  background: 'rgba(20, 24, 36, 0.62)',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(255,255,255,0.16)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.3)',
  pointerEvents: 'auto',
};
const expressionButtonStyle: CSSProperties = {
  width: 38, height: 38, borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.08)',
  fontSize: '1.15rem', cursor: 'pointer', lineHeight: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 0,
};
const expressionButtonActiveStyle: CSSProperties = {
  background: 'rgba(230, 195, 74, 0.85)',
  border: '1px solid #e6c34a',
};
const drawToggleStyle: CSSProperties = {
  padding: '0.35rem 0.7rem', borderRadius: 8, cursor: 'pointer',
  border: '1px solid rgba(0,0,0,0.25)', background: '#f3ecd9',
  fontSize: '0.78rem', fontWeight: 700,
};
const drawCanvasStyle: CSSProperties = {
  width: 240, height: 240, display: 'block', marginTop: 6,
  borderRadius: 8, border: '1px solid rgba(0,0,0,0.3)',
  cursor: 'crosshair', touchAction: 'none',
  imageRendering: 'pixelated',
};
const drawClearStyle: CSSProperties = {
  marginLeft: 6, padding: '0.2rem 0.55rem', borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.25)', background: '#fff',
  fontSize: '0.7rem', cursor: 'pointer',
};

const soccerScoreboardStyle: CSSProperties = {
  position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', alignItems: 'center', gap: 14,
  padding: '0.45rem 1.0rem', borderRadius: 999,
  background: 'rgba(20, 24, 36, 0.78)',
  color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.18)',
  boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
  fontSize: '0.85rem',
};
const soccerScoreboardLabelStyle: CSSProperties = {
  fontWeight: 700, opacity: 0.85, fontSize: '0.78rem',
};
const soccerScoreboardTallyStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
};
const soccerScoreboardSideStyle: CSSProperties = {
  fontWeight: 800, color: '#e6c34a',
};

const soccerGoalBannerStyle: CSSProperties = {
  position: 'absolute', top: 44, left: '50%', transform: 'translateX(-50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
  padding: '1.1rem 1.8rem', borderRadius: 20,
  background: 'linear-gradient(135deg, rgba(58,134,52,0.92), rgba(34,98,30,0.92))',
  color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(12px)',
  border: '2px solid rgba(255,255,255,0.35)',
  boxShadow: '0 16px 42px rgba(0,0,0,0.45)',
  transition: 'opacity 0.18s ease',
  textAlign: 'center',
};
const soccerGoalBannerTitleStyle: CSSProperties = {
  fontSize: '2.4rem', fontWeight: 900, letterSpacing: '0.08em',
  textShadow: '0 2px 8px rgba(0,0,0,0.5)',
};
const soccerGoalBannerSubtitleStyle: CSSProperties = {
  fontSize: '0.95rem', opacity: 0.95,
};
const soccerGoalBannerScoreStyle: CSSProperties = {
  fontSize: '0.82rem', opacity: 0.85,
  letterSpacing: '0.1em', fontWeight: 700,
};

const crowdBarOuterStyle: CSSProperties = {
  width: 140, height: 6, borderRadius: 3,
  background: 'rgba(0,0,0,0.12)', overflow: 'hidden',
};
const crowdBarFillStyle: CSSProperties = {
  height: '100%',
  background: 'linear-gradient(90deg, #f5b042, #e8c84a)',
  transition: 'width 0.2s linear',
};

// Opens via the 🛍️ Browse action button (drawer-exclusive). Anchored left
// of the toggle rail, stopping above the ActionCluster row.
const stallPanelStyle: CSSProperties = {
  position: 'absolute', top: 10, right: 62, bottom: 78,
  width: 'min(340px, 48vw)',
  display: 'flex', flexDirection: 'column', gap: 10,
  padding: '0.75rem',
  borderRadius: 16,
  borderTop: '4px solid #c14444',
  background: 'rgba(255, 255, 255, 0.95)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'auto', userSelect: 'none',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 12px 36px rgba(20, 20, 30, 0.14)',
  overflow: 'hidden',
};

const stallHeaderStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2,
  paddingBottom: 6, borderBottom: '1px solid rgba(0,0,0,0.08)',
};

const stallGridStyle: CSSProperties = {
  flex: 1,
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
  gap: 8, overflowY: 'auto', paddingRight: 4,
  touchAction: 'pan-y',
};

const itemTileStyle: CSSProperties = {
  position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
  gap: 6, padding: '0.5rem', borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.08)', background: '#fafafa',
  color: '#1a1a1d', fontSize: '0.72rem', cursor: 'pointer', minHeight: 90,
};

const itemTileEquippedStyle: CSSProperties = {
  borderColor: '#1a1a1d', background: '#f0ecea',
  boxShadow: 'inset 0 0 0 2px #1a1a1d',
};

const swatchStyle: CSSProperties = {
  display: 'block', width: '100%', height: 38,
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)',
};

const itemLabelStyle: CSSProperties = { textAlign: 'center', lineHeight: 1.2 };

const equippedDotStyle: CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  width: 18, height: 18, borderRadius: 9,
  background: '#1a1a1d', color: '#fff', fontSize: '0.7rem',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const priceDotStyle: CSSProperties = {
  position: 'absolute', top: 4, right: 4,
  padding: '2px 6px', borderRadius: 8,
  background: '#fff7d9', color: '#7a5a00',
  fontSize: '0.62rem', fontWeight: 600,
  border: '1px solid #e8c84a',
  whiteSpace: 'nowrap',
};

const itemTileLockedStyle: CSSProperties = {
  opacity: 0.55, cursor: 'not-allowed',
};

const coinBadgeStyle: CSSProperties = {
  padding: '2px 10px', borderRadius: 10,
  background: '#fff7d9', color: '#7a5a00',
  border: '1px solid #e8c84a',
  fontSize: '0.72rem', fontWeight: 700,
  letterSpacing: '0.02em',
};

// Drawer content — wrapper owns position/size; feed flexes to fill.
const chatPanelStyle: CSSProperties = {
  width: '100%', height: '100%',
  display: 'flex', flexDirection: 'column', gap: 6,
  padding: '0.6rem',
  borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.82rem',
  pointerEvents: 'auto',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.08)',
  boxShadow: '0 8px 24px rgba(20,20,30,0.12)',
};

const chatFeedStyle: CSSProperties = {
  flex: 1, minHeight: 60, overflowY: 'auto',
  // The shell sets touch-action:none globally; re-enable vertical pan so
  // thumb-scrolling the feed works on phones.
  touchAction: 'pan-y',
  display: 'flex', flexDirection: 'column', gap: 2,
  paddingBottom: 4, borderBottom: '1px solid rgba(0,0,0,0.06)',
};

const chatLineStyle: CSSProperties = { fontSize: '0.82rem', lineHeight: 1.3 };
const chatNameStyle: CSSProperties = { color: '#3a6ea5', marginRight: 4 };
const chatSelfNameStyle: CSSProperties = { color: '#c14444', marginRight: 4 };

const chatInputRowStyle: CSSProperties = { display: 'flex', gap: 6 };
const chatInputStyle: CSSProperties = {
  flex: 1, padding: '0.35rem 0.55rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)',
  background: '#fff', color: '#1a1a1d', fontSize: '0.82rem',
  fontFamily: 'inherit',
};
const chatSendStyle: CSSProperties = {
  padding: '0.35rem 0.85rem',
  borderRadius: 6, border: 'none',
  background: '#1a1a1d', color: '#fff', fontSize: '0.78rem', cursor: 'pointer',
};

// ─── Customize panel styles ─────────────────────────────────────────────────
const presetRowStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  paddingBottom: 6,
  borderBottom: '1px dashed rgba(0,0,0,0.08)',
};
const presetLabelStyle: CSSProperties = {
  fontSize: '0.7rem', opacity: 0.6,
};
const presetChipsStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 4,
};
const presetChipStyle: CSSProperties = {
  padding: '0.2rem 0.5rem', fontSize: '0.68rem',
  borderRadius: 999,
  border: '1px solid rgba(0,0,0,0.18)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer',
};

const personalizeRowStyle: CSSProperties = {
  display: 'flex', gap: 8,
  paddingBottom: 6,
  borderBottom: '1px dashed rgba(0,0,0,0.08)',
};
const personalizeLabelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 2,
};
const fieldLabelStyle: CSSProperties = {
  fontSize: '0.66rem', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const personalizeNumberInputStyle: CSSProperties = {
  width: 64, padding: '0.3rem 0.4rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)',
  background: '#fff', color: '#1a1a1d', fontSize: '0.9rem', fontWeight: 700, textAlign: 'center',
};
const personalizeNameInputStyle: CSSProperties = {
  flex: 1, padding: '0.3rem 0.5rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)',
  background: '#fff', color: '#1a1a1d', fontSize: '0.82rem',
  textTransform: 'uppercase', letterSpacing: '0.03em',
};

const slotPickerRowStyle: CSSProperties = {
  display: 'flex', gap: 4, paddingBottom: 6,
  borderBottom: '1px solid rgba(0,0,0,0.06)',
};
const slotPickerButtonStyle: CSSProperties = {
  flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.74rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.16)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer', textAlign: 'center',
};
const slotPickerButtonActiveStyle: CSSProperties = {
  borderColor: '#1a1a1d', background: '#1a1a1d', color: '#fff',
};

const customToggleStyle: CSSProperties = {
  alignSelf: 'flex-start', marginTop: 4,
  padding: '0.2rem 0.6rem', fontSize: '0.7rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.2)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer',
};

const customPanelStyle: CSSProperties = {
  flex: 1, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 4,
};

const customPreviewRowStyle: CSSProperties = {
  display: 'flex', gap: 10, alignItems: 'center',
};

const previewCanvasStyle: CSSProperties = {
  width: 160, height: 160, borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.12)',
  imageRendering: 'crisp-edges',
};

const panelGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4,
  flex: 1,
};

const panelButtonStyle: CSSProperties = {
  padding: '0.4rem 0.5rem', fontSize: '0.72rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.16)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer', textAlign: 'center',
};
const panelButtonActiveStyle: CSSProperties = {
  borderColor: '#1a1a1d', background: '#1a1a1d', color: '#fff',
};

const kindRowStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 4,
};
const kindChipStyle: CSSProperties = {
  padding: '0.25rem 0.5rem', fontSize: '0.7rem',
  borderRadius: 999, border: '1px solid rgba(0,0,0,0.14)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer',
};
const kindChipActiveStyle: CSSProperties = {
  borderColor: '#1a1a1d', background: '#1a1a1d', color: '#fff',
};

const paletteRowStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
};
const paletteLabelStyle: CSSProperties = {
  fontSize: '0.7rem', opacity: 0.6, width: 14, textAlign: 'center',
};
const swatchDotStyle: CSSProperties = {
  width: 22, height: 22, borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.14)',
  cursor: 'pointer', padding: 0,
};

const customActionsRowStyle: CSSProperties = {
  display: 'flex', gap: 6, alignItems: 'center',
};
const customPrimaryButtonStyle: CSSProperties = {
  padding: '0.4rem 0.7rem', fontSize: '0.78rem',
  borderRadius: 6, border: 'none',
  background: '#1a1a1d', color: '#fff', cursor: 'pointer',
};
const customSecondaryButtonStyle: CSSProperties = {
  padding: '0.4rem 0.7rem', fontSize: '0.78rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)',
  background: '#fafafa', color: '#1a1a1d', cursor: 'pointer',
};
const customInputStyle: CSSProperties = {
  flex: 1, padding: '0.3rem 0.5rem',
  borderRadius: 6, border: '1px solid rgba(0,0,0,0.18)',
  background: '#fff', color: '#1a1a1d', fontSize: '0.78rem',
};

const savedLooksStyle: CSSProperties = {
  marginTop: 4, paddingTop: 6,
  borderTop: '1px solid rgba(0,0,0,0.08)',
};
const savedLooksGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6,
};
const savedLookTileStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4,
  padding: 6, borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.1)', background: '#fafafa',
};
const savedLookCanvasStyle: CSSProperties = {
  width: '100%', height: 56, borderRadius: 4,
  border: '1px solid rgba(0,0,0,0.08)',
  imageRendering: 'crisp-edges',
};
const savedLookNameStyle: CSSProperties = {
  fontSize: '0.7rem', textAlign: 'center',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
};
const savedLookActionsStyle: CSSProperties = {
  display: 'flex', gap: 3, justifyContent: 'space-between',
};
const savedLookButtonStyle: CSSProperties = {
  flex: 1, padding: '0.2rem 0',
  fontSize: '0.66rem',
  borderRadius: 4, border: '1px solid rgba(0,0,0,0.14)',
  background: '#fff', color: '#1a1a1d', cursor: 'pointer',
};
