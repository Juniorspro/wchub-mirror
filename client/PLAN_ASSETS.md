# Asset Plan

- Project: dressup-fair (client)
- Planned at:    2026-06-11
- Last verified: 2026-06-11T09:41:01Z — both tracks on disk (2.8 MB + 3.5 MB
  mp3, Suno chirp-crow, 119 s / 148 s), registered in src/assets.ts, fair
  loop confirmed fetched + queued for playback in the live preview after
  the Enter-click unlock; tsc passes. BGM total 6.3 MB (above the ~4 MB
  estimate — Suno picks duration).
- Skill version: rezona-pgc-game-plan-assets
- Mode: 3d (Babylon.js multiplayer template)
- Art-direction anchor: stylized hand-painted toon material, soft flat shading, warm palette (unchanged — no image assets this pass)
- Audio-direction anchor: festive acoustic folk — fingerpicked guitar, accordion, hand percussion, warm fairground carnival feel
- Totals: BGM 2, SFX 0, Image 0 (cutouts: 0), Model 0
- Scope note: AUDIO only. Prior passes covered map textures (2026-06-10) and
  portal cover art (2026-06-11). Ship build measured ~31 MB — over the 25 MB
  law; user explicitly approved proceeding because the game ships via
  Cloudflare Worker/CDN (no downloadable zip), BGM adds ~4 MB. Flagged for a
  future optimization pass (top contributor: 6.9 MB JS bundle + sprite PNGs).

## BGM (2)

### `bgm_fair_loop`
**Prompt:** festive acoustic folk instrumental, fingerpicked guitar, accordion, light hand percussion and claps, upbeat strolling tempo, cheerful fairground carnival warmth, sunny outdoor plaza feel, seamless loop, no fade-out, no vocals
**Rationale:** the main hub track — plays in the stadium park from the moment the player enters the fair; queued via the engine's `bgm.play()` so it starts on the Enter-click audio unlock.

### `bgm_stadium_calm`
**Prompt:** gentle acoustic folk instrumental, slow fingerpicked guitar, soft accordion swells, sparse warm percussion, calm dreamy fairground at dusk, relaxed and cozy, seamless loop, no fade-out, no vocals
**Rationale:** calmer variant for the stadium interior — switches in when the player walks through the south gate into the arena (ellipse zone test with hysteresis), back out to `bgm_fair_loop` in the park.

## SFX (0)

None this pass — engine-level procedural SFX (`@rezona/core` `sfx.*`) already cover taps/collects.

## Image (0)

None this pass.

## Already in `src/assets.ts` (44)

All existing keys intentionally skipped: portal covers (5), tileable textures (4), jersey fabrics (3), shirts/shoes/sprites, glasses GLBs (5), soccer ball + goal models, worldcup posters (2), ground/crowd/turf textures. (The 2026-06-10 texture pass this file previously documented is preserved in git history.)

## Open questions (0)
