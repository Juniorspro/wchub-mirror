# Asset Plan

- Project: dressup-fair (client)
- Planned at:    2026-06-10
- Last verified: 2026-06-10 — all 4 textures generated (gpt-image-2 @ yunwu,
  25–49 KB each as webp), registered in src/assets.ts, and confirmed live
  in-scene: 60+ materials skinned (plaza/paving → flagstone, monument/podium/
  pedestals → cut stone, fences/benches/picnic/stall counters+posts → wood,
  stall + concession awnings → tinted cloth). tsc + vite build pass.
- Skill version: rezona-pgc-game-plan-assets
- Mode: 3d (Babylon.js multiplayer template)
- Art-direction anchor: stylized hand-painted toon material, soft flat shading, warm palette, seamless tileable, even top-down lighting, no harsh shadows, no text
- Audio-direction anchor: n/a (no audio planned this pass)
- Totals: BGM 0, SFX 0, Image 4 (cutouts: 0), Model 0
- Scope note: MAP OBJECTS only. Clothing/garment sprites + jersey textures
  deliberately NOT touched. Seed3D quota exhausted + ship build already
  over 25 MB, so map objects are enriched via tileable TEXTURES skinning
  the existing procedural geometry rather than new GLB meshes. Hats +
  scarves fixed in code (geometry rebuild), not via generation.

## Image (4)

### `tex_wood_planks` — sprite
**Prompt:** seamless tileable wood plank texture, warm honey-brown timber boards laid side by side, subtle straight grain and faint knots, stylized hand-painted toon material, soft flat shading, warm palette, even top-down lighting, no harsh shadows, no text
**Cutout:** no
**Rationale:** tiles onto fence rails, stall counters + posts, picnic tables, benches, signpost — every wood surface in the park currently uses a flat brown diffuse color.

### `tex_awning_cloth` — sprite
**Prompt:** seamless tileable canvas cloth texture, off-white near-white fabric with faint diagonal woven threads, stylized hand-painted toon material, soft flat shading, even top-down lighting, no harsh shadows, no text
**Cutout:** no
**Rationale:** near-white so each stall's awning `diffuseColor` tints it via StandardMaterial multiply — one cloth texture serves all six stall roof colors.

### `tex_cut_stone` — sprite
**Prompt:** seamless tileable cut sandstone block wall texture, pale warm beige stone blocks with soft beveled mortar joints, stylized hand-painted toon material, soft flat shading, even top-down lighting, no harsh shadows, no text
**Cutout:** no
**Rationale:** tiles onto the top-up monument shaft + stepped base, the top-voters podium plinths, and the mascot / trophy pedestals.

### `tex_flagstone` — sprite
**Prompt:** seamless tileable flagstone paving texture, warm grey cobblestones with rounded edges and sandy joints, top-down overhead view, stylized hand-painted toon material, soft flat shading, even lighting, no harsh shadows, no text
**Cutout:** no
**Rationale:** tiles onto the plaza base disc + all paved plots (fixture board, monument, podium, picnic, trophy plaza, photo spot).

## Already in `src/assets.ts` (2)

- `field_soccer_ball`, `field_soccer_goal` — existing GLB props (goal currently unused; ball in play).
- Ground/path/grass/turf/crowd + foliage + jersey sprites already exist and are intentionally NOT re-planned.

## Open questions (0)
