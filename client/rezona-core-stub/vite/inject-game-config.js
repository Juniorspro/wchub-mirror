// Offline stub: main.tsx already hard-codes window.GAME_CONFIG as a fallback,
// so the plugin can be a no-op.
export function injectGameConfigPlugin() {
  return { name: 'rezona-inject-game-config-stub' };
}
