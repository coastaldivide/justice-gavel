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

const COLORS: Record<ToastVariant, { bg: string; text: string; border: string }> = {
  success: { bg: '#E1F5EE', text: '#0F6E56', border: '#1D9E75' },
  error:   { bg: '#FCEBEB', text: '#A32D2D', border: '#E24B4A' },
  info:    { bg: '#E6F1FB', text: '#185FA5', border: '#378ADD' },
  warning: { bg: '#FAEEDA', text: '#854F0B', border: '#BA7517' },
};

const ICONS: Record<ToastVariant, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
  warning: '⚠',
};

function ToastItem({ toast, onDone }: { toast: ToastMessage; onDone: () => void }) {
  const anim   = useRef(new Animated.Value(0)).current;
  const colors = COLORS[toast.variant];

  useEffect(() => {
    // Announce to screen reader
    AccessibilityInfo.announceForAccessibility(toast.message);

    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(toast.duration - 500),
      Animated.timing(anim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(onDone);
  }, []);

  return (
    <Animated.View
      style={[
        s.toast,
        { backgroundColor: colors.bg, borderLeftColor: colors.border },
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
      <View style={[s.icon, { backgroundColor: colors.border }]}>
        <Text style={s.iconText}>{ICONS[toast.variant]}</Text>
      </View>
      <Text
        maxFontSizeMultiplier={1.2}
        style={[s.message, { color: colors.text }]}
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
          <ToastItem key={t.id} toast={t} onDone={() => removeToast(t.id)} />
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
    shadowColor:    '#000',
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
  iconText:  { color: '#fff', fontSize: 14, fontWeight: '700' },
  message:   { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20 },
});
