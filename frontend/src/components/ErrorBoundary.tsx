import * as Sentry from '@sentry/react-native';
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
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props { children: ReactNode; fallback?: ReactNode; }
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
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.sub}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={this.reset} accessibilityRole="button">
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex:1, justifyContent:'center', alignItems:'center', backgroundColor:'#042C53', padding:24 },
  icon:      { fontSize:48, marginBottom:16 },
  title:     { color:'#FFFFFF', fontSize:20, fontWeight:'900', marginBottom:8, textAlign:'center' },
  sub:       { color:'#9AADC7', fontSize:13, textAlign:'center', marginBottom:24, lineHeight:19 },
  btn:       { backgroundColor:'#185FA5', borderRadius:12, paddingVertical:13, paddingHorizontal:32 },
  btnText:   { color:'#FFFFFF', fontWeight:'800', fontSize:15 },
});

export default ErrorBoundary;
