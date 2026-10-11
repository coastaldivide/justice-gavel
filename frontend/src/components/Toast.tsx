/**
 * Toast.tsx — Non-modal notification system
 * Replaces Alert.alert() for success/error/info feedback.
 * Usage: const { showToast } = useToast();
 *        showToast('Saved!', 'success');
 */
import React, {
  createContext, useContext, useState, useCallback,
  useRef, useEffect,
} from 'react';
import { TOAST_TINTS, COLORS as THEME_COLORS } from '../constants/theme';
import {
  View, Text, Animated, StyleSheet, Platform,
  AccessibilityInfo,
} from 'react-native';

type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  id:       number;
  message:  string;
  variant:  ToastVariant;
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const VARIANT_COLORS: Record<ToastVariant, { bg: string; text: string; border: string }> = TOAST_TINTS;

const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
};

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: (id: number) => void }) {
  const anim   = useRef(new Animated.Value(0)).current;
  const variantColors = VARIANT_COLORS[toast.variant];

  useEffect(() => {
    // Announce to screen reader
    AccessibilityInfo.announceForAccessibility(toast.message);

    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(toast.duration - 500),
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDone(toast.id));
  }, [anim, onDone, toast.id, toast.message, toast.duration]);

  return (
    <Animated.View
      style={[
        s.toast,
        { backgroundColor: variantColors.bg, borderLeftColor: variantColors.border },
        {
          opacity:   anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0,1], outputRange: [-20,0] }) }],
        },
      ]}
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      accessibilityLabel={toast.message}
    >
      <View style={[s.icon, { backgroundColor: variantColors.text }]}>
        <Text style={s.iconText}>{ICONS[toast.variant]}</Text>
      </View>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[s.message, { color: variantColors.text }]}
        numberOfLines={3}
      >
        {toast.message}
      </Text>
    </Animated.View>
  );
}

let _counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((
    message:  string,
    variant:  ToastVariant = 'info',
    duration: number       = variant === 'error' ? 5000 : 3000,
  ) => {
    const id = ++_counter;
    setToasts(prev => [...prev.slice(-2), { id, message, variant, duration }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View style={s.container} pointerEvents="none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDone={removeToast} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const s = StyleSheet.create({
  container: {
    position:  'absolute',
    top:       Platform.OS === 'ios' ? 56 : 16,
    left:      16,
    right:     16,
    zIndex:    9999,
    elevation: 99,
    gap:       8,
  },
  toast: {
    flexDirection:  'row',
    alignItems:     'center',
    borderRadius:   10,
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingRight:   16,
    gap:            10,
    shadowColor:    THEME_COLORS.black,
    shadowOpacity:  0.08,
    shadowRadius:   8,
    shadowOffset:   { width: 0, height: 2 },
    elevation:      4,
  },
  icon: {
    width:          32,
    height:         32,
    borderRadius:   16,
    alignItems:     'center',
    justifyContent: 'center',
    marginLeft:     10,
    flexShrink:     0,
  },
  iconText:  { color: THEME_COLORS.white, fontSize: 14, fontWeight: '700' },
  message:   { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20 },
});
