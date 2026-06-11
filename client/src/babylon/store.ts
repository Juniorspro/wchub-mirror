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
  /** Server wall-clock stamp — display/ordering only. Never compare this
   *  against the local clock (phone clocks drift by minutes). */
  readonly t: number;
  /** Client arrival stamp (local Date.now() when the broadcast landed).
   *  Use THIS for unread/seen comparisons — same clock domain as the HUD. */
  readonly localT?: number;
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
  /** Coin balance. Per-player, localStorage-backed. */
  readonly balance: number;
  /** Item ids the player has unlocked. Free items (price=0) are NOT stored
   *  here — the priceFor() check returns 0 so they're always considered owned. */
  readonly ownedItems: readonly string[];
  /** sessionId of the nearest OTHER player within compliment range, or
   *  null if no one is close enough. Updated by the render loop so the
   *  HUD can show a "Press E to compliment" hint. */
  readonly nearestOtherId: string | null;
  /** Display name of the nearest other player (snapshot.username),
   *  cached alongside nearestOtherId so the HUD doesn't need to scan
   *  the snapshot itself. Empty string when no nearby player. */
  readonly nearestOtherName: string;
  /** Distance to the nearest other player in world units (Infinity if
   *  none). */
  readonly nearestOtherDist: number;
  /** Seconds of contiguous crowd-bonus accumulation. The render loop
   *  ticks this up while ≥2 other players are within CROWD_RADIUS and
   *  resets it to 0 when the threshold awards coins. */
  readonly crowdTimer: number;
  /** Live count of OTHER players within CROWD_RADIUS — used by the HUD
   *  to surface a progress indicator. */
  readonly crowdCount: number;
  /** Id of the nearest stadium portal the player is standing within
   *  PORTAL_INTERACT_RADIUS of, or null if none. The HUD shows a
   *  "press G to play <label>" prompt when this is set; game.ts wires
   *  the G key to redirect to that portal's URL. */
  readonly nearbyPortalId: string | null;
  /** Display label of the nearby portal (kept in the snapshot so the
   *  HUD doesn't have to look it up). Empty when no portal nearby. */
  readonly nearbyPortalLabel: string;
  /** Redirect URL for the nearby portal. Empty when no portal nearby. */
  readonly nearbyPortalUrl: string;
  /** Host-App game id of the nearby portal. Inside the App the HUD/G-key
   *  deep-links here via bridge.openGameDetail(gameId); 0 when none nearby. */
  readonly nearbyPortalGameId: number;
  /** Server-pushed match fixtures + live scores + pool sizes. Fed by
   *  NetClient on every `event:fixtures` / `event:bet-update` broadcast.
   *  HUD's MatchTicker + BettingPopup render from this. */
  readonly bettingFixtures: ReadonlyArray<BettingFixtureSnapshot>;
  /** Bets the local player has placed this room session, keyed by
   *  matchId. Persists in memory only — coins deduct on confirm, so the
   *  bet record is more for the UI's "you bet X on Y" badge than for
   *  the payout pipeline (server tracks bets authoritatively). */
  readonly myBets: ReadonlyMap<string, { camp: 'HOME' | 'DRAW' | 'AWAY'; amount: number }>;
  /** Latest bet result toast — set briefly when a match resolves with a
   *  payout for the player. Cleared by the toast UI after ~6s. */
  readonly lastBetResult: { matchId: string; profit: number; payout: number } | null;
  /** World Cup group standings, refreshed daily from the server. The
   *  LeaderboardPanel in the HUD renders this. */
  readonly bettingStandings: ReadonlyArray<GroupStandingSnapshot>;
  /** Server-wide top-up pool (sum of every bet placed this session).
   *  Drives the monument display + milestone ladder. */
  readonly bettingPool: number;
  /** Indexes of milestone tiers already crossed + paid out. */
  readonly bettingPoolUnlocked: readonly number[];
  /** Latest milestone unlock toast — set briefly when a tier crosses
   *  AND the player is one of the recipients (everyone-who's-bet). */
  readonly lastMilestoneReward: {
    scope: 'server' | 'personal';
    tier: number; threshold: number; reward: number; label: string;
  } | null;
  /** Player's personal lifetime contribution (sum of bet amounts this
   *  session). Drives the personal milestone ladder. */
  readonly bettingMyContribution: number;
  /** Personal-tier indexes already unlocked + rewarded for this player. */
  readonly bettingMyUnlocked: readonly number[];
  /** True when the player is standing close enough to the signpost
   *  to read its controls cheat-sheet. */
  readonly nearbySignpost: boolean;
  /** Most recent soccer-pitch goal, or null. The HUD shows a banner
   *  for ~3 seconds after `at` and then clears. `mine: true` when the
   *  scorer was this client (drives the "+coins!" celebration). */
  readonly lastSoccerGoal: {
    scorerName: string;
    side: 'N' | 'S';
    scoreN: number;
    scoreS: number;
    mine: boolean;
    at: number;
  } | null;
}

export interface TeamStandingSnapshot {
  readonly position: number;
  readonly team: string;
  readonly code: string;
  readonly played: number;
  readonly won: number;
  readonly draw: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
  readonly points: number;
}
export interface GroupStandingSnapshot {
  readonly group: string;
  readonly teams: ReadonlyArray<TeamStandingSnapshot>;
}

/** Mirrors the server's broadcasted fixture shape (see event.ts). */
export interface BettingFixtureSnapshot {
  readonly id: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly homeCode: string;
  readonly awayCode: string;
  readonly kickoffMs: number;
  readonly status: string;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly minute: number;
  readonly result: 'HOME' | 'DRAW' | 'AWAY' | null;
  readonly poolHome: number;
  readonly poolDraw: number;
  readonly poolAway: number;
  readonly countHome: number;
  readonly countDraw: number;
  readonly countAway: number;
  readonly phase: 'AWAIT_BET' | 'BET_WINDOW' | 'LIVE' | 'RESOLVED';
}

// ─── Economy: prices + starter pack ─────────────────────────────────────────

/** Catalog items the player owns from the start — the default outfit + a
 *  couple of variants — so the stalls aren't all locked at first login.
 *  Anything NOT in this list and NOT free (per priceFor) costs coins. */
const STARTER_FREE_IDS = new Set<string>([
  // Skins — all four free
  'skin-light', 'skin-tan', 'skin-deep', 'skin-mint',
  // One basic of each garment slot
  'shirt-white-tee', 'pants-blue-jeans', 'shoes-white-sneakers',
]);

/** Look up the coin price for a catalog item. Patterns by id prefix so new
 *  items inherit a sensible default without manually editing the price map.
 *  Returns 0 for free / starter items. */
export function priceFor(itemId: string): number {
  if (STARTER_FREE_IDS.has(itemId)) return 0;
  // Jerseys — premium tier (World Cup roster)
  if (itemId.startsWith('jersey-')) return 200;
  // AI-generated shirts — featured tier
  if (itemId.startsWith('shirt-ai-')) return 150;
  // Other shirts (showcase + basics not in starter pack)
  if (itemId.startsWith('shirt-')) return 100;
  // Pants
  if (itemId.startsWith('pants-')) return 80;
  // Shoes
  if (itemId.startsWith('shoes-')) return 80;
  // Accessories
  if (
    itemId.startsWith('hat-') ||
    itemId.startsWith('glasses-') ||
    itemId.startsWith('scarf-') ||
    itemId.startsWith('backpack-')
  ) return 75;
  return 0;
}

export const STARTING_BALANCE = 1000;
const DAILY_BONUS = 200;
const DAILY_BONUS_MS = 24 * 60 * 60 * 1000;

// ─── localStorage persistence keys ──────────────────────────────────────────
const LS_BALANCE = 'dressup-balance';
const LS_OWNED   = 'dressup-owned';
const LS_LAST_BONUS = 'dressup-last-bonus';
const LS_OUTFIT = 'dressup-outfit';

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
  balance: STARTING_BALANCE,
  ownedItems: [],
  nearestOtherId: null,
  nearestOtherName: '',
  nearestOtherDist: Infinity,
  crowdTimer: 0,
  crowdCount: 0,
  nearbyPortalId: null,
  nearbyPortalLabel: '',
  nearbyPortalUrl: '',
  nearbyPortalGameId: 0,
  bettingFixtures: [],
  myBets: new Map(),
  lastBetResult: null,
  bettingStandings: [],
  bettingPool: 0,
  bettingPoolUnlocked: [],
  lastMilestoneReward: null,
  bettingMyContribution: 0,
  bettingMyUnlocked: [],
  nearbySignpost: false,
  lastSoccerGoal: null,
};

/** SERVER milestone ladder — mirrors SERVER_MILESTONES in
 *  server/src/game/event.ts. The monument paints every tier. */
export const BETTING_SERVER_MILESTONES: ReadonlyArray<{
  threshold: number; reward: number; label: string;
}> = [
  { threshold:   1000, reward:  150, label: 'First Thousand' },
  { threshold:   5000, reward:  500, label: 'Five Thousand Pool' },
  { threshold:  15000, reward: 1200, label: 'Fifteen K Mark' },
  { threshold:  40000, reward: 3000, label: 'Forty K Tier' },
  { threshold: 100000, reward: 8000, label: 'Hundred K Champion' },
];
/** PERSONAL milestone ladder — mirrors PERSONAL_MILESTONES on the server. */
export const BETTING_PERSONAL_MILESTONES: ReadonlyArray<{
  threshold: number; reward: number; label: string;
}> = [
  { threshold:   50, reward:   50, label: 'Backer' },
  { threshold:  200, reward:  150, label: 'Supporter' },
  { threshold:  500, reward:  400, label: 'Patron' },
  { threshold: 1500, reward: 1000, label: 'Champion' },
  { threshold: 5000, reward: 3000, label: 'Legend' },
];

let snapshot: GameStoreSnapshot = initialSnapshot;
const listeners = new Set<GameStoreListener>();

export function getGameSnapshot(): GameStoreSnapshot {
  return snapshot;
}

export function setGameSnapshot(patch: Partial<GameStoreSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  // Single chokepoint for outfit persistence: EVERY outfit mutation
  // (toggle/equip/reset/preset/expression/custom look) lands here as an
  // outfit patch, so the equipped outfit survives reloads without each
  // mutator needing its own save call. resetGameStore() deliberately
  // bypasses this function — a boot reset must not clobber the stored
  // outfit before hydrateOutfitFromStorage() restores it.
  if (patch.outfit) persistOutfit(patch.outfit);
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

export function setLastSoccerGoal(
  lastSoccerGoal: GameStoreSnapshot['lastSoccerGoal'],
): void {
  setGameSnapshot({ lastSoccerGoal });
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

/** Set the avatar's facial expression. Implemented as a `face-<expr>`
 * token in the accessory CSV so it syncs to other players through the
 * normal equip → roster-update pipeline. 'neutral' removes the token. */
export function setAvatarExpression(expr: 'neutral' | 'happy' | 'surprised' | 'wink' | 'cool'): void {
  const withoutFace = snapshot.outfit.accessoryItemIds.filter((id) => !id.startsWith('face-'));
  const next = expr === 'neutral' ? withoutFace : [...withoutFace, `face-${expr}`];
  setOutfit(snapshot.outfit.textureItemIds, next);
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

// ─── Economy mutators ───────────────────────────────────────────────────────

/** True if the item is owned by the player — either it's free (price 0)
 *  or it's been purchased. The HUD uses this to gate the equip action. */
export function isItemOwned(itemId: string): boolean {
  if (priceFor(itemId) === 0) return true;
  return snapshot.ownedItems.includes(itemId);
}

/** Try to buy an item. Returns true if the purchase succeeded (or was a
 *  no-op because the item was already owned). Free items are no-ops too. */
export function purchaseItem(itemId: string): boolean {
  if (isItemOwned(itemId)) return true;
  const cost = priceFor(itemId);
  if (snapshot.balance < cost) return false;
  const nextOwned = [...snapshot.ownedItems, itemId];
  const nextBalance = snapshot.balance - cost;
  setGameSnapshot({ balance: nextBalance, ownedItems: nextOwned });
  persistEconomy(nextBalance, nextOwned);
  return true;
}

/** Update the cached match-fixture snapshot (server-pushed). Called by
 *  game.ts when the NetClient receives an `event:fixtures` broadcast. */
export function setBettingFixtures(fixtures: ReadonlyArray<BettingFixtureSnapshot>): void {
  setGameSnapshot({ bettingFixtures: fixtures });
}

/** Update the cached group-standings table. Refreshed daily by the
 *  server's StandingsPoller. */
export function setBettingStandings(standings: ReadonlyArray<GroupStandingSnapshot>): void {
  setGameSnapshot({ bettingStandings: standings });
}

/** Update the server-wide top-up pool + unlocked milestone tiers. */
export function setBettingPool(pool: number, unlocked: readonly number[]): void {
  setGameSnapshot({ bettingPool: pool, bettingPoolUnlocked: unlocked });
}

/** Apply a milestone reward — credits coins to local balance + sets the
 *  toast snapshot so the HUD can briefly display it. Called from
 *  game.ts when NetClient receives event:milestone-reward. */
export function applyMilestoneReward(reward: {
  scope: 'server' | 'personal';
  tier: number; threshold: number; reward: number; label: string;
}): void {
  const nextBalance = snapshot.balance + reward.reward;
  setGameSnapshot({ balance: nextBalance, lastMilestoneReward: reward });
  persistEconomy(nextBalance, snapshot.ownedItems);
}

/** Update the player's personal contribution + unlocked-tier list. */
export function setBettingPersonal(contribution: number, unlocked: readonly number[]): void {
  setGameSnapshot({ bettingMyContribution: contribution, bettingMyUnlocked: unlocked });
}

export function clearMilestoneReward(): void {
  setGameSnapshot({ lastMilestoneReward: null });
}

/** Spend coins to place a bet (local-only; server tracks the bet
 *  authoritatively for payout). Returns false if balance is too low. */
export function placeLocalBet(matchId: string, camp: 'HOME' | 'DRAW' | 'AWAY', amount: number): boolean {
  if (snapshot.balance < amount) return false;
  const nextBalance = snapshot.balance - amount;
  const nextBets = new Map(snapshot.myBets);
  nextBets.set(matchId, { camp, amount });
  setGameSnapshot({ balance: nextBalance, myBets: nextBets });
  persistEconomy(nextBalance, snapshot.ownedItems);
  return true;
}

/** Record a bet payout from the server resolve message. Credits coins
 *  (the player got their bet back + winnings, or zero if they lost). */
export function settleBet(matchId: string, payout: number, profit: number): void {
  const nextBalance = snapshot.balance + payout;
  const nextBets = new Map(snapshot.myBets);
  nextBets.delete(matchId);
  setGameSnapshot({
    balance: nextBalance,
    myBets: nextBets,
    lastBetResult: { matchId, profit, payout },
  });
  persistEconomy(nextBalance, snapshot.ownedItems);
}

/** Clear the lastBetResult toast (called by the toast UI after fading). */
export function clearBetResult(): void {
  setGameSnapshot({ lastBetResult: null });
}

/** Award a flat number of coins. Used for the daily login bonus. */
export function awardCoins(amount: number): void {
  const nextBalance = snapshot.balance + amount;
  setGameSnapshot({ balance: nextBalance });
  persistEconomy(nextBalance, snapshot.ownedItems);
}

function persistEconomy(balance: number, ownedItems: readonly string[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_BALANCE, String(balance));
    localStorage.setItem(LS_OWNED, ownedItems.join(','));
  } catch {
    // localStorage full / disabled — silently ignore.
  }
}

function persistOutfit(outfit: OutfitState): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LS_OUTFIT, JSON.stringify({
      textureItemIds: outfit.textureItemIds,
      accessoryItemIds: outfit.accessoryItemIds,
    }));
  } catch {
    // localStorage full / disabled — silently ignore.
  }
}

/** True for ids the avatar/outfit pipeline knows how to wear: catalog
 *  texture/accessory items, `look:<slot>:<b64>` custom designs, and
 *  `face-<expr>` expression tokens. Anything else in storage (stale ids
 *  from removed items, corrupted writes) is dropped on restore. */
function isWearableId(id: string, kind: 'texture' | 'accessory'): boolean {
  if (kind === 'texture') {
    return id.startsWith('look:') || WARDROBE_TEXTURE_ITEMS.some((i) => i.id === id);
  }
  return id.startsWith('face-') || WARDROBE_ACCESSORY_ITEMS.some((i) => i.id === id);
}

/** Run on app boot, AFTER resetGameStore(). Restores the last equipped
 *  outfit so the avatar walks in wearing what the player left in — the
 *  caller should hydrate BEFORE net.connect() so the join opts can carry
 *  the same outfit to the server (see addPlayer in server/src/game).
 *  Caps mirror the server's addPlayer slices (2800 / 256 chars) so a
 *  restored outfit can never be silently truncated into a different one
 *  by the server. */
export function hydrateOutfitFromStorage(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LS_OUTFIT);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      textureItemIds?: unknown;
      accessoryItemIds?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') return;
    const textures = (Array.isArray(parsed.textureItemIds) ? parsed.textureItemIds : [])
      .filter((id): id is string => typeof id === 'string' && isWearableId(id, 'texture'));
    const accessories = (Array.isArray(parsed.accessoryItemIds) ? parsed.accessoryItemIds : [])
      .filter((id): id is string => typeof id === 'string' && isWearableId(id, 'accessory'));
    if (textures.join(',').length > 2800 || accessories.join(',').length > 256) return;
    if (textures.length === 0 && accessories.length === 0) return;
    setOutfit(textures, accessories);
  } catch {
    // Corrupted / unreadable — keep the default outfit.
  }
}

/** Run on app boot. Loads balance + owned-items from localStorage, then
 *  checks if the daily bonus is due and awards it. New players (no prior
 *  storage) get STARTING_BALANCE + the first daily bonus. Returns the
 *  number of bonus coins just awarded so the HUD can show a toast. */
export function hydrateEconomyFromStorage(): number {
  let bonus = 0;
  let balance = STARTING_BALANCE;
  let owned: string[] = [];
  try {
    if (typeof localStorage === 'undefined') {
      setGameSnapshot({ balance, ownedItems: owned });
      return 0;
    }
    const rawBal = localStorage.getItem(LS_BALANCE);
    if (rawBal !== null) {
      const n = Number(rawBal);
      if (Number.isFinite(n) && n >= 0) balance = Math.floor(n);
    }
    const rawOwn = localStorage.getItem(LS_OWNED);
    if (rawOwn) owned = rawOwn.split(',').map((s) => s.trim()).filter(Boolean);
    // Daily bonus: award if last bonus was > 24h ago, OR if there's no
    // record at all (first-time player gets the first bonus immediately).
    const rawLast = localStorage.getItem(LS_LAST_BONUS);
    const now = Date.now();
    const last = rawLast !== null ? Number(rawLast) : 0;
    if (!Number.isFinite(last) || now - last >= DAILY_BONUS_MS) {
      balance += DAILY_BONUS;
      bonus = DAILY_BONUS;
      localStorage.setItem(LS_LAST_BONUS, String(now));
    }
  } catch {
    // Anything broken — fall through to defaults.
  }
  setGameSnapshot({ balance, ownedItems: owned });
  persistEconomy(balance, owned);
  return bonus;
}
