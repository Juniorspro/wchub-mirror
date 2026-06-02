// ══════════════════════════════════════════════
// Babylon runtime config: stable template-level parameters only.
// Dress-up-specific tunables (body proportions, region defaults, accessory
// offsets) live in their owning modules — actor.ts, items.ts.
// ══════════════════════════════════════════════

export const RUNTIME_CONFIG = {
  engine: {
    antialias: true,
    adaptToDeviceRatio: true,
    preserveDrawingBuffer: true,
    stencil: true,
    lowMemoryHardwareScaling: 1.5,
    defaultHardwareScaling: 1,
  },
  camera: {
    alpha: -Math.PI / 2,
    beta: Math.PI / 2.4,
    radius: 5.5,
    minZ: 0.1,
    maxZ: 120,
    lowerRadiusLimit: 3.0,
    upperRadiusLimit: 11,
  },
  world: {
    clearColor: '#a4c8e8', // warm sky blue for the outdoor fairground
    groundSize: 24,
    fallRecoveryY: -18,
  },
  physics: {
    gravityY: -9.81,
  },
} as const;

export type RuntimeConfig = typeof RUNTIME_CONFIG;
