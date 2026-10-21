import * as Sentry from '@sentry/react-native';
import { COLORS } from '../constants/theme';
import { AppIcon, ICONS } from './AppIcon';
/**
 * ErrorBoundary — catches unhandled render errors in the React tree.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeScreen />
 *   </ErrorBoundary>
 *
 * On error: shows a safe fallback UI and reports to Sentry if configured.
 */
import React, { Component, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { t } from '../i18n';

interface Props { children: ReactNode; fallback?: ReactNode; }

/** "Loading module … failed" / ChunkLoadError: a lazy screen's code could not be fetched. */
export function isChunkLoadError(e: Error | null | undefined): boolean {
  return !!e && (e.name === 'ChunkLoadError' || /Loading (CSS )?(module|chunk) .* failed/i.test(String(e.message || '')));
}
const reloadPage = () => { if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload(); };
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error('[ErrorBoundary] Caught:', error.message, info.componentStack?.slice(0, 200));
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } }); //mment when Sentry RN SDK is added
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      // A screen whose code could not be downloaded (web, offline): say so, and
      // retry with a reload — React.lazy keeps the failed import otherwise.
      const chunk = isChunkLoadError(this.state.error);
      return (
        <View style={styles.container} testID="error-boundary">
          <AppIcon name={chunk ? ICONS.offline : ICONS.alertHigh} size={48} color={COLORS.steel} style={styles.icon} />
          <Text style={styles.title}>{chunk ? t('no_internet') : t('error_generic')}</Text>
          <Text style={styles.sub}>
            {chunk ? t('eb_needs_connection') : t('x_error_boundary_unexpected_error_occurred')}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={chunk ? reloadPage : this.reset} accessibilityRole="button">
            <Text style={styles.btnText}>{t('try_again')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:COLORS.navy, padding:24 },
  icon:      { marginBottom:16 },
  title:     { color:COLORS.white, fontSize:20, fontWeight:'900', marginBottom:8, textAlign:'center' },
  sub:       { color:COLORS.steel, fontSize:13, textAlign:'center', marginBottom:24, lineHeight:19 },
  btn:       { backgroundColor:COLORS.blue, borderRadius:12, paddingVertical:13, paddingHorizontal:32 },
  btnText:   { color:COLORS.white, fontWeight:'800', fontSize:15 },
});

export default ErrorBoundary;
