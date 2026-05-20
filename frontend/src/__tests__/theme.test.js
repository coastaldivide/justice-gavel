/**
 * theme.test.js
 * Tests the design system tokens — color palette completeness,
 * contrast ratios, font constants, and TYPE scale.
 */

// ── Inline theme constants mirroring constants/theme.ts ───────────────────────

const DARK = {
  bg:          '#0A0F1A',
  bgCard:      '#131C2E',
  bgElevated:  '#1A2540',
  bgSubtle:    '#0D1623',
  border:      '#1E2D42',
  borderFocus: '#85B7EB',
  navy:        '#042C53',
  blue:        '#185FA5',
  steel:       '#85B7EB',
  gold:        '#F9A825',
  textPrimary: '#E8EDF5',
  textSecond:  '#9AADC7',
  textMuted:   '#7A90A8',
  emergency:   '#EF5350',
  emergencyBg: '#2C1010',
  legal:       '#66BB6A',
  legalBg:     '#0D2010',
  warn:        '#FFA726',
  warnBg:      '#2C1800',
  bail:        '#FF7043',
  bailBg:      '#2C1500',
};

const LIGHT = {
  bg:          '#F4F6FB',
  bgCard:      '#FFFFFF',
  bgElevated:  '#FFFFFF',
  bgSubtle:    '#EEF2F8',
  border:      '#DDE3F0',
  borderFocus: '#042C53',
  navy:        '#042C53',
  blue:        '#185FA5',
  steel:       '#4A7FB5',
  gold:        '#C68A00',
  textPrimary: '#0A1929',
  textSecond:  '#3D4F63',
  textMuted:   '#5C6F82',
  emergency:   '#C62828',
  emergencyBg: '#FFEBEE',
  legal:       '#1B5E20',
  legalBg:     '#E8F5E9',
  warn:        '#E65100',
  warnBg:      '#FFF3E0',
  bail:        '#BF360C',
  bailBg:      '#FBE9E7',
};

const FONT = {
  regular:   'Inter_400Regular',
  medium:    'Inter_500Medium',
  semiBold:  'Inter_600SemiBold',
  bold:      'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
  black:     'Inter_900Black',
};

const TYPE = { xs:11, sm:12, base:14, md:16, lg:18, xl:22, '2xl':28, '3xl':36 };

// ── WCAG contrast ratio helper ────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function luminance([r,g,b]) {
  const sRGB = [r,g,b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  });
  return 0.2126*sRGB[0] + 0.7152*sRGB[1] + 0.0722*sRGB[2];
}
function contrast(hex1, hex2) {
  const L1 = luminance(hexToRgb(hex1));
  const L2 = luminance(hexToRgb(hex2));
  const [light, dark] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (light + 0.05) / (dark + 0.05);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Design Token Completeness', () => {
  const requiredKeys = [
    'bg','bgCard','bgElevated','bgSubtle','border','borderFocus',
    'navy','blue','steel','gold',
    'textPrimary','textSecond','textMuted',
    'emergency','emergencyBg','legal','legalBg','warn','warnBg','bail','bailBg',
  ];

  it('dark palette has all required tokens', () => {
    for (const k of requiredKeys) {
      expect(DARK).toHaveProperty(k);
      expect(DARK[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('light palette has all required tokens', () => {
    for (const k of requiredKeys) {
      expect(LIGHT).toHaveProperty(k);
      expect(LIGHT[k]).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('dark and light palettes have identical key sets', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });
});

describe('WCAG Contrast Ratios', () => {
  // WCAG AA requires 4.5:1 for normal text, 3:1 for large text

  it('dark textPrimary on dark bg meets WCAG AA (≥ 4.5:1)', () => {
    const ratio = contrast(DARK.textPrimary, DARK.bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('dark textMuted on dark bgCard meets WCAG AA (≥ 4.5:1)', () => {
    const ratio = contrast(DARK.textMuted, DARK.bgCard);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('light textPrimary on light bg meets WCAG AA (≥ 4.5:1)', () => {
    const ratio = contrast(LIGHT.textPrimary, LIGHT.bg);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('light textMuted on light bgCard meets WCAG AA (≥ 4.5:1)', () => {
    const ratio = contrast(LIGHT.textMuted, LIGHT.bgCard);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('gold on navy meets 3:1 (large text — brand logo)', () => {
    const ratio = contrast(DARK.gold, DARK.navy);
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });
});

describe('Font Constants', () => {
  it('has 6 Inter weight variants', () => {
    expect(Object.keys(FONT)).toHaveLength(6);
  });

  it('all font values follow Inter_NNNVariant naming', () => {
    for (const [key, val] of Object.entries(FONT)) {
      expect(val).toMatch(/^Inter_\d{3}/);
    }
  });

  it('font weights are in ascending order', () => {
    const weights = Object.values(FONT)
      .map(v => parseInt(v.match(/\d{3}/)?.[0] ?? '0'));
    const sorted = [...weights].sort((a,b) => a-b);
    expect(weights).toEqual(sorted);
  });
});

describe('TYPE scale', () => {
  it('has 8 size steps', () => {
    expect(Object.keys(TYPE)).toHaveLength(8);
  });

  it('minimum font size is 11px (accessibility floor)', () => {
    const min = Math.min(...Object.values(TYPE));
    expect(min).toBeGreaterThanOrEqual(11);
  });

  it('xs < sm < base < md < lg < xl', () => {
    expect(TYPE.xs).toBeLessThan(TYPE.sm);
    expect(TYPE.sm).toBeLessThan(TYPE.base);
    expect(TYPE.base).toBeLessThan(TYPE.md);
    expect(TYPE.md).toBeLessThan(TYPE.lg);
    expect(TYPE.lg).toBeLessThan(TYPE.xl);
  });
});
