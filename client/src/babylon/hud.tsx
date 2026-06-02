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

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { Phase } from '@rezona/core/3d';
import {
  getGameSnapshot,
  hydratePresetsFromStorage,
  subscribeGameStore,
  toggleAccessoryItem,
  toggleTextureItem,
  type GameStoreSnapshot,
} from './store';
import {
  WARDROBE_ACCESSORY_ITEMS,
  WARDROBE_TEXTURE_ITEMS,
  type AccessoryItemDef,
  type TextureItemDef,
} from './items';
import { patternSwatchCss } from './textures';
import { STALL_LAYOUT, type StallCategory, type StallDef } from './entities';
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
    if (stallItems.kind === 'texture') toggleTextureItem(item.id);
    else toggleAccessoryItem(item.id);
  };

  // LLM-EXTENSION:HUD — Fairground multiplayer overlay. Top-left badge shows the room code + nearby-stall hint. The stall-scoped browser only appears when the local avatar is within STALL_INTERACT_RADIUS of a stall — it filters the wardrobe to that stall's category (Skin / Shirts / Pants / Shoes / Hats / Glasses / Scarves / Bags) and toggles items on the local outfit, which game.ts forwards to net.send('equip'). Bottom-left chat panel renders ChatEntry feed from store + a text input that calls net.send('chat'). All multiplayer interaction is funneled through this component.
  // DO NOT REMOVE the LLM-EXTENSION:HUD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return (
    <>
      <div style={topBadgeStyle}>
        <strong>Fairground</strong>
        <span style={{ opacity: 0.75, fontSize: '0.72rem' }}>
          {snap.roomCode ? `Room: ${snap.roomCode}` : snap.message}
        </span>
        {stall ? (
          <span style={stallHintStyle}>📦 {stall.label} — browse →</span>
        ) : (
          <span style={hintStyle}>Walk to a stall to browse</span>
        )}
      </div>

      {stall ? (
        <StallPanel
          stall={stall}
          items={stallItems.items}
          isEquipped={(id) =>
            equippedTextureIds.has(id) || equippedAccessoryIds.has(id)
          }
          onItemClick={handleItemClick}
        />
      ) : null}

      <ChatPanel net={net} chat={snap.chat} selfId={snap.selfId} />
    </>
  );
}

// ─── Stall panel ────────────────────────────────────────────────────────────

function StallPanel({
  stall,
  items,
  isEquipped,
  onItemClick,
}: {
  stall: StallDef;
  items: Array<TextureItemDef | AccessoryItemDef>;
  isEquipped: (id: string) => boolean;
  onItemClick: (item: TextureItemDef | AccessoryItemDef) => void;
}) {
  return (
    <div style={{ ...stallPanelStyle, borderTopColor: stall.color }}>
      <div style={stallHeaderStyle}>
        <strong>{stall.label}</strong>
        <span style={{ opacity: 0.6, fontSize: '0.72rem' }}>{categoryLabel(stall.category)}</span>
      </div>
      <div style={stallGridStyle}>
        {items.map((item) => {
          const equipped = isEquipped(item.id);
          return (
            <button
              key={item.id}
              style={equipped ? { ...itemTileStyle, ...itemTileEquippedStyle } : itemTileStyle}
              onClick={() => onItemClick(item)}
              aria-pressed={equipped}
            >
              <span style={{ ...swatchStyle, background: patternSwatchCss(item.swatch) }} />
              <span style={itemLabelStyle}>{item.label}</span>
              {equipped ? <span style={equippedDotStyle}>✓</span> : null}
            </button>
          );
        })}
        {items.length === 0 ? <div style={{ opacity: 0.5, padding: 8 }}>(empty)</div> : null}
      </div>
    </div>
  );
}

// ─── Chat panel ─────────────────────────────────────────────────────────────

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
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const topBadgeStyle: CSSProperties = {
  position: 'absolute', top: 12, left: 12,
  display: 'flex', flexDirection: 'column', gap: 2,
  padding: '0.55rem 0.8rem', borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#1a1a1d', fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.8rem', lineHeight: 1.3,
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.06)',
};

const hintStyle: CSSProperties = { opacity: 0.55, fontSize: '0.7rem', marginTop: 4 };
const stallHintStyle: CSSProperties = { color: '#1a5a1a', fontSize: '0.78rem', marginTop: 4, fontWeight: 600 };

const stallPanelStyle: CSSProperties = {
  position: 'absolute', top: 12, right: 12, bottom: '40%',
  width: 'min(340px, 42vw)',
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

const chatPanelStyle: CSSProperties = {
  position: 'absolute', bottom: 12, left: 12,
  width: 'min(340px, 42vw)',
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
  maxHeight: 160, minHeight: 60, overflowY: 'auto',
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
