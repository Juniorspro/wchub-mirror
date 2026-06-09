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

  // LLM-EXTENSION:HUD — Fairground multiplayer overlay. Top-left badge shows the room code + nearby-stall hint. The stall-scoped browser only appears when the local avatar is within STALL_INTERACT_RADIUS of a stall — it filters the wardrobe to that stall's category (Skin / Shirts / Pants / Shoes / Hats / Glasses / Scarves / Bags) and toggles items on the local outfit, which game.ts forwards to net.send('equip'). Bottom-left chat panel renders ChatEntry feed from store + a text input that calls net.send('chat'). All multiplayer interaction is funneled through this component.
  // DO NOT REMOVE the LLM-EXTENSION:HUD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return (
    <>
      <div style={topBadgeStyle}>
        <strong>Fairground</strong>
        <span style={coinBadgeStyle} title="Coins — earn the daily bonus by checking in every 24h">
          🪙 {snap.balance}
        </span>
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
          balance={snap.balance}
        />
      ) : null}

      <SocialPanel
        nearestName={snap.nearestOtherName}
        crowdCount={snap.crowdCount}
        crowdTimer={snap.crowdTimer}
      />

      {snap.nearbyPortalLabel ? (
        <PortalPrompt label={snap.nearbyPortalLabel} />
      ) : null}

      <BettingPanel net={net} fixtures={snap.bettingFixtures} myBets={snap.myBets} balance={snap.balance} />
      <LeaderboardWidget standings={snap.bettingStandings} />
      {snap.lastBetResult ? (
        <BetResultToast result={snap.lastBetResult} fixtures={snap.bettingFixtures} />
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

// ─── Leaderboard widget ─────────────────────────────────────────────────────
// A small "🏆 Standings" button on the right edge. Click to expand a
// full-height panel listing every group of the 2026 World Cup with each
// team's MP / W / D / L / GD / Pts. Daily-refreshed on the server.
function LeaderboardWidget({
  standings,
}: {
  standings: ReadonlyArray<import('./store').GroupStandingSnapshot>;
}) {
  const [open, setOpen] = useState(false);
  if (standings.length === 0) {
    // Hide the button entirely until the first standings broadcast lands —
    // avoids showing an empty panel during connect.
    return null;
  }
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...leaderboardButtonStyle, ...(open ? leaderboardButtonActiveStyle : {}) }}
        title="World Cup standings (daily)"
      >
        🏆 Standings
      </button>
      {open ? (
        <div style={leaderboardPanelStyle}>
          <div style={leaderboardHeaderStyle}>
            <strong>2026 FIFA World Cup — Group Stage</strong>
            <button onClick={() => setOpen(false)} style={leaderboardCloseStyle} title="Close">✕</button>
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
      ) : null}
    </>
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
  const odds = (campPool: number): string => {
    if (campPool <= 0 || totalPool <= 0) return '—';
    const mult = totalPool / campPool;
    return `×${mult.toFixed(2)}`;
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
      <div style={bettingCampsStyle}>
        {(['HOME', 'DRAW', 'AWAY'] as const).map((camp) => {
          const label = camp === 'HOME' ? primary.homeCode : camp === 'AWAY' ? primary.awayCode : 'DRAW';
          const pool = camp === 'HOME' ? primary.poolHome : camp === 'AWAY' ? primary.poolAway : primary.poolDraw;
          const count = camp === 'HOME' ? primary.countHome : camp === 'AWAY' ? primary.countAway : primary.countDraw;
          const isMine = myBet?.camp === camp;
          const disabled = primary.phase !== 'BET_WINDOW' || !!myBet || balance < stake;
          const won = primary.phase === 'RESOLVED' && primary.result === camp;
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
              <div style={{ fontSize: '0.7rem', opacity: 0.85 }}>{odds(pool)}</div>
              <div style={{ fontSize: '0.65rem', opacity: 0.7 }}>{count} 🪙{pool}</div>
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

// ─── Portal prompt ──────────────────────────────────────────────────────────
// Center-screen call to action when the player stands near a stadium
// portal gate. Press G to leave this game and jump to the linked one.
// game.ts wires the actual redirect — this just paints the prompt.
function PortalPrompt({ label }: { label: string }) {
  return (
    <div style={portalPromptStyle}>
      <div style={portalPromptLabelStyle}>🎮 {label}</div>
      <div style={portalPromptCtaStyle}>
        <kbd style={kbdStyle}>G</kbd>
        <span>play this game</span>
      </div>
    </div>
  );
}

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
const leaderboardButtonStyle: CSSProperties = {
  position: 'absolute', top: 70, right: 12,
  padding: '8px 12px', borderRadius: 12,
  background: 'rgba(255,255,255,0.92)',
  color: '#1a1a1d',
  fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.82rem', fontWeight: 700,
  border: '1px solid rgba(0,0,0,0.08)',
  backdropFilter: 'blur(8px)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
  cursor: 'pointer',
  pointerEvents: 'auto',
};
const leaderboardButtonActiveStyle: CSSProperties = {
  background: '#1a1a1d',
  color: '#fff',
  borderColor: '#1a1a1d',
};
const leaderboardPanelStyle: CSSProperties = {
  position: 'absolute', top: 116, right: 12,
  width: 'min(680px, 92vw)',
  maxHeight: 'calc(100vh - 200px)',
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
const bettingPanelStyle: CSSProperties = {
  position: 'absolute', bottom: 12, right: 12,
  width: 280,
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
const betToastStyle: CSSProperties = {
  position: 'absolute', top: '20%', left: '50%', transform: 'translate(-50%, -50%)',
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

const portalPromptStyle: CSSProperties = {
  position: 'absolute', top: '32%', left: '50%', transform: 'translate(-50%, -50%)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
  padding: '0.9rem 1.4rem', borderRadius: 16,
  background: 'rgba(20, 24, 36, 0.86)',
  color: '#fff', fontFamily: 'Inter, system-ui, sans-serif',
  pointerEvents: 'none', userSelect: 'none',
  backdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,0.18)',
  boxShadow: '0 10px 32px rgba(0,0,0,0.35)',
};
const portalPromptLabelStyle: CSSProperties = {
  fontSize: '1.05rem', fontWeight: 700, letterSpacing: '0.01em',
};
const portalPromptCtaStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  fontSize: '0.82rem', opacity: 0.9,
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
