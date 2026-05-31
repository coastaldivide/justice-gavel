import { AppIcon } from '../components/AppIcon';
/**
 * AdminVerificationScreen -- Bar Verification Approval Queue
 *
 * Admin-only screen. Accessed via Settings when user has is_admin flag.
 * Lists attorneys who have submitted their bar number and are pending
 * verification (bar_verified=0 with a bar_number set).
 *
 * Admin approves → bar_verified=1 appears in search results immediately.
 * Admin rejects → bar_number cleared, attorney notified (future: push).
 *
 * Works offline: shows cached pending list from last load.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useState, useEffect, useCallback } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { api }      from '../services/api';
import {  useTheme, RADIUS, COLORS } from '../constants/theme';

interface PendingAtty {
  user_id:      number;
  name:         string;
  email:        string;
  bar_number:   string;
  office_id:    string | null;
  submitted_at: string | null;
  provider_id:  number | null;
}

export default function AdminVerificationScreen({ navigation }: ScreenProps): React.JSX.Element {

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  // Admin-only gate
  const [isAuthorized, setIsAuthorized] = React.useState<boolean>(false);
  React.useEffect(() => {
    AsyncStorage.getItem('user').then(raw => {
      if (raw) {
        const u = (() => { try { return JSON.parse(raw); } catch { return null; } })();
        if (u?.is_admin || u?.role === 'admin') { setIsAuthorized(true); return; }
      }
      navigation.navigate('HomeTab' as never);
    }).catch(() => { (navigation as any).replace('HomeTab'); });
  }, [navigation]);
  // Note: isAuthorized gate renders nothing until auth is checked

  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [pending,     setPending]   = useState<PendingAtty[]>([]);
  const [loading,     setLoading]   = useState(true);
  const [refreshing,  setRefreshing]= useState(false);
  const [acting,      setActing]    = useState<number | null>(null);
  const [error,       setError]     = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.get('/attorney/pending-verification');
      setPending(res.data?.pending || []);
    } catch (e: any) {
      setError(e.response?.data?.error || 'Could not load pending verifications.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const approve = async (userId: number, name: string) => {
    Alert.alert(
      `Approve ${name}?`,
      'Their bar number will be verified. They will appear with a ✓ Bar Verified badge in search results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActing(userId);
            try {
              await api.post('/attorney/approve-verification', { user_id: userId, approved: true });
              setPending(p => p.filter(a => a.user_id !== userId));
              Alert.alert('Approved ✓', `${name} is now bar verified.`);
            } catch (e: any) {
              Alert.alert('Verification Failed', e.response?.data?.error || 'Could not approve the application.');
            } finally { setActing(null); }
          },
        },
      ]
    );
  };

  const reject = async (userId: number, name: string) => {
    Alert.alert(
      `Reject ${name}?`,
      'Their bar number submission will be cleared. They can resubmit.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setActing(userId);
            try {
              await api.post('/attorney/approve-verification', { user_id: userId, approved: false });
              setPending(p => p.filter(a => a.user_id !== userId));
            } catch (e: any) {
              Alert.alert('Verification Failed', e.response?.data?.error || 'Could not reject the application.');
            } finally { setActing(null); }
          },
        },
      ]
    );
  };

  if (!isAuthorized) return <></>;
  return (
    <ScrollView
      testID="admin-verification-screen"
      style={[styles.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.steel} />}
    >
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerTitle}>Bar Verification Queue</Text>
        <Text maxFontSizeMultiplier={1.4} style={styles.headerSub}>
          Attorneys awaiting verification · {pending.length} pending
        </Text>
      </View>

      {!!error && (
        <View style={[styles.errorBox, { borderColor: colors.emergency }]}>
          <Text maxFontSizeMultiplier={1.4} style={{ color: colors.emergency, fontSize: 12 }}>⚠ {error}</Text>
        </View>
      )}

      {loading && !refreshing && (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.steel} />
      )}

      {!loading && pending.length === 0 && (
        <View style={[styles.empty, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          <AppIcon name="checkmark-circle" size={20} color="#1B5E20" />
          <Text maxFontSizeMultiplier={1.4} style={[styles.emptyTitle, { color: colors.textPrimary }]}>No pending verifications</Text>
          <Text maxFontSizeMultiplier={1.4} style={[styles.emptySub, { color: colors.textSecond }]}>
            All bar number submissions have been reviewed.
          </Text>
        </View>
      )}

      {pending.map((atty, i) => (
        <View
          key={atty.user_id}
          style={[styles.card, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
        >
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={1.4} numberOfLines={1} ellipsizeMode="tail" style={[styles.attyName, { color: colors.textPrimary }]}>{atty.name}</Text>
              <Text maxFontSizeMultiplier={1.4} style={[styles.attyEmail, { color: colors.textMuted }]}>{atty.email}</Text>
            </View>
            <View style={[styles.barBadge, { backgroundColor: colors.bgElevated }]}>
              <Text maxFontSizeMultiplier={1.4} style={[styles.barNum, { color: colors.steel }]}>{atty.bar_number}</Text>
            </View>
          </View>

          {atty.office_id && (
            <Text maxFontSizeMultiplier={1.4} style={[styles.office, { color: colors.textSecond }]}>
              Office: {atty.office_id}
            </Text>
          )}
          <View style={styles.actions}>
            <TouchableOpacity
              accessibilityRole="button"
          activeOpacity={0.6}
              style={[styles.approveBtn, { opacity: acting === atty.user_id ? 0.6 : 1 }]}
              onPress={() => approve(atty.user_id, atty.name)}
              disabled={acting === atty.user_id}
              accessibilityLabel={`Approve ${atty.name}`}
            >
              {acting === atty.user_id
                ? <ActivityIndicator color={colors.bgCard} size="small" />
                : <Text maxFontSizeMultiplier={1.4} style={styles.approveBtnText}>✅ Approve</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.rejectBtn, { borderColor: colors.emergency, opacity: acting === atty.user_id ? 0.6 : 1 }]}
              onPress={() => reject(atty.user_id, atty.name)}
              disabled={acting === atty.user_id}
              accessibilityLabel={`Reject ${atty.name}`}
            >
              <Text maxFontSizeMultiplier={1.4} style={styles.rejectBtnText}>✕ Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen:        { flex: 1 },
  scroll:        { padding: 16 },
  header:        { borderRadius: RADIUS.lg, padding: 16, marginBottom: 14, alignItems: 'center' },
  headerTitle:   { color: COLORS.bgCard, fontSize: 20, fontFamily: 'Inter_900Black', fontWeight: '900', marginBottom: 4 },
  headerSub:     { color: colors.steel, fontSize: 12 },
  errorBox:      { borderRadius: RADIUS.md, borderWidth: 1, padding: 12, marginBottom: 12, backgroundColor: '#EF5350' },
  empty:         { borderRadius: RADIUS.lg, borderWidth: 1, padding: 32, alignItems: 'center', marginTop: 8 },
  emptyIcon:     { fontSize: 40, marginBottom: 12 },
  emptyTitle:    { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 6 },
  emptySub:      { fontSize: 12, lineHeight: 20, textAlign: 'center' },
  card:          { borderRadius: RADIUS.md, borderWidth: 1, padding: 16, marginBottom: 10 },
  cardTop:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  attyName:      { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', marginBottom: 2 },
  attyEmail:     { fontSize: 12 },
  barBadge:      { borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 5 },
  barNum:        { fontSize: 12, lineHeight: 20, fontWeight: '800', fontFamily: 'monospace' },
  office:        { fontSize: 12, marginBottom: 10 },
  actions:       { flexDirection: 'row', gap: 8, marginTop: 4 },
  approveBtn:    { flex: 1, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center', backgroundColor: colors.legal },
  approveBtnText:{ color: COLORS.bgCard, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  rejectBtn:     { flex: 1, borderRadius: RADIUS.md, paddingVertical: 11, alignItems: 'center', borderWidth: 1, backgroundColor: 'transparent' },
  rejectBtnText: { color: '#EF5350', fontSize: 14, lineHeight: 21, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});
