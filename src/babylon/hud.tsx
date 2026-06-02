// ══════════════════════════════════════════════
// Wardrobe HUD — DOM overlay above the Babylon canvas.
// Reads outfit state via subscribeGameStore; writes via toggleTextureItem /
// toggleAccessoryItem / randomizeOutfit / resetOutfit / savePreset / loadPreset.
// Never touches Babylon scene APIs directly.
// ══════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { Phase } from '@rezona/core/3d';
import {
  getGameSnapshot,
  hydratePresetsFromStorage,
  loadPreset,
  randomizeOutfit,
  resetOutfit,
  savePreset,
  subscribeGameStore,
  toggleAccessoryItem,
  toggleTextureItem,
  type GameStoreSnapshot,
} from './store';
import {
  WARDROBE_ACCESSORY_ITEMS,
  WARDROBE_TEXTURE_ITEMS,
  type AccessoryItemDef,
  type AccessorySocket,
  type TextureItemDef,
  type TextureSlot,
} from './items';
import { patternSwatchCss } from './textures';

interface HudProps {
  phaseRef: MutableRefObject<Phase>;
}

type TextureCategory = { kind: 'texture'; key: TextureSlot; label: string };
type AccessoryCategory = { kind: 'accessory'; key: AccessorySocket; label: string };
type Category = TextureCategory | AccessoryCategory;

const CATEGORIES: Category[] = [
  { kind: 'texture', key: 'bodypaint', label: 'Skin' },
  { kind: 'texture', key: 'shirt', label: 'Shirts' },
  { kind: 'texture', key: 'pants', label: 'Pants' },
  { kind: 'texture', key: 'shoes', label: 'Shoes' },
  { kind: 'accessory', key: 'head_top', label: 'Hats' },
  { kind: 'accessory', key: 'head_front', label: 'Glasses' },
  { kind: 'accessory', key: 'neck_front', label: 'Scarves' },
  { kind: 'accessory', key: 'back_center', label: 'Bags' },
];

export function Hud({ phaseRef: _phaseRef }: HudProps) {
  const [snap, setSnap] = useState<GameStoreSnapshot>(() => getGameSnapshot());
  const [category, setCategory] = useState<Category>(CATEGORIES[1]);

  useEffect(() => {
    hydratePresetsFromStorage();
    return subscribeGameStore(setSnap);
  }, []);

  const items = useMemo(() => {
    if (category.kind === 'texture') {
      return WARDROBE_TEXTURE_ITEMS.filter((i) => i.slot === category.key);
    }
    return WARDROBE_ACCESSORY_ITEMS.filter((i) => i.socket === category.key);
  }, [category]);

  const equippedTextureIds = new Set(snap.outfit.textureItemIds);
  const equippedAccessoryIds = new Set(snap.outfit.accessoryItemIds);

  const handleItemClick = (item: TextureItemDef | AccessoryItemDef) => {
    if (category.kind === 'texture') toggleTextureItem(item.id);
    else toggleAccessoryItem(item.id);
  };

  // LLM-EXTENSION:HUD — Wardrobe browser. Category tabs at top (Skin / Shirts / Pants / Shoes / Hats / Glasses / Scarves / Bags), an item grid below with color-swatch tiles, and a footer with Random / Reset + three preset save/load slots. All state lives in store.ts; this component is a read+dispatch view.
  // DO NOT REMOVE the LLM-EXTENSION:HUD tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return (
    <>
      <div style={topBadgeStyle}>
        <strong>Dressing Room</strong>
        <span style={{ opacity: 0.7 }}>{snap.message}</span>
      </div>

      <div style={wardrobePanelStyle}>
        <div style={tabBarStyle}>
          {CATEGORIES.map((cat) => {
            const active = category.kind === cat.kind && category.key === cat.key;
            return (
              <button
                key={`${cat.kind}-${cat.key}`}
                style={active ? { ...tabButtonStyle, ...tabButtonActiveStyle } : tabButtonStyle}
                onClick={() => setCategory(cat)}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <div style={itemGridStyle}>
          {items.map((item) => {
            const equipped = category.kind === 'texture'
              ? equippedTextureIds.has(item.id)
              : equippedAccessoryIds.has(item.id);
            return (
              <button
                key={item.id}
                style={equipped ? { ...itemTileStyle, ...itemTileEquippedStyle } : itemTileStyle}
                onClick={() => handleItemClick(item)}
                aria-pressed={equipped}
              >
                <span style={{ ...swatchStyle, background: patternSwatchCss(item.swatch) }} />
                <span style={itemLabelStyle}>{item.label}</span>
                {equipped ? <span style={equippedDotStyle}>✓</span> : null}
              </button>
            );
          })}
        </div>

        <div style={actionRowStyle}>
          <button style={primaryButtonStyle} onClick={() => randomizeOutfit()}>Random</button>
          <button style={secondaryButtonStyle} onClick={() => resetOutfit()}>Reset</button>
        </div>

        <div style={presetSectionStyle}>
          <span style={presetLabelStyle}>Presets</span>
          {[1, 2, 3].map((n) => {
            const slot = n as 1 | 2 | 3;
            const filled = Boolean(snap.presets[slot]);
            return (
              <div key={n} style={presetRowStyle}>
                <span style={presetSlotLabelStyle}>{n}</span>
                <button
                  style={filled ? smallButtonStyle : { ...smallButtonStyle, ...disabledButtonStyle }}
                  onClick={() => loadPreset(slot)}
                  disabled={!filled}
                >
                  Load
                </button>
                <button style={smallButtonStyle} onClick={() => savePreset(slot)}>
                  Save
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const topBadgeStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '0.55rem 0.8rem',
  borderRadius: 12,
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.8rem',
  lineHeight: 1.3,
  pointerEvents: 'none',
  userSelect: 'none',
  backdropFilter: 'blur(8px)',
  border: '1px solid rgba(0,0,0,0.06)',
};

const wardrobePanelStyle: CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  bottom: 12,
  width: 'min(360px, 44vw)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '0.75rem',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.93)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: '0.85rem',
  pointerEvents: 'auto',
  userSelect: 'none',
  backdropFilter: 'blur(12px)',
  border: '1px solid rgba(0,0,0,0.06)',
  boxShadow: '0 12px 36px rgba(20, 20, 30, 0.14)',
  overflow: 'hidden',
};

const tabBarStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  paddingBottom: 8,
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};

const tabButtonStyle: CSSProperties = {
  padding: '0.35rem 0.65rem',
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'transparent',
  color: '#1a1a1d',
  fontSize: '0.78rem',
  cursor: 'pointer',
};

const tabButtonActiveStyle: CSSProperties = {
  background: '#1a1a1d',
  color: '#fff',
};

const itemGridStyle: CSSProperties = {
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
  gap: 8,
  overflowY: 'auto',
  paddingRight: 4,
};

const itemTileStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  padding: '0.5rem',
  borderRadius: 10,
  border: '1px solid rgba(0,0,0,0.08)',
  background: '#fafafa',
  color: '#1a1a1d',
  fontSize: '0.72rem',
  cursor: 'pointer',
  minHeight: 96,
};

const itemTileEquippedStyle: CSSProperties = {
  borderColor: '#1a1a1d',
  background: '#f0ecea',
  boxShadow: 'inset 0 0 0 2px #1a1a1d',
};

const swatchStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: 42,
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.08)',
};

const itemLabelStyle: CSSProperties = {
  textAlign: 'center',
  lineHeight: 1.2,
};

const equippedDotStyle: CSSProperties = {
  position: 'absolute',
  top: 4,
  right: 4,
  width: 18,
  height: 18,
  borderRadius: 9,
  background: '#1a1a1d',
  color: '#fff',
  fontSize: '0.7rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const actionRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const primaryButtonStyle: CSSProperties = {
  flex: 1,
  padding: '0.55rem 0.75rem',
  borderRadius: 8,
  border: 'none',
  background: '#1a1a1d',
  color: '#fff',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const secondaryButtonStyle: CSSProperties = {
  flex: 1,
  padding: '0.55rem 0.75rem',
  borderRadius: 8,
  border: '1px solid rgba(0,0,0,0.18)',
  background: '#fff',
  color: '#1a1a1d',
  fontSize: '0.82rem',
  cursor: 'pointer',
};

const presetSectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 8,
  borderTop: '1px solid rgba(0,0,0,0.08)',
};

const presetLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  opacity: 0.7,
};

const presetRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const presetSlotLabelStyle: CSSProperties = {
  width: 14,
  textAlign: 'center',
  fontSize: '0.78rem',
  opacity: 0.6,
};

const smallButtonStyle: CSSProperties = {
  flex: 1,
  padding: '0.32rem 0.5rem',
  borderRadius: 6,
  border: '1px solid rgba(0,0,0,0.12)',
  background: '#fff',
  color: '#1a1a1d',
  fontSize: '0.72rem',
  cursor: 'pointer',
};

const disabledButtonStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'not-allowed',
};
