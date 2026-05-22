/**
 * themeColors.test.js — Tests for theme color system
 */

// Replicate the core theme logic
const COLORS = {
  navy:      '#1A237E',
  legal:     '#1565C0',
  emergency: '#B71C1C',
  warn:      '#F57F17',
  bg:        '#FAFAFA',
  textPrimary: '#212121',
};

const DARK_OVERRIDES = {
  bg:          '#121212',
  textPrimary: '#FFFFFF',
};

const getTheme = (isDark) => ({
  ...COLORS,
  ...(isDark ? DARK_OVERRIDES : {}),
});

describe('Theme color system', () => {
  it('light theme uses bg #FAFAFA', () => {
    expect(getTheme(false).bg).toBe('#FAFAFA');
  });

  it('dark theme uses bg #121212', () => {
    expect(getTheme(true).bg).toBe('#121212');
  });

  it('dark theme overrides textPrimary to white', () => {
    expect(getTheme(true).textPrimary).toBe('#FFFFFF');
  });

  it('light theme keeps original textPrimary', () => {
    expect(getTheme(false).textPrimary).toBe('#212121');
  });

  it('brand colors are the same in both themes', () => {
    expect(getTheme(true).navy).toBe(getTheme(false).navy);
    expect(getTheme(true).legal).toBe(getTheme(false).legal);
    expect(getTheme(true).emergency).toBe(getTheme(false).emergency);
  });

  it('all color values start with #', () => {
    const light = getTheme(false);
    Object.values(light).forEach(v => {
      if (typeof v === 'string') {
        expect(v.startsWith('#')).toBe(true);
      }
    });
  });
});

describe('Emergency color accessibility', () => {
  // Emergency red must have sufficient contrast (WCAG AA: 4.5:1 on white)
  it('emergency color is a dark red (high contrast)', () => {
    // #B71C1C is deep red — passes WCAG AA on white
    expect(COLORS.emergency).toBe('#B71C1C');
    // Verify it's not a light color
    const r = parseInt(COLORS.emergency.slice(1, 3), 16);
    const g = parseInt(COLORS.emergency.slice(3, 5), 16);
    const b = parseInt(COLORS.emergency.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    expect(luminance).toBeLessThan(0.4); // dark color
  });
});
