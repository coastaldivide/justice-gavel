/**
 * theme.ts — Justice Gavel Design System v2
 *
 * Typography: Inter (loaded via expo-font)
 * Brand:      navy #042C53 · gold #F9A825 · steel #85B7EB
 * Modes:      dark (default) + light (user-switchable via Settings)
 */
import React, { createContext, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────────────────────────
// Font family constants — always use these, never raw strings
// ─────────────────────────────────────────────────────────────────────────────
export const FONT = {
  regular:   'Inter_400Regular',
  medium:    'Inter_500Medium',
  semiBold:  'Inter_600SemiBold',
  bold:      'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
  black:     'Inter_900Black',
  mono:      'monospace',
};

// Fallback while fonts are loading (system default)
export const FONT_FALLBACK = {
  regular:   undefined,
  medium:    undefined,
  semiBold:  undefined,
  bold:      undefined,
  extraBold: undefined,
  black:     undefined,
};

// ─────────────────────────────────────────────────────────────────────────────
// Type scale — 8 intentional steps, no one-offs
// ─────────────────────────────────────────────────────────────────────────────
export const TYPE = {
  xs:   11,   // captions, tags, badges
  sm:   12,   // hints, secondary labels
  base: 14,   // body text
  md:   16,   // list items, card text
  lg:   18,   // subheadings
  xl:   22,   // section headings
  '2xl': 28,  // screen titles
  '3xl': 36,  // display / countdown numbers
  '4xl': 48,  // hero numbers, bail amount display
  '5xl': 60,  // splash screen, onboarding hero
  '6xl': 80,  // full-screen countdown
  hero:  30,  // large stat numbers
  display: 42, // score / points / large metrics
};

// ─────────────────────────────────────────────────────────────────────────────
// Line height scale (ratio-based, pairs with TYPE)
// ─────────────────────────────────────────────────────────────────────────────
export const LINE = {
  tight:  1.2,   // headings
  snug:   1.35,  // subheadings
  normal: 1.5,   // body
  relaxed:1.65,  // long-form text / legal content
};

// ─────────────────────────────────────────────────────────────────────────────
// Letter spacing
// ─────────────────────────────────────────────────────────────────────────────
export const TRACKING = {
  tight:  -0.3,
  normal:  0,
  wide:    0.4,
  wider:   0.8,
  widest:  1.2,
};

// ─────────────────────────────────────────────────────────────────────────────
// DARK palette  (default)
// ─────────────────────────────────────────────────────────────────────────────
export const DARK_COLORS = {
  // Brand
  navy:         '#042C53',
  navyMid:      '#0A3D6B',
  blue:         '#185FA5',
  steel:        '#85B7EB',
  steelMid:     '#5B9BD5',
  gold:         '#F9A825',

  // Semantic
  emergency:    '#EF5350',
  emergencyBg:  '#2C1010',
  emergencyDark:'#C62828',
  bail:         '#FF7043',
  bailBg:       '#2C1500',
  legal:        '#66BB6A',
  legalBg:      '#0D2010',
  legalDark:    '#2E7D32',
  warn:         '#FFA726',
  warnBg:       '#2C1800',
  warnDark:     '#FF8F4D',  // was #E65100 — 4.48:1 on warnBg; now 7.5:1
  info:         '#85B7EB',
  infoBg:       '#0D1F35',

  // Surfaces
  bg:           '#0A0F1A',
  bgCard:       '#131C2E',
  bgElevated:   '#1A2540',
  bgSubtle:     '#0D1623',

  // Borders
  border:       '#1E2D42',
  borderFocus:  '#85B7EB',
  borderStrong: '#2A3D58',

  // Text — all pass WCAG AA
  textPrimary:  '#E8EDF5',  // 16.3:1 on bg ✓ AAA
  textSecond:   '#9AADC7',  // 8.4:1 on bg  ✓ AAA
  textMuted:    '#8CA2BA',  // ≥5.5:1 on every dark surface incl. legacy card ✓ AA
  textFaint:    '#4A6070',  // large/decorative only

  // Text on colored (accent) backgrounds — chosen per-mode to pass AA
  white:        '#FFFFFF',  // true white in both modes (fixed-dark backdrops)
  black:        '#000000',  // true black in both modes (shadows, scrims)
  textOnNavy:   '#FFFFFF',  // on navy/blue surfaces (navy is dark in both modes)
  textOnAccent: '#0A0F1A',  // on legal/emergency/bail/primary buttons (light accents in dark mode)
  textOnGold:   '#231A00',  // on gold/warn surfaces (always light-ish)
  goldText:     '#F9A825',  // gold used AS text ✓ AA on dark surfaces
  textBrand:    '#85B7EB',  // brand heading text (navy in light mode, steel in dark)

  // Tab bar
  tabBg:        '#0D1623',
  tabBorder:    '#1E2D42',
  tabActive:    '#85B7EB',
  tabInactive:  '#8CA2BA',  // was #4A6070 — 2.5:1 on tab bar (axe fail)

  // Input
  inputBg:      '#131C2E',
  inputBorder:  '#1E2D42',
  inputText:    '#E8EDF5',
  placeholder:  '#4A6070',

  // Header
  headerBg:     '#0D1623',
  headerText:   '#E8EDF5',
  headerBorder: '#1E2D42',

  // Overlay
  overlay:      'rgba(2,14,28,0.85)',

  bailLight: '#2D1A15',
  card: '#1E2A3A',
  cardBody: '#B0C4DE',
  danger: '#EF5350',
  emergencyLight: '#2D1315',
  errorBg: '#2D1B1B',
  legalLight: '#1A2E1A',
  navyLight: '#0D2A4A',
  primary: '#4A8BC4',
  steelDark: '#2D5A8E',
  steelLight: '#4A7FB5',
  surface: '#1E2A3A',
  textDark: '#E0E7EF',
  textLight: '#B0BEC5',
  warnLight: '#2D1F0A',
  cardTitle:   '#E8EDF5',   // was navy — invisible on dark cards
  borderSubtle:'rgba(255,255,255,0.08)',
  text:        '#FFFFFF',
  isDark: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// LIGHT palette
// ─────────────────────────────────────────────────────────────────────────────
export const LIGHT_COLORS = {
  // Brand
  navy:         '#042C53',
  navyMid:      '#0A3D6B',
  blue:         '#185FA5',
  steel:        '#85B7EB',
  steelMid:     '#4A7FB5',
  gold:         '#C68A00',  // darkened for light mode contrast

  // Semantic
  emergency:    '#C62828',
  emergencyBg:  '#FFEBEE',
  emergencyDark:'#B71C1C',
  bail:         '#BF360C',
  bailBg:       '#FBE9E7',
  legal:        '#1B5E20',
  legalBg:      '#E8F5E9',
  legalDark:    '#1B5E20',
  warn:         '#E65100',
  warnBg:       '#FFF3E0',
  warnDark:     '#BF360C',
  info:         '#185FA5',
  infoBg:       '#E8F2FC',

  // Surfaces
  bg:           '#F4F6FB',
  bgCard:       '#FFFFFF',
  bgElevated:   '#FFFFFF',
  bgSubtle:     '#EEF2F8',

  // Borders
  border:       '#DDE3F0',
  borderFocus:  '#042C53',
  borderStrong: '#B0BEC5',

  // Text — all pass WCAG AA
  textPrimary:  '#0A1929',  // 16.4:1 on bg ✓ AAA
  textSecond:   '#3D4F63',  // 8.9:1 on bg  ✓ AAA  (was #4A5568)
  textMuted:    '#5C6F82',  // 5.4:1 on white ✓ AA  (was #8896AB = 3.0 FAIL — fixed)
  textFaint:    '#8FA3B1',  // large/decorative only

  // Text on colored (accent) backgrounds — chosen per-mode to pass AA
  white:        '#FFFFFF',  // true white in both modes (fixed-dark backdrops)
  black:        '#000000',  // true black in both modes (shadows, scrims)
  textOnNavy:   '#FFFFFF',  // on navy/blue surfaces
  textOnAccent: '#FFFFFF',  // on legal/emergency/bail buttons (dark accents in light mode)
  textOnGold:   '#231A00',  // on gold/warn surfaces (always light-ish)
  goldText:     '#8A6200',  // gold used AS text ✓ 5.5:1 on white
  textBrand:    '#042C53',  // brand heading text (navy in light mode, steel in dark)

  // Tab bar
  tabBg:        '#FFFFFF',
  tabBorder:    '#DDE3F0',
  tabActive:    '#042C53',
  tabInactive:  '#5C6F82',  // was #8FA3B1 — 2.6:1 on white tab bar (axe fail)

  // Input
  inputBg:      '#FFFFFF',
  inputBorder:  '#DDE3F0',
  inputText:    '#0A1929',
  placeholder:  '#8FA3B1',

  // Header
  headerBg:     '#FFFFFF',
  headerText:   '#0A1929',
  headerBorder: '#DDE3F0',

  // Overlay
  overlay:      'rgba(10,25,41,0.6)',


  // Legacy aliases — kept for backward compat
  surface:    '#FFFFFF',    // = bgCard
  primary:    '#042C53',    // = navy
  danger:     '#C62828',    // = emergency
  errorBg:    '#FFEBEE',    // = emergencyBg
  card:       '#FFFFFF',    // = bgCard
  cardBody:   '#3D4F63',    // = textSecond
  textLight:  '#8FA3B1',    // = textFaint
  textDark:   '#0A1929',    // = textPrimary
  isDark: false,
  steelDark:    '#3A6EA5',    // darker steel blue
  steelLight:   '#B8D4F0',    // lighter steel
  navyLight:    '#1A4A7A',    // lighter navy
  legalLight:   '#E8F5E9',    // = legalBg
  warnLight:    '#FFF3E0',    // = warnBg
  bailLight:    '#FBE9E7',    // = bailBg
  emergencyLight: '#FFEBEE',  // = emergencyBg
  cardTitle:    '#042C53',    // card headings (navy on white)
  borderSubtle: 'rgba(4,44,83,0.10)',
  text:         '#0A1929',    // = textPrimary (dark text in light mode)
};

// Keep for legacy imports not yet migrated
export const COLORS = LIGHT_COLORS;

// ─────────────────────────────────────────────────────────────────────────────
// Semantic color map — use these keys in screens instead of raw palette
// ─────────────────────────────────────────────────────────────────────────────
// colors.emergency, colors.legal, colors.warn etc. are already on the palette.
// Additional aliases:
// colors.bg        → screen background
// colors.bgCard    → card/sheet surface
// colors.bgElevated → modal/elevated surface
// colors.border    → default border
// colors.textPrimary / textSecond / textMuted → text hierarchy

// ─────────────────────────────────────────────────────────────────────────────
// FONTS helper (weight + family together)
// ─────────────────────────────────────────────────────────────────────────────
export const FONTS = {
  regular:   { fontFamily: FONT.regular,   fontWeight: '400' as const },
  medium:    { fontFamily: FONT.medium,    fontWeight: '500' as const },
  semiBold:  { fontFamily: FONT.semiBold,  fontWeight: '600' as const },
  bold:      { fontFamily: FONT.bold,      fontWeight: '700' as const },
  extraBold: { fontFamily: FONT.extraBold, fontWeight: '800' as const },
  black:     { fontFamily: FONT.black,     fontWeight: '900' as const },
  // Legacy keys (backward compat)
  reg:       { fontFamily: FONT.regular,   fontWeight: '400' as const },
  semi:      { fontFamily: FONT.semiBold,  fontWeight: '600' as const },
  heavy:     { fontFamily: FONT.extraBold, fontWeight: '800' as const },
};

// ─────────────────────────────────────────────────────────────────────────────
// Spacing, radius, shadows
// ─────────────────────────────────────────────────────────────────────────────
export const SPACE = {
  '1': 4, '2': 8, '3': 12, '4': 16, '5': 20, '6': 24,
  '8': 32, '10': 40, '12': 48, '16': 64,
};

export const RADIUS = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999,
};

export const SHADOW = {
  sm:   { shadowColor: '#042C53', shadowOpacity: 0.08, shadowRadius: 4,  shadowOffset: { width: 0, height: 2 },  elevation: 2 },
  md:   { shadowColor: '#042C53', shadowOpacity: 0.12, shadowRadius: 8,  shadowOffset: { width: 0, height: 4 },  elevation: 4 },
  lg:   { shadowColor: '#042C53', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },  elevation: 8 },
  glow: { shadowColor: '#B71C1C', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },  elevation: 10 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Theme context
// ─────────────────────────────────────────────────────────────────────────────
export type ThemeColors = typeof DARK_COLORS;

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  toggleDark: () => void;
  fontsLoaded: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: DARK_COLORS,
  isDark: true,
  toggleDark: () => {},
  fontsLoaded: false,
});

const THEME_KEY = 'jg_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = React.useState(true);
  const [fontsLoaded, setFontsLoaded] = React.useState(false);

  // Load persisted theme preference
  useEffect(() => {
    AsyncStorage.getItem(THEME_KEY).then(val => {
      if (val !== null) setIsDark(val === 'dark');
    }).catch(() => {});
  }, []);

  // Load Inter fonts
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const Font = await import('expo-font');
        await Font.loadAsync({
          Inter_400Regular:   require('../../assets/fonts/Inter_400Regular.ttf'),
          Inter_500Medium:    require('../../assets/fonts/Inter_500Medium.ttf'),
          Inter_600SemiBold:  require('../../assets/fonts/Inter_600SemiBold.ttf'),
          Inter_700Bold:      require('../../assets/fonts/Inter_700Bold.ttf'),
          Inter_800ExtraBold: require('../../assets/fonts/Inter_800ExtraBold.ttf'),
          Inter_900Black:     require('../../assets/fonts/Inter_900Black.ttf'),
        });
        if (!cancelled) setFontsLoaded(true);
      } catch {
        // Fonts unavailable — fall back to system font gracefully
        if (!cancelled) setFontsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleDark = () => {
    setIsDark(prev => {
      const next = !prev;
      AsyncStorage.setItem(THEME_KEY, next ? 'dark' : 'light').catch(() => {});
      return next;
    });
  };

  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  return React.createElement(
    ThemeContext.Provider,
    { value: { colors, isDark, toggleDark, fontsLoaded } as any },
    children
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

// ── Dark mode color palette ────────────────────────────────────────────────────
// Applied automatically when userInterfaceStyle='automatic' and OS is in dark mode
export const darkColors = {
  background:     '#0A0F1A',
  surface:        '#111827',
  surfaceVariant: '#1E2A3A',
  border:         '#1E2A3A',
  textPrimary:    '#F3F4F6',
  textSecondary:  '#9CA3AF',
  textMuted:      '#6B7280',
  primary:        '#3B82F6',  // blue — same as light, readable on dark bg
  primaryDark:    '#1D4ED8',
  gold:           '#F59E0B',
  goldLight:      '#FCD34D',
  error:          '#F87171',
  success:        '#34D399',
  warning:        '#FBBF24',
  errorBg:        '#FFEBEE',  // light red — error card background (light mode)
  errorLight:     '#FAECE7',  // warm peach — soft error / advisory background
  navy:           '#042C53',  // brand navy — same in both modes
};


// ─────────────────────────────────────────────────────────────────────────────
// ART — fixed artwork / illustration / chart colors (identical in both modes).
// These are decorative drawing colors, not UI semantics: illustrations and the
// logo keep the same inks in light and dark mode.
// ─────────────────────────────────────────────────────────────────────────────
export const ART = {
  silver:    '#E8ECF4',  // metal highlights, scale pans
  mist:      '#EEF3FA',  // pale backdrop wash
  steelTint: '#C9DAEA',  // light steel shading
  amber:     '#F59E0B',  // amber/gold accents (charts, badges)
  amberDeep: '#E8A800',  // deeper amber shading
  brassGold: '#C9A84C',  // brass gavel gold
  bronze:    '#8B6914',  // dark bronze (gold gradient base)
  purple:    '#7B1FA2',  // categorical chart hue
  blushTint: '#FFF3F3',  // pale red tint
  roseTint:  '#F5E8E8',  // muted rose tint
  lilacTint: '#F3E5F5',  // pale lilac tint
};

// ─────────────────────────────────────────────────────────────────────────────
// TINTS — categorical tinted-badge pairs (pale background + dark text, AA ≥ 4.5).
// Used by status/category badges; identical in both modes by design.
// ─────────────────────────────────────────────────────────────────────────────
export const TINTS = {
  pink:     { bg: '#FCE4EC', text: '#880E4F' },
  blue:     { bg: '#E3F2FD', text: '#0D47A1' },
  green:    { bg: '#E8F5E9', text: '#1B5E20' },
  greenAlt: { bg: '#E8F5E9', text: '#2E7D32' },
  orange:   { bg: '#FFF3E0', text: '#E65100' },
  violet:   { bg: '#EDE7F6', text: '#4527A0' },
  purple:   { bg: '#F3E5F5', text: '#6A1B9A' },
  indigo:   { bg: '#E8EAF6', text: '#283593' },
  gray:     { bg: '#F5F5F5', text: '#424242' },
  amber:    { bg: '#FFF8E1', text: '#5D4037', border: '#F9A825' },
};

// Toast notification variants (pale card + dark text + accent border, AA ≥ 4.5)
export const TOAST_TINTS = {
  success: { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  error:   { bg: '#FCEBEB', text: '#A32D2D', border: '#E24B4A' },
  info:    { bg: '#E6F1FB', text: '#185FA5', border: '#378ADD' },
  warning: { bg: '#FAEEDA', text: '#854F0B', border: '#BA7517' },
};

// Accent strip colors for the dark toast card (ToastProvider)
export const TOAST_ACCENTS = {
  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',
};
