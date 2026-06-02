// ══════════════════════════════════════════════
// EDITABLE schema — knobs exposed to the external editor.
// Outfit state lives in src/babylon/store.ts (persisted to localStorage),
// not in this schema, because the wardrobe UI is the source of truth.
// ══════════════════════════════════════════════

import type { EditableSchema } from '@rezona/core/3d';

// LLM-EXTENSION:CONFIG — Public dress-up studio knobs. Internal constants (body proportions, socket offsets, region default colors) stay in the modules that own them.
// DO NOT REMOVE the LLM-EXTENSION:CONFIG tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
export const SCHEMA = {
  // LLM-EXTENSION:SCHEMA — editor-tunable studio parameters (background tint, character idle-spin speed, camera look feel).
  // DO NOT REMOVE the LLM-EXTENSION:SCHEMA tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  bgColor: {
    type: 'color',
    label: 'Background',
    default: '#f6f1e9',
    cssVar: '--bg-color',
  },
  fgColor: {
    type: 'color',
    label: 'Foreground',
    default: '#1a1a1d',
    cssVar: '--fg-color',
  },
  idleRotationSpeed: {
    type: 'number',
    label: 'Idle Rotation (rad/s)',
    default: 0.25,
    min: 0,
    max: 2,
    step: 0.05,
  },
  lookSensitivity: {
    type: 'number',
    label: 'Look Sensitivity',
    default: 0.002,
    min: 0.0005,
    max: 0.01,
    step: 0.0005,
  },
} satisfies EditableSchema;

export type Config = { [K in keyof typeof SCHEMA]: (typeof SCHEMA)[K]['default'] };
