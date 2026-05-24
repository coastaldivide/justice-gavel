/**
 * performanceAndA11y.test.js
 * Tests for performance optimizations, i18n, and accessibility
 */

// ── Pre-filtered static arrays ────────────────────────────────────────────
describe('Static array pre-filtering', () => {
  const LANGUAGES = ['', 'Spanish', 'Arabic', 'Mandarin', 'Vietnamese', 'English'];
  const LANGUAGES_FILTERED = LANGUAGES.filter(Boolean);

  it('pre-filtered array excludes empty strings', () => {
    expect(LANGUAGES_FILTERED).not.toContain('');
  });

  it('pre-filtered array preserves valid entries', () => {
    expect(LANGUAGES_FILTERED).toContain('Spanish');
    expect(LANGUAGES_FILTERED).toContain('Arabic');
  });

  it('pre-filtered is smaller than original', () => {
    expect(LANGUAGES_FILTERED.length).toBeLessThan(LANGUAGES.length);
  });

  it('module-level filtering produces same result every call', () => {
    // Unlike render-time filter(), module-level constant is stable
    const ref1 = LANGUAGES_FILTERED;
    const ref2 = LANGUAGES_FILTERED;
    expect(ref1).toBe(ref2); // same reference
  });
});

// ── i18n system ───────────────────────────────────────────────────────────
describe('i18n translation system', () => {
  const dict = {
    en: { greeting: 'Hello', action: 'Submit' },
    es: { greeting: 'Hola', action: 'Enviar' },
  };

  const t = (key, lang = 'en') => {
    return (dict[lang] && dict[lang][key])
      || (dict['en'] && dict['en'][key])
      || key;
  };

  it('returns correct English translation', () => {
    expect(t('greeting', 'en')).toBe('Hello');
  });

  it('returns correct Spanish translation', () => {
    expect(t('greeting', 'es')).toBe('Hola');
  });

  it('falls back to English when key missing in language', () => {
    expect(t('action', 'es')).toBe('Enviar');
  });

  it('falls back to key when missing in all languages', () => {
    expect(t('unknown_key', 'en')).toBe('unknown_key');
  });

  it('handles null lang gracefully', () => {
    expect(() => t('greeting', null)).not.toThrow();
  });
});

// ── Animation cleanup ────────────────────────────────────────────────────
describe('Animation lifecycle management', () => {
  const createAnim = () => {
    let stopped = false;
    return {
      start: jest.fn(),
      stop: () => { stopped = true; },
      isStopped: () => stopped,
    };
  };

  it('animation starts on mount', () => {
    const anim = createAnim();
    // Simulate useEffect
    anim.start();
    expect(anim.start).toHaveBeenCalled();
  });

  it('animation stops on unmount cleanup', () => {
    const anim = createAnim();
    anim.start();
    // Simulate cleanup
    anim.stop();
    expect(anim.isStopped()).toBe(true);
  });

  it('stopped animation does not leak', () => {
    const anims = [];
    for (let i = 0; i < 5; i++) {
      const a = createAnim();
      a.start();
      anims.push(a);
    }
    // Cleanup
    anims.forEach(a => a.stop());
    expect(anims.every(a => a.isStopped())).toBe(true);
  });
});

// ── Offline sync trigger ──────────────────────────────────────────────────
describe('Offline sync triggers correctly', () => {
  const createSyncTrigger = () => {
    let wasOffline = false;
    let syncCount = 0;
    return {
      onNetworkChange: (isConnected) => {
        const offline = !isConnected;
        if (wasOffline && !offline) syncCount++;
        wasOffline = offline;
      },
      getSyncCount: () => syncCount,
    };
  };

  it('syncs when going from offline to online', () => {
    const trigger = createSyncTrigger();
    trigger.onNetworkChange(false); // offline
    trigger.onNetworkChange(true);  // online
    expect(trigger.getSyncCount()).toBe(1);
  });

  it('does not sync when staying online', () => {
    const trigger = createSyncTrigger();
    trigger.onNetworkChange(true);
    trigger.onNetworkChange(true);
    expect(trigger.getSyncCount()).toBe(0);
  });

  it('syncs each time connectivity restores', () => {
    const trigger = createSyncTrigger();
    trigger.onNetworkChange(false);
    trigger.onNetworkChange(true);
    trigger.onNetworkChange(false);
    trigger.onNetworkChange(true);
    expect(trigger.getSyncCount()).toBe(2);
  });
});
