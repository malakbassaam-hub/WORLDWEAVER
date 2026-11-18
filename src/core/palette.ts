import type { ColorHex } from './types';

/**
 * Luminous Night palette. Shared by the inspector (one-click looks) and the
 * AI World Director (the only colours a proposal may request).
 */
export const LUMINOUS_PALETTE = [
  { name: 'Aether Cyan', color: '#7fe8ff', emissive: '#2fd4ff' },
  { name: 'Night Violet', color: '#b48cff', emissive: '#8b5cff' },
  { name: 'Orchid Flare', color: '#ff9ce6', emissive: '#ff4fc8' },
  { name: 'Aurora Mint', color: '#8cffd6', emissive: '#2cf0a8' },
  { name: 'Ember Gold', color: '#ffd29a', emissive: '#ff9a3c' },
  { name: 'Moon White', color: '#eef1ff', emissive: '#a9b8ff' },
] as const satisfies ReadonlyArray<{ name: string; color: ColorHex; emissive: ColorHex }>;

export type PaletteName = (typeof LUMINOUS_PALETTE)[number]['name'];
