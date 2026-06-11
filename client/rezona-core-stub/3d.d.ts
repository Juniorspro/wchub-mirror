import type { MutableRefObject, RefObject } from 'react';
export declare function ensureAudioReady(): Promise<void>;
export declare const bgm: {
  play(url: string, opts?: { loop?: boolean; volume?: number }): Promise<void>;
  stop(): void;
};
export declare const sfx: { collect(): void };
export interface Input {
  readonly dir: { x: number; y: number };
  setMobileMove(x: number, y: number): void;
  consumeTap(): boolean;
}
export declare function useInput(): Input;
export interface Screen { width: number; height: number; dpr: number }
export declare function useScreen(): {
  screenRef: MutableRefObject<Screen>;
  containerRef: RefObject<HTMLDivElement>;
};
export type Phase = 'ACTIVE' | 'PAUSED' | 'GAME_OVER';
export type EditableSchemaEntry = {
  type: string; label?: string; default: unknown;
  min?: number; max?: number; step?: number; cssVar?: string;
};
export type EditableSchema = Record<string, EditableSchemaEntry>;
export declare function useGameConfig<S extends EditableSchema>(schema: S): {
  configRef: MutableRefObject<{ [K in keyof S]: S[K]['default'] }>;
};
