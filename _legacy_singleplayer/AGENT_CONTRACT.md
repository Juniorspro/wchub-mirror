---
name: rendering-3d
description: "Authoritative Babylon.js 3D template contract for building complete 3D games under templates/3d. Primary writable surface: src/babylon/** + src/App.tsx; compat snapshot: src/game/{controller,schema,state,types}.ts. Covers the startGame runtime owner, agent-writable boundary, architecture invariants (enforced by scripts/check-architecture.mjs), Havok physics, @rezona/core/3d platform APIs, assets, game juice, and 3D build/type errors."
---

# 3D Rendering — Babylon Game Engine Contract

`templates/3d` is the **Babylon-first** 3D game template. React owns only the
platform hooks, the `<canvas>` mount, the DOM HUD, and mobile controls; the
Babylon `Engine` / `Scene` / render loop / resize / dispose lifecycle is owned
by a vanilla TypeScript runtime whose entry point is
`startGame(canvas, runtimeContext)` in `src/babylon/game.ts`.

This document is the 3D authoritative single source for coder / revise / repair.
When code conflicts with this contract, **this contract wins**, and
`scripts/check-architecture.mjs` (the executable gate that runs first in
`bun run build`) must be updated in sync.

> The 3D template is NOT React-Three-Fiber. There is no `<Canvas>`, no
> `useFrame`, no drei. `@react-three/fiber`, `@react-three/drei`, and `three`
> are **banned** (invariant 16). All rendering goes through `@babylonjs/core`.

## Design Summary First

Before writing any code, output 6–9 lines covering:

- **Camera**: `ArcRotateCamera` (orbit / follow) or `UniversalCamera` (first-person), where the single writer lives, whether movement is camera-yaw-relative.
- **World**: background, lighting model, ground/terrain, static colliders.
- **Actor**: player mesh, movement rules, action feedback.
- **Items / Entities**: collectibles / hazards / NPCs / decorations and their update cadence.
- **Interaction**: how `input.dir` / `input.actionHeld` / tap / proximity enter the runtime.
- **HUD**: what the DOM HUD displays from `store.ts`; whether `MobileControlHud` is mounted.
- **Physics**: Havok or hand-written; the degraded-fallback plan if Havok init fails.
- **Assets**: whether textures / glb models / audio are needed.

The summary lives in chat or in `done(summary)`; do NOT paste source code into it.

## Agent-Writable Boundary

The Babylon template splits the agent-writable area into three layers. The
**primary writable surface** carries the gameplay implementation; the **compat
snapshot layer** keeps only the 4 core `src/game/` contract files so the
EDITABLE / GameState / controller interfaces stay tunable; **Protected** files
are owned by the platform and assembly — do not write to them.

### Primary writable surface

- **`src/babylon/**`** — Babylon runtime + scene modules + HUD. Freely create,
  overwrite, split, merge, or stop wiring any file here; this is the main
  battleground for gameplay. Default wiring:

  | File | Default role |
  |------|--------------|
  | `babylon/game.ts` | **Unique** Engine/Scene creator + the single `engine.runRenderLoop()`; exports `startGame(canvas, runtimeContext)` returning a `{ dispose() }` handle. |
  | `babylon/world.ts` | Camera / lighting / ground / static colliders (`LLM-EXTENSION:WORLD`). |
  | `babylon/actor.ts` | Player mesh, movement, action feedback (`LLM-EXTENSION:ACTOR`). |
  | `babylon/items.ts` | Collectibles / rewards / hazards (`LLM-EXTENSION:ITEMS`). |
  | `babylon/entities.ts` | NPCs / obstacles / decorations / goal markers (`LLM-EXTENSION:ENTITIES`). |
  | `babylon/hud.tsx` | DOM overlay HUD, driven by `store.ts` (`LLM-EXTENSION:HUD`). |
  | `babylon/helpers.ts` | Babylon helpers + default `StandardMaterial`, `thinInstance*`, hardware scaling. |
  | `babylon/config.ts` | Runtime parameters (engine / camera / world / physics constants). |
  | `babylon/store.ts` | Low-frequency snapshot bridge runtime → HUD. |
  | `babylon/audio.ts` | SFX + audio-unlock bridge. |

- **`src/App.tsx`** — thin React shell. Only platform hooks
  (`useScreen` / `useInput` / `useGameConfig`), the `<canvas ref>` mount, the
  `<Hud>`, the optional `MobileControlHud`, and the
  `startGame(canvas, runtimeContext)` call. **No** `new Engine` / `new Scene` /
  `runRenderLoop` in App.tsx.

### Compat snapshot — `src/game/` (exactly 4 files)

- `schema.ts` — **must** export `SCHEMA` (`satisfies EditableSchema`) with the
  user-tunable EDITABLE fields; the Live Editor reads the schema from here.
  Holds `LLM-EXTENSION:CONFIG` + `LLM-EXTENSION:SCHEMA`.
- `state.ts` — extend the `GameState` interface to match real gameplay.
- `controller.ts` — lightweight state adapter / gameplay state machine
  (score, waves, HP). Do **not** spin up a second authoritative world or a
  parallel render loop inside it.
- `types.ts` — platform type shim.
- **Do NOT create new subdirectories or files under `src/game/`** — do not
  rebuild the R3F-era `systems/` / `ui/` layout. New modules go into `src/babylon/`.

### Protected (DO NOT WRITE)

`src/lib/**` (the `@rezona/core/3d` re-export shim), `src/main.tsx`,
`src/index.css`, `src/assets.ts`, `src/vite-env.d.ts`. Owned by the platform /
template / assembly.

### Standard extension areas

The template uses `LLM-EXTENSION:<AREA>` tags so downstream models can locate
the writable areas. Every tag must appear **exactly once** across `src/**`:

| Tag | Default location | Purpose |
|-----|------------------|---------|
| `LLM-EXTENSION:CONFIG` | `src/game/schema.ts` | Public adjustable parameters; internal constants stay in the owning module. |
| `LLM-EXTENSION:SCHEMA` | `src/game/schema.ts` | Append editor-tunable fields. |
| `LLM-EXTENSION:WORLD` | `src/babylon/world.ts` | Scene background, camera, lighting, terrain, static colliders. |
| `LLM-EXTENSION:ACTOR` | `src/babylon/actor.ts` | Player mesh, animations, movement rules, action feedback. |
| `LLM-EXTENSION:ITEMS` | `src/babylon/items.ts` | Collectible / reward / hazard meshes + interaction rules. |
| `LLM-EXTENSION:ENTITIES` | `src/babylon/entities.ts` | NPCs, obstacles, decorations, goal markers, low-frequency updates. |
| `LLM-EXTENSION:HUD` | `src/babylon/hud.tsx` | Low-frequency DOM HUD driven by the runtime store. |

A tag may move to a more appropriate module inside `src/babylon/**` (CONFIG /
SCHEMA may stay in `schema.ts`), but every tag must remain globally unique.
**DO NOT REMOVE an `LLM-EXTENSION` comment line when overwriting a file** — carry
it back verbatim. `scripts/check-architecture.mjs` enforces exactly-one of each;
one too many or too few exits 1 and cascades into a full `bun run build` failure.
This is the invariant most likely to be wiped during a rewrite.

## Architecture Invariants

> **Authoritative gate**: `scripts/check-architecture.mjs` runs first in
> `bun run build` (`check:architecture && tsc --noEmit && vite build`).
> Violating any single invariant triggers exit 1 → the whole build fails →
> repair cannot recover. Defend every invariant on the first pass.

1. **Single runtime owner** — `src/babylon/game.ts` is the unique creator of `Engine` / `Scene` and the unique caller of `engine.runRenderLoop()` (appears exactly once across the src tree, in `game.ts`).
2. **Single cleanup owner** — the handle returned by `startGame()` must `engine.stopRenderLoop()`, remove the resize listener, dispose scene objects, `scene.disablePhysicsEngine()`, `scene.dispose()`, and `engine.dispose()`. `window.addEventListener('resize', …)` is paired with `window.removeEventListener('resize', …)`.
3. **React thin shell** — `src/App.tsx` mounts `<canvas ref={canvasRef}>`, calls `startGame(canvas, runtimeContext)`, and calls the handle's `.dispose()` in cleanup; `new Scene(` / `new Engine(` / `runRenderLoop(` may NOT appear in App.tsx.
4. **Modular scene** — `world.ts` owns camera/lighting/ground, `actor.ts` owns the player, `items.ts` owns collectibles/rewards/hazards, `entities.ts` owns non-player objects, `hud.tsx` owns the DOM overlay.
5. **Store bridge** — the Babylon runtime publishes low-frequency snapshots via `src/babylon/store.ts`; the React HUD only subscribes — it must not drive gameplay rules or call Babylon scene APIs.
6. **Havok degradation** — failing to init physics may NOT block a visible scene; record the degraded state and keep the fallback interaction. Self-check requires top-level `import HavokPhysics from '@babylonjs/havok'` plus `await HavokPhysics()` + `new HavokPlugin(` + `scene.enablePhysics(`.
7. **No visible per-frame allocation (hot-path hard ban)** — the render loop and any `update(…)` body must NOT contain `new Vector2/3/4(`, `new Color3/4(`, `new Matrix(`, `Matrix.Identity()`, `Quaternion.Identity()`, `new Float32Array(`, `new Array(`, or an object-literal `return { … }`. Declare scratch once at module top (`const SCRATCH_FOO = new Vector3()`) and reuse it; hot paths return scalars or reuse scratch.
8. **Top-level imports** — Babylon, Havok, and loader side-effect imports all use top-level ESM imports. Browser code must NOT call `require(`.
9. **Visible first frame** — even with sparse content, ship a camera, lighting, ground, and a hero or obvious goal so the scene is screenshot-able.
10. **`LLM-EXTENSION` tags unique + non-deletable** — the 7 tags each appear exactly once; carry the matching comment back verbatim when overwriting `world/actor/items/entities/hud/schema`.
11. **`helpers.ts` critical helpers cannot be deleted** — must retain `thinInstanceSetBuffer(` / `thinInstanceBufferUpdated(` / `setHardwareScalingLevel(` / `StandardMaterial`. These are the performance + mobile-compat paths.
12. **`schema.ts` must use `satisfies EditableSchema`** — when exporting `SCHEMA`, use `satisfies EditableSchema`, not `: EditableSchema`.
13. **10 core files must exist** — `src/App.tsx`, `src/babylon/{game,helpers,world,actor,items,entities,hud,store}.ts(x)`, `src/game/schema.ts`. Removing any fails the build.
14. **Platform hooks stay wired** — `src/App.tsx` must contain `useGameConfig(SCHEMA)`, `useInput()`, `useScreen()`, and spread `...input.handlers` onto the container `<div>`. Whenever a character / vehicle locomotion or action-button path exists, keep `MobileControlHud` (or the equivalent DOM controls via `setMobileMove` / `setActionHeld`).
15. **Render loop clamps dt** — `Math.min((now - lastTime) / 1000, 0.05)` or an equivalent ≤ 0.05 cap, so a backgrounded tab doesn't take one giant step on resume.
16. **Only Babylon-family render packages** — built on `@babylonjs/core` + `@babylonjs/havok` (+ `@babylonjs/loaders` for glTF). No `three` / `@react-three/fiber` / `@react-three/drei` or any other browser-side 3D library.

> To change an invariant itself, edit `scripts/check-architecture.mjs` first and
> update this section in sync — never bypass the self-check while the two drift.

## Output Protocol

When generating code:

- Write **complete file contents**; no diffs, no `// rest unchanged`.
- Multi-file changes may be written in parallel, but every file must be complete.
- Leave unrelated platform files untouched.
- Finally call `done(summary)` with: Files modified / Changes / Unsatisfied intents.
- The coder does **not** invoke `bun run build` — the assembly stage runs it later.

### Delivery Checklist

Run through every item before `done`. The architecture self-check enforces a
subset; the rest is gameplay robustness the script cannot see.

Engine + render loop:
- [ ] `engine.runRenderLoop` appears EXACTLY once, inside `game.ts`.
- [ ] Havok: `await HavokPhysics()` → `new HavokPlugin(true, instance)` → `scene.enablePhysics(…)`; init failure leaves the visible scene intact.
- [ ] Render loop clamps `dt ≤ 0.05`.
- [ ] `engine.setHardwareScalingLevel(…)` has a low-end fallback (e.g. `((navigator as any).deviceMemory ?? 4) <= 4 ? 1.5 : 1`).
- [ ] The `dispose()` handle calls `stopRenderLoop` / `scene.dispose` / `engine.dispose` / `scene.disablePhysicsEngine`; resize listener add/remove paired.

React shell + HUD:
- [ ] `App.tsx` only mounts `<canvas ref>`, calls `startGame()`, and invokes the returned `dispose()` in cleanup; no `new Scene/Engine/runRenderLoop`.
- [ ] `App.tsx` calls `useGameConfig(SCHEMA)`, `useInput()`, `useScreen()`, spreads `...input.handlers` on the container.
- [ ] `MobileControlHud` (or a DOM equivalent) is mounted whenever there's character / vehicle / avatar locomotion or an action button. Orbit-only / ambient scenes may skip the widget but keep `useInput()` + `...input.handlers`.
- [ ] HUD only subscribes to `store.ts` / reads `phaseRef`; never calls Babylon scene APIs.

Performance + materials:
- [ ] Every repeated mesh group (≥ 5 of the same shape) uses `thinInstance` or `createInstance`; `Float32Array` length = `count * 16`; `thinInstanceBufferUpdated('matrix')` called after each update.
- [ ] The actor is the ONLY mesh with `PBRMaterial`; world / items / decorations use `StandardMaterial`.
- [ ] Render loop and any `update(…)` body contain ZERO hot-path allocations (invariant 7); reuse module-scope scratch.

Imports + structure:
- [ ] No `require(` anywhere; all Babylon classes via top-of-file `import { … } from "@babylonjs/core"`.
- [ ] Only Babylon-family render packages imported.
- [ ] The 7 `LLM-EXTENSION` tags each appear exactly once.
- [ ] All 10 core files exist; `schema.ts` uses `satisfies EditableSchema`; `helpers.ts` keeps the critical helpers.

Gameplay robustness (verify by hand):
- [ ] First frame is visible: camera, lighting, ground, and a hero / obvious goal — screenshot-able.
- [ ] Out-of-bounds recovery: when the actor falls below `CONFIG.world.fallY` (template ships `recoverFromFall`), teleport to a safe pose AND zero linear velocity. Never freeze the screen on a fall.
- [ ] First 10 seconds: visible world on mount, first interaction succeeds, no tutorial overlay.

## Platform APIs

<!-- owned-exports: MobileControlHud, MobileControlHudActionButton, MobileControlHudLayout, MobileControlHudProps -->

### Babylon runtime

- Top-level **named** imports from `@babylonjs/core` for the classes/types you need (`Engine`, `Scene`, `Vector3`, `Color3`, `MeshBuilder`, `StandardMaterial`, …).
- Havok from `@babylonjs/havok`; **must** `await HavokPhysics()` before `new HavokPlugin(true, instance)`.
- `src/babylon/game.ts` is the unique runtime entry owning `Engine`, `Scene`, `engine.runRenderLoop()`, the `window.resize` listener, and the full dispose path. `startGame(canvas, runtimeContext)` returns `{ dispose(): void }`; React unmount calls it.
- Per-frame logic runs only inside the Babylon render loop (or `update(…)` invoked by it). Do not create a second loop, a timer-driven gameplay loop, or a React render-loop owner.
- `StandardMaterial` is the default; reserve `PBRMaterial` for the hero + 1-2 hero props. Prefer `thinInstance` / instance helpers for repeated objects.
- Mobile-first: keep the hardware-scaling fallback (`configureHardwareScaling`), a low draw-call budget, and a low-allocation loop.

`startGame` / runtime-context shape the template ships:

```ts
export interface GameRuntimeContext {
  input: Input;
  screenRef: MutableRefObject<Screen>;
  configRef: MutableRefObject<Config>;   // read .current each frame — never re-render React
  phaseRef: MutableRefObject<Phase>;
}
export interface GameRuntimeHandle { dispose(): void; }
export function startGame(canvas: HTMLCanvasElement, runtimeContext?: GameRuntimeContext): GameRuntimeHandle;
```

### `@rezona/core/3d`

`@rezona/core` is the shared platform layer across 2D / 3D / AR / VR;
`templates/3d` consumes it via `src/lib/index.ts` (`export * from '@rezona/core/3d';`).
All symbols are top-level named exports — import from `@rezona/core/3d` (or via
the `src/lib` re-export), never deep-import into `node_modules`.

Shared baseline surface (same across all templates): `Phase` / `Rect` / `Screen`
/ `Input` / `useInput`; `sfx` / `throttledSfx` / `playSfx` / `SfxParams` / `bgm`
/ `audio` / `ensureAudioReady`; `useGameConfig` / `useEditableMedia` and the
`EditableSchema` / `EditableField` / `MediaEntry` family; plus the multiplayer
surface (`joinCast` / `Cast` / `RemoteUser` / …).

3D-specific surface and wiring:

- `useScreen()` → `{ screen, screenRef, containerRef }`; mounts a `ResizeObserver`. Put `containerRef` on the container `<div>`; read `screenRef.current` from Babylon code that needs CSS-px dims.
- `useLoop(...)` drives a **2D** canvas — **skip in 3D**; Babylon owns `engine.runRenderLoop()` (invariant 1).
- `useGameConfig(SCHEMA)` once in `App.tsx`; pass `configRef` (not `config`) into Babylon so each frame reads the latest mutable value without re-rendering.
- `useEditableMedia(id, defaultSrc)` for HUD images/videos re-assignable from the Live Editor; for Babylon textures / glb URLs prefer `ASSETS[…]` + store reactivity.
- Audio helpers beyond the baseline: `playTone(freq, dur, type?, vol?)`, `playSweep(start, end, dur, type?, vol?)`, `getAudioCtx()`.

### Mobile DOM controls (`MobileControlHud`)

| Symbol | Purpose |
|--------|---------|
| `MobileControlHud` | DOM overlay: virtual joystick (writes `input.setMobileMove`) + action button(s) (`input.setActionHeld`). Stops pointer-event propagation so it never starts a world-look drag. **Mandatory** whenever there's a character / vehicle / avatar locomotion path or an action button (invariant 14). |
| `MobileControlHudProps` | `{ input, primaryAction?, extraButtons?, layout? }`. |
| `MobileControlHudActionButton` | `{ label, ariaLabel, onPress, onRelease }` — callbacks should just call `input.setActionHeld(true/false)`; do not keep a parallel action state. |
| `MobileControlHudLayout` | `joystickSide / actionSide / joystickRadius / bottomInset / sideInset / actionButtonSize / actionButtonGap`. |

Orbit-only / ambient / showcase / tap-to-place scenes may skip the widget but
must still keep `useInput()` + `...input.handlers` on the container. Never force
an empty/stub joystick onto a scene that doesn't have locomotion.

### Device input + native bridge

`vibrate(style?)` (haptics, never throws), `motion` (`tilt.{x,y}` pre-normalized
−1..1; remember `motion.stop()` in dispose), `mic` (`start/stop/level/freq`;
`mic.stop()` in dispose), `camera` (`start/stop/attach/detach/state`;
`camera.stop()` in dispose), `bridge.getUsername()`. Types: `VibrateStyle`
(`'light' | 'medium' | 'heavy'`), `CameraFacingMode` (`'user' | 'environment'`).

### Input contract — look vs. move are decoupled

- `input.dir` — keyboard (WASD/arrows) **or** the virtual joystick. Screen-space y-down: W → `(0, -1)`, S → `(0, +1)`, D → `(+1, 0)`, A → `(-1, 0)`. **Never** alias `input.dir.y` directly into world `position.z`.
- **Camera-relative move** — for an `ArcRotateCamera`, use the shipped `getCameraRelativeMoveXZ(camera, dir.x, dir.y)` helper in `babylon/helpers.ts` so W always walks "into the screen" and the move basis rotates with the camera. Other rigs must do the equivalent conversion explicitly.
- `input.drag` — pointer drag in the canvas; reserved for **camera look only** in 3D.
- `input.actionHeld` — held state of the on-screen action button; read it from `actor`/gameplay `update()`; pair with a rising-edge check for one-shots.
- Keyboard is only a fallback; whenever movement or an action exists, ship the mobile DOM controls.

### Audio — gameplay BGM is platform-managed

Gameplay background music **autoplays from `public/game.config.json`** (injected
into `index.html` at build by `@rezona/core/vite/inject-game-config`). The game
code must **not** start or stop the main BGM track:

- Do NOT call `bgm.play(...)` for the gameplay loop in `startGame` / `update`, and do NOT `bgm.stop()` the main track in `dispose`.
- Only use `bgm` for an **event-driven swap** (boss / victory / defeat) — and stop only that in-flight swap on dispose.
- SFX is yours: route through `babylon/audio.ts` (`createGameAudio` wraps `sfx` + `ensureAudioReady`) or `playSfx` directly. Unlock the audio context on the first user gesture (`ensureAudioReady()`), never during render.

## Asset Integration

`src/assets.ts` is an assembly-generated `Record<string, string>` — do not
hand-edit, rename, or reshape it.

- Read texture / mesh / glb / audio URLs from `ASSETS`; use bracket notation when a key isn't a valid dot identifier.
- Asset loading lives in the owning module — `world.ts` loads scenes/terrain, `actor.ts` loads characters (the template ships `loadHeroModel(scene, url)` + `HERO_MODEL_ASSET_KEY`), `items.ts` loads collectibles, `entities.ts` loads decorations/NPCs.
- `import '@babylonjs/loaders/glTF';` at top level for the glTF/glb loader side effect; never `require()`.
- Every long-lived texture / mesh / material / particle / observer that you manually create or load must have a dispose path.
- On asset-load failure, keep the procedural fallback meshes so the scene stays visible and interactive (the template's `loadHeroModel` returns `null` → caller keeps `createFallbackHero`).
- Do not assume an external asset router exists; only the `ASSETS` URL manifest and `ASSET_META` metadata are guaranteed.

## Common Antipatterns

> Each wrong → right pair below was observed in 7-10 of 10 prior generations.
> When in doubt, copy the ✅ side verbatim.

### Camera, physics, lifecycle

- **`ArcRotateCamera` with a fixed target — the camera never follows the actor.**
  ```ts
  // ❌  camera stays at origin, the actor walks off-screen
  const camera = new ArcRotateCamera("cam", α, β, r, new Vector3(0, 0, 0), scene);
  // ✅  lerp camera.target toward actor.position every frame (Babylon in-place form)
  Vector3.LerpToRef(camera.target, actor.position, 0.18, camera.target);
  ```

- **`HavokPlugin` constructed without `await` — physics silently no-ops.**
  ```ts
  // ❌  HavokPhysics() returns a Promise; passing the Promise breaks types AND runtime
  const havok = new HavokPlugin(true, HavokPhysics());
  // ✅
  const havokInstance = await HavokPhysics();
  const havok = new HavokPlugin(true, havokInstance);
  scene.enablePhysics(new Vector3(0, -25, 0), havok);   // one-time setup — alloc fine here
  ```

- **Fall-out-of-world freezes the game.** A game-over screen over a frozen world reads as broken. The actor MUST come back into play — respawn / checkpoint / lose-a-life is a gameplay call, but DO IT.
  ```ts
  // ❌  the screen just freezes
  if (actor.position.y < -10) showGameOverScreen();
  // ✅  teleport + zero velocity, then let gameplay decide the consequence
  if (actor.position.y < CONFIG.world.fallY) {
    actor.position.set(spawn.x, spawn.y, spawn.z);
    aggregate.body.setLinearVelocity(Vector3.Zero());   // Zero() at a non-hot event is ok
  }
  ```

### Performance + materials

- **`N` meshes in a loop for repeated items — N draw calls.**
  ```ts
  // ❌  50 cylinders = 50 draw calls
  for (let i = 0; i < 50; i++) MeshBuilder.CreateCylinder(`item${i}`, …, scene);
  // ✅  ONE master mesh + thinInstanceSetBuffer = 1 draw call for thousands
  const master = MeshBuilder.CreateCylinder("item", { … }, scene);
  const matrices = new Float32Array(16 * 50);           // setup, not hot-path
  for (let i = 0; i < 50; i++) Matrix.TranslationToRef(…).copyToArray(matrices, i * 16);
  master.thinInstanceSetBuffer("matrix", matrices, 16);
  master.thinInstanceBufferUpdated("matrix");
  ```

- **Allocating math objects inside the render loop.** The most-shipped violation is `_vec.scale(speed)` (returns a NEW Vector3) where `_vec.scaleInPlace(speed)` was meant. Every Babylon math class exposes `*InPlace` / `*ToRef` variants — use them.
  ```ts
  // ❌  alloc every frame
  scene.onBeforeRenderObservable.add(() => {
    const move = new Vector3(dx, 0, dz).scale(speed);
    actor.position.addInPlace(move);
  });
  // ✅  module-scope scratch + in-place ops
  const SCRATCH_MOVE = new Vector3();
  scene.onBeforeRenderObservable.add(() => {
    SCRATCH_MOVE.set(dx, 0, dz).scaleInPlace(speed);
    actor.position.addInPlace(SCRATCH_MOVE);
  });
  ```

- **`PBRMaterial` everywhere — mobile GPU melts.** `StandardMaterial` is the default; `PBRMaterial` is reserved for the actor + 1-2 hero props.

### Imports + dynamic loading

- **`import type` / `import { type X }` for a class you instantiate — TS1361 "cannot be used as a value".** The trap is dual-use classes used in BOTH type and value positions — `StandardMaterial`, `Scene`, `UniversalCamera`, `ArcRotateCamera`, the lights, `TransformNode`, `PhysicsAggregate`. If a symbol is ever `new`'d or has a static called, it must be a plain value import (annotation use still works from a value import).
  ```ts
  // ❌  annotated AND constructed, but imported type-only → TS1361
  import { type StandardMaterial, type UniversalCamera } from "@babylonjs/core";
  // ✅  value import — you can still annotate (`mat: StandardMaterial`) from it
  import { StandardMaterial, UniversalCamera } from "@babylonjs/core";
  // `import type` is ONLY for symbols never `new`'d and never a static call:
  import type { AbstractMesh, Nullable } from "@babylonjs/core";
  ```

- **`require()` anywhere — browsers do not define `require`.** Every variant (the `as typeof import(...)` trick, conditional/lazy `require`) crashes with `"require is not defined"`. Bundlers tree-shake unused names — over-importing is free, so ADD the class to the existing top-of-file import list.

- **Namespace import + property access — defeats tree-shaking.** Use direct named imports (`import { Quaternion } from "@babylonjs/core"`), not `import * as BABYLON`.

### Hallucinated APIs

- **`Color3` — these DO NOT EXIST:** `color.toColor3()`, `color.brighten()`, `Color3.fromString()` (lowercase `f`). Real API:
  ```ts
  Color3.FromHexString("#ff0000");   // hex → Color3 (capital F)
  Color3.FromInts(255, 100, 50);     // 0-255 → Color3
  new Color3(r, g, b);               // r/g/b are 0..1 FLOATS, not 0..255
  color.scaleToRef(0.5, target);     // mutates target in place (scale() allocates)
  ```
- **`Quaternion` — these DO NOT EXIST:** `…getRotationMatrix().toQuaternion()`, `Mesh.NewQuaternion()`, `Quaternion.fromEulerAngles()` (lowercase `f`). Real: `Quaternion.Identity()`, `Quaternion.RotationAxis(axis, angle)`, `Quaternion.FromEulerAngles(x, y, z)`.
- **Per-instance matrices** — use `Matrix.ComposeToRef(scale, rot, pos, out)` with module-scope scratch; never chain `.Identity().getRotationMatrix().toQuaternion()`.

### Mobile DOM controls

- **Touch joystick wired inside `<canvas>` pointer events** misses pointer captures and starts a world-look drag mid-swipe. Use `MobileControlHud` (DOM overlay outside the canvas; stops propagation; writes through `setMobileMove` / `setActionHeld`). Do not re-implement joystick state off `pointermove`, and do not keep a parallel action state alongside `input.setActionHeld`.

## Game Juice

> "Juice" is the high-frequency feedback that turns a mechanically-correct scene
> into a game that feels alive. A correct build with no juice still reads as flat.
> Every generate/revise pass leaves at least 3-5 juice patterns wired in.

Two ground rules: **(1)** the hot-path budget still wins (invariant 7) — all juice
runs through module-scope scratch + `*InPlace` / `*ToRef`. **(2)** Layer cheap
signals — a single hit fires SFX + haptic + material flash + camera shake + hitstop
within the same ~200 ms window.

Required surface whenever there's an actor / hit / collect / score / transition:
- **Impact bundle** on hit/collect/damage: `playSfx` (slight pitch jitter), `vibrate('light'|'medium')`, a tinted material flash on the affected mesh, and a 30-80 ms camera shake *or* 50-120 ms hitstop. Goal / level-clear scales it up (`vibrate('heavy')`, longer hitstop, optional event-BGM swap).
- **Actor liveness**: idle bob (sine on `position.y` / `scaling.y`), ≤ 80 ms anticipation windup, recovery overshoot → spring back via lerp.
- **HUD reactivity**: a tracked stat that increases briefly scales (1.0 → 1.2 → 1.0 over ~180 ms) — drive via `store.ts`, never animate from inside HUD render each frame.

```ts
// Camera shake — additive, decaying, allocation-free (module scope)
const SHAKE_OFFSET = new Vector3();
let shakeAmp = 0, shakeTime = 0;
export function impulseShake(amp: number, dur = 0.18) {
  shakeAmp = Math.max(shakeAmp, amp); shakeTime = Math.max(shakeTime, dur);
}
// inside the render loop:
camera.position.subtractInPlace(SHAKE_OFFSET);          // remove last frame's offset
shakeTime = Math.max(0, shakeTime - dt);
const k = shakeTime > 0 ? shakeAmp * (shakeTime / 0.18) : 0;
SHAKE_OFFSET.set((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, 0);
camera.position.addInPlace(SHAKE_OFFSET);

// Hitstop — global time-scale, never `await sleep`
const rawDt = Math.min((now - lastTime) / 1000, 0.05);
const dt = hitstop > 0 ? rawDt * 0.05 : rawDt;          // ~5% time scale during hitstop
hitstop = Math.max(0, hitstop - rawDt);

// Material flash — copy-from-original, no allocation in hot path
const ORIGINAL_DIFFUSE = mat.diffuseColor.clone();      // one-time
const FLASH = new Color3(1, 0.6, 0.6);                  // module scope
mat.diffuseColor.copyFrom(FLASH); flashRemaining = 0.08;          // on hit
flashRemaining = Math.max(0, flashRemaining - dt);                // in update
if (flashRemaining === 0) mat.diffuseColor.copyFrom(ORIGINAL_DIFFUSE);
```

Particle bursts: allocate one `ParticleSystem` per kind at scene init, parent
each to a reusable invisible `TransformNode`, and `start()` / `stop()` per event
— never `new ParticleSystem(...)` per hit.

Anti-patterns (juice that fights the engine): `setTimeout`/`setInterval` driving
gameplay state; allocating tween objects per event; unbounded screen shake
(clamp + decay); hitstop via `await sleep` or a frozen loop (breaks resize /
dispose / audio); HUD popups via `document.createElement` from Babylon code
(push to `store.ts` instead); `vibrate` every frame while a button is held;
reaching for `PBRMaterial` "for nicer light".

Tuning (mobile-first): ≤ 1 SFX + 1 vibrate + 1 shake + 1 hitstop per impact
frame; hitstop 40-120 ms (≤ 250 ms for boss/clear); shake amplitude ≤ 0.3 world
units (> 0.6 reads as broken); material flash 60-100 ms.

## Common Type Errors for 3D

- `HavokPhysics()` returns a Promise — forgetting `await` breaks the plugin type and runtime.
- `scene.enablePhysics(...)` may return `false`; do not assume physics is always available.
- `Engine` / `Scene` / `Mesh` / `StandardMaterial` must come from `@babylonjs/core`; do not mix types from other 3D packages.
- `MeshBuilder` meshes need explicit material, position, and dispose; long-lived materials/textures must have a cleanup path.
- For `Quaternion` / `Matrix` / `Vector3`, prefer `ToRef` / `copyFrom` / `set` over allocating each frame.
- `thinInstanceSetBuffer('matrix', matrices, 16)` requires the buffer length to equal `count * 16`; call `thinInstanceBufferUpdated('matrix')` after each update.
- React `useEffect` cleanup must not assume `startGame` is synchronous; if it returns a Promise handle, the cleanup must `.then(h => h.dispose())` (the shipped `App.tsx` handles both).
- `MobileControlHud` button callbacks must call `input.setActionHeld(true/false)`; do not maintain a separate action state.

## Revise Patterns for 3D

| Revision intent | Priority file(s) |
|-----------------|------------------|
| Switch gameplay / add enemies / add goals | `babylon/actor.ts` · `items.ts` · `entities.ts` · `hud.tsx` + schema; keep `game.ts` runtime owner unchanged |
| Switch art style / scene / camera | `babylon/world.ts` + helpers; preserve the unique render loop, dispose, resize |
| User uploads assets | read URLs from `ASSETS` in the owning module; keep the procedural fallback; do not edit `src/assets.ts` |
| Mobile locomotion / action buttons | keep/adjust `MobileControlHud` or its DOM equivalent; keep platform input handlers on the container |
| Black screen | check `App.tsx` canvas ref, the `startGame()` call, Babylon imports, `scene.render()`, camera target, lights, premature dispose |
| Performance | reduce draw calls → thin instances → simpler materials → remove per-frame allocations → tweak hardware scaling (not post-processing first) |
| TS1361 "cannot be used as a value" | convert every occurrence of the dual-use class to a value import in one pass, not just the erroring file |
| End / restart loop | close it through `phaseRef` + the runtime store + module reset; do not merely edit HUD copy |

When revise deletes a module, also delete its imports and dispose/update calls —
no unwired dead code.

## Verification

Before delivery (the coder writes complete files and stops at `done`; assembly
runs the build):

```bash
bun run check:architecture
```

The architecture self-check freezes: unique `runRenderLoop`, `startGame` wiring,
the React canvas shell, Babylon imports, the Havok `await`, the `thinInstance`
helper, the dispose cleanup, each `LLM-EXTENSION` area's uniqueness, no
browser-side `require()`, no visible hot-path allocations, and the `useInput` +
container-handlers DOM input path. `MobileControlHud` is a hard requirement only
when a character / vehicle locomotion or action path is present. When the
self-check fails, fix the code or the contract — never bypass the script.
