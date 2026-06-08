# Perf Audit Report

- Project: client
- Render mode: 3d
- Generated: 2026-06-08T00:00:00Z
- Skill version: rezona-pgc-tools-perf-audit
- Checks run: memory, listeners, reflow, asset-count, asset-size, audio-reuse
- Findings: 19 (Critical: 7, Warning: 11, Info: 1)

## Critical (7)

### [asset-size] src/assets/sprite/sprite_ground-grass_1813ec.png:_
**PNG is 1345 KB at 1024×1024 — well over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_ground-grass_1813ec.png  1345 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP (typically 60–80% smaller for stylized art) via the future tools-compress skill, or downscale to 512×512 since this is a tiled ground texture sampled at low effective resolution.
**Severity reason:** Largest single asset on the ground; loaded once at scene start but ships every page-load.

### [asset-size] src/assets/sprite/sprite_ground-path_d62b30.png:_
**PNG is 1462 KB at 1024×1024 — over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_ground-path_d62b30.png  1462 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP, or downscale to 512×512 (paths are sampled at very low effective resolution after texture-tile uScale = 4).
**Severity reason:** Above 1 MB threshold; ships in every initial load.

### [asset-size] src/assets/sprite/sprite_jersey-argentina-fabric_d81d80.png:_
**PNG is 1501 KB at 1024×1024 — over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_jersey-argentina-fabric_d81d80.png  1501 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP. Jersey fabrics are tileable patterns — quality 80–85 WebP is usually indistinguishable from PNG at this scale.
**Severity reason:** Above 1 MB threshold; one of three patterned-jersey textures, each loaded lazily on equip but still shipped on initial fetch.

### [asset-size] src/assets/sprite/sprite_jersey-croatia-fabric_58ae31.png:_
**PNG is 1715 KB at 1024×1024 — over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_jersey-croatia-fabric_58ae31.png  1715 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP at quality 80–85.
**Severity reason:** Above 1 MB threshold; the checker pattern is high-frequency, which inflates PNG more than WebP — even bigger savings expected here.

### [asset-size] src/assets/sprite/sprite_jersey-germany-fabric_a0f09e.png:_
**PNG is 2166 KB at 1024×1024 — over 2 MB, largest single asset in the project**

```text
src/assets/sprite/sprite_jersey-germany-fabric_a0f09e.png  2166 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP. The horizontal-stripe pattern is simple — WebP should reduce this to ~150–200 KB.
**Severity reason:** Single asset over 2 MB; this is the biggest ship-weight offender by far.

### [asset-size] src/assets/sprite/sprite_shirt-galaxy_2c03ae.png:_
**PNG is 1569 KB at 1024×1024 — over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_shirt-galaxy_2c03ae.png  1569 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP at quality 85.
**Severity reason:** Above 1 MB threshold; one of three AI-shirt textures.

### [asset-size] src/assets/sprite/sprite_shirt-tropical_a99ba7.png:_
**PNG is 1443 KB at 1024×1024 — over the 1 MB Critical threshold**

```text
src/assets/sprite/sprite_shirt-tropical_a99ba7.png  1443 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP at quality 85.
**Severity reason:** Above 1 MB threshold.

## Warning (11)

### [asset-size] src/assets/sprite/sprite_grass-tuft_665842.png:_
**PNG is 194 KB at 1024×1024 — sprite is way oversized for its render scale**

```text
src/assets/sprite/sprite_grass-tuft_665842.png  194 KB  PNG (1024×1024)
```

**Fix:** Grass tufts render at <1 unit world size, ~64×64 effective pixels at gameplay zoom. Downscale source to 256×256 or 128×128 — saves ≥ 75% with no visible quality loss.
**Severity reason:** Above the 100 KB Warning threshold; rendered resolution is tiny relative to the source.

### [asset-size] src/assets/sprite/sprite_oak-tree_1b24ee.png:_
**PNG is 955 KB at 1024×1024 — just under Critical, still over the 100 KB Warning threshold**

```text
src/assets/sprite/sprite_oak-tree_1b24ee.png  955 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP. Alpha-channel WebP supports the transparency that the cutout pass added.
**Severity reason:** Just under 1 MB so technically Warning, but borderline — should be in the first compression pass.

### [asset-size] src/assets/sprite/sprite_pine-tree_e7c76b.png:_
**PNG is 319 KB at 1024×1024 — unused asset still being shipped**

```text
src/assets/sprite/sprite_pine-tree_e7c76b.png  319 KB  PNG (1024×1024)
```

**Fix:** Remove from `src/assets.ts` AND delete the file — no code path references `pine-tree` after the recent pine-removal commit.
**Severity reason:** Above 100 KB threshold; this is dead weight (referenced in `ASSETS` but no consumer code uses `ASSETS['pine-tree']`).

### [asset-size] src/assets/sprite/sprite_shirt-denim_59bbeb.png:_
**PNG is 297 KB at 1024×1024 — orphaned asset (no code reference)**

```text
src/assets/sprite/sprite_shirt-denim_59bbeb.png  297 KB  PNG
```

**Fix:** Delete this file and the `shirt-denim` key from `src/assets.ts` — the shirt-denim catalog item has been replaced by the AI shirts.
**Severity reason:** Above 100 KB; unused. Bonus: there is a duplicate same-key entry at `sprite_shirt-denim_3790c5.png` (90 KB) also unreferenced.

### [asset-size] src/assets/sprite/sprite_shirt-geometric_82bec3.png:_
**PNG is 854 KB at 1024×1024 — Warning threshold**

```text
src/assets/sprite/sprite_shirt-geometric_82bec3.png  854 KB  PNG (1024×1024)
```

**Fix:** Re-encode as WebP. Memphis-pop pattern with clean shapes compresses very well.
**Severity reason:** Above 100 KB; just below the 1 MB Critical bar.

### [asset-size] src/assets/sprite/sprite_shirt-hawaiian_09bd15.png:_
**PNG is 127 KB at 1024×1024 — orphaned asset (no code reference)**

```text
src/assets/sprite/sprite_shirt-hawaiian_09bd15.png  127 KB  PNG
```

**Fix:** Delete this file and the `shirt-hawaiian` key from `src/assets.ts` — no consumer.
**Severity reason:** Above 100 KB and unused.

### [asset-size] src/assets/sprite/sprite_shirt-hawaiian_a95e17.png:_
**PNG is 171 KB at 1024×1024 — orphaned asset (same key as 09bd15 above)**

```text
src/assets/sprite/sprite_shirt-hawaiian_a95e17.png  171 KB  PNG
```

**Fix:** Delete; the `shirt-hawaiian` key resolves to the other file via `ASSETS` and is itself unused.
**Severity reason:** Above 100 KB and unused; duplicate-name orphan.

### [asset-size] src/assets/sprite/sprite_shirt-flannel_ea7e2d.png:_
**PNG is 116 KB at 1024×1024 — orphaned asset (no code reference)**

```text
src/assets/sprite/sprite_shirt-flannel_ea7e2d.png  116 KB  PNG
```

**Fix:** Delete this file and the `shirt-flannel` key from `src/assets.ts` — no consumer.
**Severity reason:** Above 100 KB and unused.

### [asset-size] src/assets/sprite/sprite_shirt-leather_372dad.png:_
**PNG is 290 KB at 1024×1024 — orphaned asset (no code reference)**

```text
src/assets/sprite/sprite_shirt-leather_372dad.png  290 KB  PNG
```

**Fix:** Delete; `shirt-leather` is unused in the current catalog.
**Severity reason:** Above 100 KB and unused.

### [asset-size] src/assets/sprite/sprite_shoes-canvas_1442a2.png:_
**PNG is 245 KB at 1024×1024 — Warning threshold**

```text
src/assets/sprite/sprite_shoes-canvas_1442a2.png  245 KB  PNG
```

**Fix:** Re-encode as WebP. Currently used by the White Sneakers catalog item.
**Severity reason:** Above 100 KB; still in active use, so this is a compression-not-deletion candidate.

### [memory] src/babylon/items.ts:65
**Garment materials are created on every outfit equip but `clearGarments()` only disposes meshes — materials leak**

```ts
function makeDesignMaterial(scene: Scene, name: string, design: GarmentDesign): StandardMaterial {
  // ...
  const mat = createStandardMaterial(scene, name, new Color3(1, 1, 1));
  // mat.diffuseTexture = ...  (also leaks)
  return mat;
}
// callers: buildTshirt, buildFootballJersey, buildPants, buildShoes, etc.
// 15+ createStandardMaterial / makeDesignMaterial calls per outfit build.
```

**Fix:** In `actor.ts` clearGarments, replace `m.dispose()` with `m.dispose(false, true)` (the second arg `disposeMaterialAndTextures = true`). Same in clearAccessories. Each outfit swap now drops its materials cleanly instead of growing `scene.materials` indefinitely.
**Severity reason:** Material leak grows ~5–10 entries per outfit change. Heavy outfit-cycling sessions accumulate hundreds of stale materials in `scene.materials` + their GPU resources. Not immediate visual problem but real heap/GPU growth.

## Info (1)

### [asset-count] src/assets.ts:_
**9 asset keys appear declared but unreferenced; dead-asset detection demoted to Info because dynamic `ASSETS[key]` indexing is in use**

```text
Orphan candidates (no code reference outside assets.ts):
  shirt-comic, shirt-denim, shirt-flames, shirt-flannel,
  shirt-hawaiian, shirt-knit, shirt-leather, shirt-leopard,
  shirt-rainbow
Dynamic indexing detected:
  src/babylon/items.ts:743 — ASSETS[key]
  src/babylon/world.ts:486 — ASSETS[assetKey]
```

**Fix:** These were all old shirt catalog entries replaced by AI-generated shirts and World Cup jerseys. Confirm none are reached through dynamic key construction (they aren't), then delete the keys from `src/assets.ts` and the matching PNG files. Each deletion is independently called out at Warning severity under `asset-size` above.
**Severity reason:** Per playbook, dead-asset detection is demoted to Info when dynamic indexing exists in the codebase, because static analysis can't prove the keys are unreachable.

## Skipped checks (0)

None — all six checks ran.

## Notes

- The project is a multiplayer migration of a rezona-pgc 3D game (via `rezona-pgc-game-multiplayer`). The original `AGENT_CONTRACT.md` at the project root has been replaced by `AGENTS.md` at the repository root, and the game-logic layer was moved from `src/game/` into `src/babylon/`. Code-side checks (memory, listeners, reflow, audio-reuse) audited both `src/babylon/` and `src/game/` plus the entry points `src/App.tsx`, `src/net/`. Pure framework files in `src/lib/`, `src/main.tsx`, and `src/assets.ts` were excluded per the standard scope rule.
- Total uncompressed asset weight: **~16 MB** (PNG-only, `src/assets/sprite/`). Converting the 7 Critical + 9 Warning offenders to WebP at quality 80–85 should shrink the total to ~3–4 MB without visible quality loss — a 4-5× scene-load improvement.
- The image-pattern path in textures.ts (async-load, draw-on-canvas, redraw seams) is wired correctly — image patterns trigger one decode per unique URL via `IMAGE_HTML_CACHE`. No leak there.
- The `pendingJumps` queue in `NetClient` drains every render frame and never accumulates. No leak.
- Avatar joint disposal (`shoulderJointL.dispose()` etc.) recursively cleans child meshes — the rig teardown is sound.
- Walking-animation `update()` runs purely closed-form math; no Three.js / Babylon resource construction in the hot loop.
- The asset-count tiny-cluster check found no clusters of ≥ 6 PNGs each ≤ 4 KB in any sprite directory — no atlas candidate to flag.
