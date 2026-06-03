// ══════════════════════════════════════════════
// Babylon runtime ↔ HUD bridge. The runtime is the state writer (it boots
// the snapshot and updates frame/elapsed periodically). The HUD writes
// outfit-related state (equip/unequip, randomize, save/load presets) via
// the mutator helpers exported at the bottom of this file — every mutation
// bumps outfit.version so the runtime can detect and re-apply.
// ══════════════════════════════════════════════

import {
  WARDROBE_ACCESSORY_ITEMS,
  WARDROBE_TEXTURE_ITEMS,
  encodeLookId,
  type AccessorySocket,
  type TextureSlot,
} from './items';
import type { GarmentDesign } from './textures';

export type CustomSlot = Exclude<TextureSlot, 'bodypaint'>;

export interface SavedLook {
  readonly name: string;
  readonly slot: CustomSlot;
  readonly design: GarmentDesign;
  readonly createdAt: number;
}

export interface OutfitState {
  readonly textureItemIds: readonly string[];
  readonly accessoryItemIds: readonly string[];
  readonly version: number;
}

export type PresetMap = Readonly<Record<1 | 2 | 3, OutfitState | null>>;

export interface ChatEntry {
  readonly from: string;
  readonly name: string;
  readonly text: string;
  readonly t: number;
}

export interface GameStoreSnapshot {
  readonly ready: boolean;
  readonly physicsEnabled: boolean;
  readonly frame: number;
  readonly elapsed: number;
  readonly collectedItems: number;
  readonly totalItems: number;
  readonly message: string;
  readonly outfit: OutfitState;
  readonly presets: PresetMap;
  /** sessionId of the local player once net has handshaken. Empty pre-hello. */
  readonly selfId: string;
  /** Active room code (from URL hash or "lounge" default). */
  readonly roomCode: string;
  /** id of the stall the local player is currently standing next to, or null. */
  readonly nearbyStallId: string | null;
  /** Tail-window of chat history (room-broadcast events). */
  readonly chat: readonly ChatEntry[];
  /** Local saved per-panel designs the player has named. localStorage-backed. */
  readonly savedLooks: readonly SavedLook[];
}

type GameStoreListener = (snapshot: GameStoreSnapshot) => void;

const DEFAULT_OUTFIT: OutfitState = {
  textureItemIds: ['skin-light', 'shirt-white-tee', 'pants-blue-jeans', 'shoes-white-sneakers'],
  accessoryItemIds: [],
  version: 1,
};

const EMPTY_PRESETS: PresetMap = { 1: null, 2: null, 3: null };

const initialSnapshot: GameStoreSnapshot = {
  ready: false,
  physicsEnabled: false,
  frame: 0,
  elapsed: 0,
  collectedItems: 0,
  totalItems: WARDROBE_TEXTURE_ITEMS.length + WARDROBE_ACCESSORY_ITEMS.length,
  message: 'Entering fairground',
  outfit: DEFAULT_OUTFIT,
  presets: EMPTY_PRESETS,
  selfId: '',
  roomCode: '',
  nearbyStallId: null,
  chat: [],
  savedLooks: [],
};

let snapshot: GameStoreSnapshot = initialSnapshot;
const listeners = new Set<GameStoreListener>();

export function getGameSnapshot(): GameStoreSnapshot {
  return snapshot;
}

export function setGameSnapshot(patch: Partial<GameStoreSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot);
}

export function subscribeGameStore(listener: GameStoreListener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function resetGameStore(): void {
  snapshot = initialSnapshot;
  for (const listener of listeners) listener(snapshot);
}

// ─── Multiplayer-specific setters ───────────────────────────────────────────

export function setSelfId(selfId: string): void {
  setGameSnapshot({ selfId });
}

export function setRoomCode(roomCode: string): void {
  setGameSnapshot({ roomCode });
}

export function setNearbyStall(nearbyStallId: string | null): void {
  if (snapshot.nearbyStallId === nearbyStallId) return; // skip listener fan-out
  setGameSnapshot({ nearbyStallId });
}

export function setChatMessages(chat: readonly ChatEntry[]): void {
  setGameSnapshot({ chat });
}

// ─── Outfit mutators (called from the HUD) ──────────────────────────────────

function bumpedOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): OutfitState {
  return {
    textureItemIds: [...textureItemIds],
    accessoryItemIds: [...accessoryItemIds],
    version: snapshot.outfit.version + 1,
  };
}

export function setOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void {
  setGameSnapshot({ outfit: bumpedOutfit(textureItemIds, accessoryItemIds) });
}

export function resetOutfit(): void {
  setGameSnapshot({
    outfit: {
      textureItemIds: DEFAULT_OUTFIT.textureItemIds,
      accessoryItemIds: DEFAULT_OUTFIT.accessoryItemIds,
      version: snapshot.outfit.version + 1,
    },
  });
}

export function toggleTextureItem(id: string): void {
  const equipped = snapshot.outfit.textureItemIds;
  const item = WARDROBE_TEXTURE_ITEMS.find((i) => i.id === id);
  if (!item) return;
  let next: string[];
  if (equipped.includes(id)) {
    next = equipped.filter((i) => i !== id);
  } else {
    const sameSlotIds = WARDROBE_TEXTURE_ITEMS.filter((i) => i.slot === item.slot).map((i) => i.id);
    next = [...equipped.filter((i) => !sameSlotIds.includes(i)), id];
  }
  setOutfit(next, snapshot.outfit.accessoryItemIds);
}

export function toggleAccessoryItem(id: string): void {
  const equipped = snapshot.outfit.accessoryItemIds;
  const item = WARDROBE_ACCESSORY_ITEMS.find((i) => i.id === id);
  if (!item) return;
  let next: string[];
  if (equipped.includes(id)) {
    next = equipped.filter((i) => i !== id);
  } else {
    const sameSocketIds = WARDROBE_ACCESSORY_ITEMS.filter((i) => i.socket === item.socket).map((i) => i.id);
    next = [...equipped.filter((i) => !sameSocketIds.includes(i)), id];
  }
  setOutfit(snapshot.outfit.textureItemIds, next);
}

function randomPick<T>(arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomizeOutfit(): void {
  const slotOrder: TextureSlot[] = ['bodypaint', 'shirt', 'pants', 'shoes'];
  const textureIds: string[] = [];
  for (const slot of slotOrder) {
    const choice = randomPick(WARDROBE_TEXTURE_ITEMS.filter((i) => i.slot === slot));
    if (choice) textureIds.push(choice.id);
  }

  const socketOrder: AccessorySocket[] = ['head_top', 'head_front', 'neck_front', 'back_center'];
  const shuffled = [...socketOrder].sort(() => Math.random() - 0.5);
  const accessoryCount = Math.floor(Math.random() * 3); // 0, 1, or 2
  const accessoryIds: string[] = [];
  for (let i = 0; i < accessoryCount; i++) {
    const socket = shuffled[i];
    const choice = randomPick(WARDROBE_ACCESSORY_ITEMS.filter((a) => a.socket === socket));
    if (choice) accessoryIds.push(choice.id);
  }

  setOutfit(textureIds, accessoryIds);
}

const PRESET_STORAGE_KEY = 'dressup.presets.v1';

export function savePreset(slot: 1 | 2 | 3): void {
  const presets: PresetMap = { ...snapshot.presets, [slot]: snapshot.outfit };
  setGameSnapshot({ presets });
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
    }
  } catch {
    // Quota / private-mode failure — preset stays in memory only.
  }
}

export function loadPreset(slot: 1 | 2 | 3): void {
  const p = snapshot.presets[slot];
  if (!p) return;
  setOutfit(p.textureItemIds, p.accessoryItemIds);
}

export function hydratePresetsFromStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Record<1 | 2 | 3, OutfitState | null>>;
    if (parsed && typeof parsed === 'object') {
      const merged: PresetMap = {
        1: parsed[1] ?? null,
        2: parsed[2] ?? null,
        3: parsed[3] ?? null,
      };
      setGameSnapshot({ presets: merged });
    }
  } catch {
    // Corrupted / unreadable — fall through to empty presets.
  }
  // Also hydrate the saved-looks gallery so it survives reloads.
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(SAVED_LOOKS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const looks: SavedLook[] = [];
      for (const e of parsed) {
        if (e && typeof e === 'object'
          && typeof (e as SavedLook).name === 'string'
          && typeof (e as SavedLook).slot === 'string'
          && typeof (e as SavedLook).createdAt === 'number'
          && (e as SavedLook).design && (e as { design: { kind: string } }).design.kind === 'garment') {
          looks.push(e as SavedLook);
        }
      }
      setGameSnapshot({ savedLooks: looks });
    }
  } catch {
    /* corrupted savedLooks — fall through to empty */
  }
}

// ─── Custom per-panel designs ──────────────────────────────────────────────

const SAVED_LOOKS_KEY = 'dressup.savedLooks.v1';

function persistSavedLooks(looks: readonly SavedLook[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVED_LOOKS_KEY, JSON.stringify(looks));
    }
  } catch { /* quota / private mode — in-memory only */ }
}

// Equip a custom GarmentDesign in the given slot. The design is encoded
// into a look:<slot>:<b64> id and inserted in textureItemIds, REPLACING any
// existing entry that matches the same slot (so equipping a new shirt
// design swaps out the previous shirt — catalog or look).
export function equipCustomDesign(slot: CustomSlot, design: GarmentDesign): void {
  const lookId = encodeLookId(slot, design);
  // Drop the existing entry in this slot. Catalog entries are identified by
  // the WARDROBE_TEXTURE_ITEMS index; look:<slot>: entries by the prefix.
  const slotPrefix = `look:${slot}:`;
  const catalogSlotIds = new Set(
    WARDROBE_TEXTURE_ITEMS.filter((i) => i.slot === slot).map((i) => i.id),
  );
  const next = snapshot.outfit.textureItemIds
    .filter((id) => !id.startsWith(slotPrefix) && !catalogSlotIds.has(id));
  next.push(lookId);
  setOutfit(next, snapshot.outfit.accessoryItemIds);
}

export function saveLook(name: string, slot: CustomSlot, design: GarmentDesign): void {
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed) return;
  // Replace by name if it already exists; otherwise append.
  const existing = snapshot.savedLooks.filter((l) => l.name !== trimmed || l.slot !== slot);
  const entry: SavedLook = { name: trimmed, slot, design, createdAt: Date.now() };
  const next = [...existing, entry].slice(-50);
  setGameSnapshot({ savedLooks: next });
  persistSavedLooks(next);
}

export function deleteLook(name: string, slot: CustomSlot): void {
  const next = snapshot.savedLooks.filter((l) => !(l.name === name && l.slot === slot));
  setGameSnapshot({ savedLooks: next });
  persistSavedLooks(next);
}
