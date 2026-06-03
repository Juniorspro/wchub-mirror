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
  deleteLook,
  equipCustomDesign,
  getGameSnapshot,
  hydratePresetsFromStorage,
  saveLook,
  subscribeGameStore,
  toggleAccessoryItem,
  toggleTextureItem,
  type CustomSlot,
  type GameStoreSnapshot,
  type SavedLook,
} from './store';
import {
  WARDROBE_ACCESSORY_ITEMS,
  WARDROBE_TEXTURE_ITEMS,
  type AccessoryItemDef,
  type TextureItemDef,
} from './items';
import { drawDesignPanelsSync, patternSwatchCss, uniformDesign, type GarmentDesign, type Pattern } from './textures';
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
          savedLooks={snap.savedLooks}
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
  savedLooks,
}: {
  stall: StallDef;
  items: Array<TextureItemDef | AccessoryItemDef>;
  isEquipped: (id: string) => boolean;
  onItemClick: (item: TextureItemDef | AccessoryItemDef) => void;
  savedLooks: readonly SavedLook[];
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

  // Re-draw the preview canvas whenever the design changes.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawDesignPanelsSync(ctx, design, c.width);
  }, [design]);

  // For shoes, hide the per-panel diagram and apply the active pattern to
  // ALL four panels — the shoe sphere UV doesn't split into quadrants.
  const isShoes = slot === 'shoes';
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
  const onLoad = (l: SavedLook) => { setDesign(l.design); };

  return (
    <div style={customPanelStyle}>
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

// ─── Customize panel styles ─────────────────────────────────────────────────
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
