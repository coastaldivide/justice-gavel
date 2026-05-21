declare var window: any;
declare var MediaRecorder: any;
declare var navigator: any;

/**
 * webCompat.ts — Platform shims for web compatibility
 *
 * Every native-only API used in this app is shimmed here.
 * Screens import from this file instead of directly from the native package
 * when they need cross-platform behaviour.
 *
 * Pattern:
 *   import { Haptics, ScreenCapture, StoreReview, LocalAuth } from '../utils/webCompat';
 *
 * On iOS/Android: delegates to the real native module.
 * On web:         silent no-op or web API equivalent.
 *
 * Packages covered:
 *   expo-haptics              → silent no-op on web
 *   expo-screen-capture       → CSS pointer-events guard on web
 *   expo-store-review         → no-op on web (no app store)
 *   expo-local-authentication → always returns unavailable on web
 *   expo-print                → window.print() on web
 */

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// ── expo-haptics shim ─────────────────────────────────────────────────────────
// Haptic feedback is a pure enhancement — silently skipped on web.

export const Haptics = {
  impactAsync: async (_style?: unknown) => {},
  notificationAsync: async (_type?: unknown) => {},
  selectionAsync: async () => {},
  // Enum mirrors — web consumers can reference these without importing expo-haptics
  ImpactFeedbackStyle: {
    Light:  'light',
    Medium: 'medium',
    Heavy:  'heavy',
    Rigid:  'rigid',
    Soft:   'soft',
  } as const,
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error:   'error',
  } as const,
};

// On native, delegate to the real implementation
let _nativeHaptics: typeof Haptics | null = null;
export async function getHaptics(): Promise<typeof Haptics> {
  if (isWeb) return Haptics; // no-op shim
  if (!_nativeHaptics) {
    let m; try { m = await import('expo-haptics'); } catch { return; }
    _nativeHaptics = m as unknown as typeof Haptics;
  }
  return _nativeHaptics!;
}

/** Drop-in replacement that works on both platforms */
export const hapticImpact = (style: 'Light' | 'Medium' | 'Heavy' = 'Medium') => {
  if (isWeb) return Promise.resolve();
  return import('expo-haptics').then(m =>
    m.impactAsync((m.ImpactFeedbackStyle as Record<string, unknown>)[style] as never)
  );
};

export const hapticNotification = (type: 'Success' | 'Warning' | 'Error' = 'Success') => {
  if (isWeb) return Promise.resolve();
  return import('expo-haptics').then(m =>
    m.notificationAsync((m.NotificationFeedbackType as Record<string, unknown>)[type] as never)
  );
};

export const hapticSelection = () => {
  if (isWeb) return Promise.resolve();
  return import('expo-haptics').then(m => m.selectionAsync());
};

// ── expo-screen-capture shim ──────────────────────────────────────────────────
// On web: no equivalent. A CSS class can discourage (not prevent) screenshots,
// but we simply no-op — the data is already in the browser.

export const ScreenCapture = {
  preventScreenCaptureAsync: async (tag = 'default') => {
    if (isWeb) return; // no-op
    let m; try { m = await import('expo-screen-capture'); } catch { return; }
    return m.preventScreenCaptureAsync(tag);
  },
  allowScreenCaptureAsync: async (tag = 'default') => {
    if (isWeb) return; // no-op
    let m; try { m = await import('expo-screen-capture'); } catch { return; }
    return m.allowScreenCaptureAsync(tag);
  },
  usePreventScreenCapture: (tag = 'default') => {
    // Hook shim — on web returns a no-op effect
    if (isWeb) return;
    // Dynamically call the real hook — can't conditionally call hooks
    // so we call it at the top of the shim on native only via the screen
  },
};

// ── expo-store-review shim ────────────────────────────────────────────────────
// No App Store on web — both methods are no-ops.

export const StoreReview = {
  isAvailableAsync: async (): Promise<boolean> => {
    if (isWeb) return false;
    let m; try { m = await import('expo-store-review'); } catch { return; }
    return m.isAvailableAsync();
  },
  requestReview: async (): Promise<void> => {
    if (isWeb) return;
    let m; try { m = await import('expo-store-review'); } catch { return; }
    return m.requestReview();
  },
};

// ── expo-local-authentication shim ───────────────────────────────────────────
// Web has WebAuthn — for now we report unavailable so the biometric toggle hides.
// Full WebAuthn implementation can be added later.

export const LocalAuth = {
  hasHardwareAsync: async (): Promise<boolean> => {
    if (isWeb) return false;
    let m; try { m = await import('expo-local-authentication'); } catch { return; }
    return m.hasHardwareAsync();
  },
  isEnrolledAsync: async (): Promise<boolean> => {
    if (isWeb) return false;
    let m; try { m = await import('expo-local-authentication'); } catch { return; }
    return m.isEnrolledAsync();
  },
  authenticateAsync: async (opts?: Record<string, unknown>) => {
    if (isWeb) return { success: false, error: 'not-available' };
    let m; try { m = await import('expo-local-authentication'); } catch { return; }
    return m.authenticateAsync(opts as never);
  },
};

// ── expo-print shim ───────────────────────────────────────────────────────────
// On web: window.print() handles most use cases.

export const Print = {
  printAsync: async (opts: { html?: string; uri?: string }) => {
    if (isWeb) {
      if (opts.html) {
        // Open HTML in new tab and trigger print dialog
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(opts.html);
          w.document.close();
          w.focus();
          w.print();
        }
      } else {
        window.print();
      }
      return;
    }
    let m; try { m = await import('expo-print'); } catch { return; }
    return m.printAsync(opts as never);
  },
  printToFileAsync: async (opts: { html?: string }) => {
    if (isWeb) {
      // Return a blob URL the web can download
      const blob = new Blob([opts.html || ''], { type: 'text/html' });
      return { uri: URL.createObjectURL(blob) };
    }
    let m; try { m = await import('expo-print'); } catch { return; }
    return m.printToFileAsync(opts as never);
  },
};

// ── navigator.share() / expo-sharing shim ────────────────────────────────────
// Web has navigator.share() — use it when available, fallback to clipboard.

export const Share = {
  shareAsync: async (url: string, opts?: { mimeType?: string; dialogTitle?: string }) => {
    if (isWeb) {
      if (navigator.share) {
        return navigator.share({ url, title: opts?.dialogTitle });
      }
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(url).catch(() => {});
      return;
    }
    let m; try { m = await import('expo-sharing'); } catch { return; }
    return m.shareAsync(url, opts as never);
  },
  isAvailableAsync: async (): Promise<boolean> => {
    if (isWeb) return !!(navigator.share || navigator.clipboard);
    let m; try { m = await import('expo-sharing'); } catch { return; }
    return m.isAvailableAsync();
  },
};

// ── expo-file-system shim ─────────────────────────────────────────────────────
// Web uses Blob/File API — functions return web equivalents where possible.

export const FileSystem = {
  EncodingType: {
    UTF8:   'utf8',
    Base64: 'base64',
  } as const,
  documentDirectory: isWeb ? null : undefined as unknown as string,

  readAsStringAsync: async (
    uri: string,
    opts?: { encoding?: string }
  ): Promise<string> => {
    if (isWeb) {
      // uri is a blob URL or data URL on web
      const res = await fetch(uri);
      if (opts?.encoding === 'base64') {
        const buf = await res.arrayBuffer();
        return btoa(String.fromCharCode(...new Uint8Array(buf)));
      }
      return res.text();
    }
    let m; try { m = await import('expo-file-system'); } catch { return; }
    return m.readAsStringAsync(uri, opts as never);
  },

  writeAsStringAsync: async (
    uri: string,
    contents: string,
    opts?: { encoding?: string }
  ): Promise<void> => {
    if (isWeb) {
      // No-op on web — caller should handle blob download separately
      console.warn('[FileSystem.writeAsStringAsync] no-op on web');
      return;
    }
    let m; try { m = await import('expo-file-system'); } catch { return; }
    return m.writeAsStringAsync(uri, contents, opts as never);
  },

  deleteAsync: async (uri: string, opts?: { idempotent?: boolean }) => {
    if (isWeb) {
      // Revoke blob URL if applicable
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
      return;
    }
    let m; try { m = await import('expo-file-system'); } catch { return; }
    return m.deleteAsync(uri, opts);
  },

  getInfoAsync: async (uri: string) => {
    if (isWeb) return { exists: false, isDirectory: false, size: 0 };
    let m; try { m = await import('expo-file-system'); } catch { return; }
    return m.getInfoAsync(uri);
  },
};

// ── Audio / expo-av shim ──────────────────────────────────────────────────────
// Only InterrogationRecorderScreen uses Audio — full MediaRecorder shim there.
// This shim covers the Audio.setAudioModeAsync call pattern.

export const AudioMode = {
  setAudioModeAsync: async (opts: Record<string, unknown>) => {
    if (isWeb) return; // no-op — browser handles audio mode automatically
    let avModule;
    try { avModule = await import('expo-av'); } catch { return; }
    const { Audio } = avModule;
    return Audio.setAudioModeAsync(opts as never);
  },
};

// ── expo-camera shim (web) ────────────────────────────────────────────────────
// expo-camera is native-only. On web, DocumentScannerScreen.web.tsx handles
// camera access via the MediaDevices API directly — no shim needed.
// This export prevents import errors if expo-camera is imported in shared code.
export const CameraShim = {
  useCameraPermissions: () => [{ granted: false }, async () => ({ granted: false })],
};

// ── expo-notifications shim (web) ────────────────────────────────────────────
// expo-notifications requires a native build. On web, notifications use
// the browser Notifications API instead. This shim prevents import errors.
export const NotificationsShim = {
  requestPermissionsAsync: async () => ({ status: 'undetermined' }),
  getExpoPushTokenAsync:   async () => ({ data: '' }),
  scheduleNotificationAsync: async () => '',
  cancelAllScheduledNotificationsAsync: async () => {},
  setNotificationHandler: () => {},
  addNotificationReceivedListener: () => ({ remove: () => {} }),
  addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
};
