/**
 * constants/tokens.ts — Design token system
 *
 * Replaces hardcoded fontSize:14, marginHorizontal:16 scattered across
 * 85 screens with named scales. The app becomes reskin-able and consistent.
 *
 * Usage:
 *   import { T, S, R, SHADOW } from '../constants/tokens';
 *   <Text style={{ fontSize: T.body, color: colors.text }}>
 *   <View style={{ padding: S.md, borderRadius: R.card }}>
 */

// ── Typography scale ──────────────────────────────────────────────────────
export const T = {
  xs:      11,   // captions, badges
  sm:      13,   // secondary text, timestamps
  body:    15,   // default body copy
  md:      16,   // list items, form fields
  lg:      18,   // card titles, section labels
  xl:      22,   // screen headers
  xxl:     28,   // hero numbers (bail amount, bail fee)
  xxxl:    36,   // splash screens, large stats
  display: 48,   // Golden Gavel level number
} as const;

export const WEIGHT = {
  regular:   '400' as const,
  medium:    '500' as const,
  semibold:  '600' as const,
  bold:      '700' as const,
  extrabold: '800' as const,
} as const;

// ── Spacing scale (multiples of 4) ────────────────────────────────────────
export const S = {
  xxs: 2,
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
  xxxl:64,
  screen: 16,   // standard horizontal screen margin
  card:   16,   // card inner padding
} as const;

// ── Border radius scale ───────────────────────────────────────────────────
export const R = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  card: 16,
  pill: 999,
  full: 9999,
} as const;

// ── Shadow presets (iOS + Android) ────────────────────────────────────────
export const SHADOW = {
  none: {},
  xs: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius:  2,
    elevation: 1,
  },
  sm: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius:  4,
    elevation: 2,
  },
  md: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius:  8,
    elevation: 4,
  },
  lg: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius:  16,
    elevation: 8,
  },
  xl: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 16 },
    shadowOpacity: 0.18,
    shadowRadius:  32,
    elevation: 16,
  },
} as const;

// ── Animation durations ───────────────────────────────────────────────────
export const DUR = {
  instant:  0,
  fastest:  100,
  fast:     200,
  normal:   300,
  slow:     500,
  slower:   700,
  slowest:  1000,
} as const;

// ── Z-index stack ─────────────────────────────────────────────────────────
export const Z = {
  base:    0,
  raised:  1,
  sticky:  10,
  overlay: 100,
  modal:   1000,
  toast:   2000,
} as const;

// ── Icon sizes ────────────────────────────────────────────────────────────
export const ICON = {
  xs:  14,
  sm:  18,
  md:  22,
  lg:  28,
  xl:  36,
  xxl: 48,
} as const;

// ── Hit slop (minimum 44pt touch targets per WCAG) ────────────────────────
export const HIT_SLOP = {
  xs: { top: 8,  bottom: 8,  left: 8,  right: 8  },
  sm: { top: 12, bottom: 12, left: 12, right: 12 },
  md: { top: 16, bottom: 16, left: 16, right: 16 },
  lg: { top: 20, bottom: 20, left: 20, right: 20 },
} as const;
