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
import { TOAST_ACCENTS, COLORS as THEME_COLORS } from '../constants/theme';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t, useLang } from '../i18n';
import { AppIcon, ICONS as APP_ICONS, type IconName } from './AppIcon';

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
  success: TOAST_ACCENTS.success,
  error:   TOAST_ACCENTS.error,
  warning: TOAST_ACCENTS.warning,
  info:    TOAST_ACCENTS.info,
};

const ICONS: Record<ToastType, IconName> = {
  success: APP_ICONS.checkmark,
  error:   APP_ICONS.close,
  warning: APP_ICONS.alertHigh,
  info:    APP_ICONS.alertNormal,
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useLang();
  const opacity = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss(toast.id));
  }, [opacity, onDismiss, toast.id]);

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <View style={[styles.indicator, { backgroundColor: COLORS[toast.type] }]}>
        <AppIcon name={ICONS[toast.type]} size={16} color={THEME_COLORS.white} />
      </View>
      <Text style={styles.message} numberOfLines={3}>{toast.message}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('x_toast_provider_dismiss_notification')} onPress={() => onDismiss(toast.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <AppIcon name={APP_ICONS.close} size={16} color={styles.close.color} style={styles.close} />
      </TouchableOpacity>
    </Animated.View>
  );
}

let _id = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  useLang();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const insets = useSafeAreaInsets();

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++_id;
    setToasts(prev => [...prev.slice(-2), { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(tItem => tItem.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <View style={[styles.container, { bottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {toasts.map(tItem => (
          <ToastItem key={tItem.id} toast={tItem} onDismiss={dismiss} />
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
    backgroundColor: THEME_COLORS.textPrimary,
    borderRadius:   12,
    paddingVertical:12,
    paddingLeft:    0,
    paddingRight:   12,
    shadowColor:    THEME_COLORS.black,
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
  message: {
    flex:       1,
    color:      THEME_COLORS.white,
    fontSize:   14,
    lineHeight: 20,
  },
  close: {
    color:      'rgba(255,255,255,0.5)',
    marginLeft: 8,
  },
});
