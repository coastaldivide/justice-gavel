/**
 * ToastProvider.tsx — lightweight in-app toast notification system
 *
 * Replaces Alert.alert across all 85 screens with smooth non-blocking toasts.
 * Toasts appear at the bottom, auto-dismiss after 3 seconds, support
 * success / error / warning / info types with matching colours.
 *
 * Setup in App.tsx:
 *   import { ToastProvider } from '../components/ToastProvider';
 *   // wrap root: <ToastProvider>...</ToastProvider>
 *
 * Usage in any screen:
 *   const { showToast } = useToast();
 *   showToast('Saved successfully', 'success');
 *   showToast('Something went wrong', 'error');
 */

import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Animated, Platform, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id:      number;
  message: string;
  type:    ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const COLORS: Record<ToastType, string> = {
  success: '#22C55E',
  error:   '#EF4444',
  warning: '#F59E0B',
  info:    '#3B82F6',
};

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(onDismiss);
  }, []);

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <View style={[styles.indicator, { backgroundColor: COLORS[toast.type] }]}>
        <Text style={styles.icon}>{ICONS[toast.type]}</Text>
      </View>
      <Text style={styles.message} numberOfLines={3}>{toast.message}</Text>
      <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.close}>✕</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_id;
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View style={[styles.container, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position:  'absolute',
    left:      16,
    right:     16,
    zIndex:    9999,
    gap:       8,
  },
  toast: {
    flexDirection:  'row',
    alignItems:     'center',
    backgroundColor:'#1C1C1E',
    borderRadius:   12,
    paddingVertical:12,
    paddingLeft:    0,
    paddingRight:   12,
    shadowColor:    '#000',
    shadowOffset:   { width: 0, height: 4 },
    shadowOpacity:  0.18,
    shadowRadius:   12,
    elevation:      8,
  },
  indicator: {
    width:          42,
    alignSelf:      'stretch',
    justifyContent: 'center',
    alignItems:     'center',
    borderTopLeftRadius:    12,
    borderBottomLeftRadius: 12,
    marginRight:    12,
  },
  icon: {
    color:      '#fff',
    fontSize:   14,
    fontWeight: '700',
  },
  message: {
    flex:       1,
    color:      '#fff',
    fontSize:   14,
    lineHeight: 20,
  },
  close: {
    color:      'rgba(255,255,255,0.5)',
    fontSize:   12,
    marginLeft: 8,
  },
});
