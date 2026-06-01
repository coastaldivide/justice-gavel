/**
 * utils/responsive.ts — Unified responsive layout utilities
 *
 * Single source of truth for all screen-size decisions.
 * Supports: iPhone SE (320pt) → iPhone Pro Max (430pt) → iPad (768pt+) → Web
 *
 * Usage:
 *   import { r, isTablet, isWeb, CONTENT_MAX_WIDTH } from '../utils/responsive';
 *   <View style={{ width: r(320), maxWidth: CONTENT_MAX_WIDTH }}>
 *   <Text style={{ fontSize: r.font(16) }}>
 */

import { Dimensions, Platform, PixelRatio, ScaledSize } from 'react-native';

// ── Screen dimensions ──────────────────────────────────────────────────────────
let { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// Re-compute on orientation change
Dimensions.addEventListener('change', ({ window }: { window: ScaledSize }) => {
  SCREEN_W = window.width;
  SCREEN_H = window.height;
});

// ── Platform flags ─────────────────────────────────────────────────────────────
export const isWeb     = Platform.OS === 'web';
export const isIOS     = Platform.OS === 'ios';
export const isAndroid = Platform.OS === 'android';

// Tablet: iPad (768pt+), Android tablet, or wide web window
export const isTablet  = () =>
  SCREEN_W >= 768 || (Platform.OS === 'ios' && SCREEN_W >= 768);

export const isSmallPhone = () => SCREEN_W <= 375;   // iPhone SE, older Androids
export const isLargePhone = () => SCREEN_W >= 414;   // Plus/Max sizes

// ── Content constraints ────────────────────────────────────────────────────────
// Cards, forms, and text content should never exceed this width.
// On tablet: centered column. On phone: full width with padding.
export const CONTENT_MAX_WIDTH = 600;
export const CARD_MAX_WIDTH    = 540;
export const MODAL_MAX_WIDTH   = 480;

// Content padding adapts to screen width
export const contentPadding = () => isTablet() ? 48 : 16;
export const cardPadding    = () => isTablet() ? 24 : 16;

// ── Responsive scaling ─────────────────────────────────────────────────────────
// Scales values proportionally to the current screen width.
// Base reference: 390pt (iPhone 14 / most common phone width)
const BASE_WIDTH = 390;

export function scale(size: number): number {
  // On web and tablet, scale up to a reasonable max
  const factor = Math.min(SCREEN_W / BASE_WIDTH, isTablet() ? 1.3 : 1.15);
  return Math.round(size * factor);
}

// Font scale: more conservative — don't grow fonts as aggressively as layout
export function fontScale(size: number): number {
  const factor = Math.min(SCREEN_W / BASE_WIDTH, isTablet() ? 1.15 : 1.05);
  return Math.round(size * factor * 10) / 10;
}

// Responsive shorthand
export const r = Object.assign(scale, { font: fontScale });

// ── Layout helpers ─────────────────────────────────────────────────────────────
// Returns the number of columns for a grid at current screen size
export function gridColumns(itemMinWidth: number = 160): number {
  const w = isWeb ? Math.min(SCREEN_W, 1200) : SCREEN_W;
  return Math.max(1, Math.floor(w / itemMinWidth));
}

// Returns consistent card width for grid layouts
export function cardWidth(columns: number = 1, gap: number = 16): number {
  const w = Math.min(SCREEN_W, CONTENT_MAX_WIDTH);
  return (w - contentPadding() * 2 - gap * (columns - 1)) / columns;
}

// ── Common responsive styles ───────────────────────────────────────────────────
// Use these in StyleSheet.create() for consistent cross-platform layout

export const responsiveStyles = {
  /** Centers content with max-width on tablet, full-width on phone */
  contentContainer: {
    width: '100%' as const,
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center' as const,
    paddingHorizontal: contentPadding(),
  },

  /** Full-width container that respects tablet centering */
  screenContainer: {
    flex: 1 as const,
    alignItems: 'center' as const,
  },

  /** Card that never exceeds readable width */
  card: {
    width: '100%' as const,
    maxWidth: CARD_MAX_WIDTH,
    alignSelf: 'center' as const,
  },

  /** Modal/dialog width adapts to screen */
  modal: {
    width: '100%' as const,
    maxWidth: MODAL_MAX_WIDTH,
    alignSelf: 'center' as const,
  },
};

// ── Shadow helper (cross-platform) ────────────────────────────────────────────
// React Native shadow props only work on iOS.
// On web, use CSS boxShadow. On Android, use elevation.
export function shadow(depth: 1 | 2 | 3 | 4 = 2): object {
  if (isWeb) {
    const shadows = {
      1: '0 1px 4px rgba(0,0,0,0.08)',
      2: '0 2px 8px rgba(0,0,0,0.10)',
      3: '0 4px 16px rgba(0,0,0,0.12)',
      4: '0 8px 32px rgba(0,0,0,0.16)',
    };
    return { boxShadow: shadows[depth] } as any;
  }
  const configs = {
    1: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4,  elevation: 2 },
    2: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8,  elevation: 4 },
    3: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 },
    4: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 32, elevation: 16 },
  };
  return configs[depth];
}
