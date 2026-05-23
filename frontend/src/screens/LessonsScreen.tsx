import React, { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, cachedGet } from '../services/api';
import { cacheLessons, getCachedLessons } from '../services/offlineCache';
import { COLORS, RADIUS, useTheme } from '../constants/theme';

declare var load: any;
declare var refreshing: any;
declare var setRefreshing: any;
interface Lesson { id: number; title: string; category: string; content: string; points: number; }

const CAT_COLORS: Record<string, string> = {
  Criminal: COLORS.emergencyDark, General: COLORS.blue, Civil: COLORS.legalDark, Constitutional: COLORS.blue,
};

export default function LessonsScreen({ navigation, route }: ScreenProps) {

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors);
  const incomingCategory = (route?.params as import('../types/api').RouteParams)?.category || null;
  const incomingQuery    = (route?.params as import('../types/api').RouteParams)?.query    || null;
  const [lessons, setLessons]   = useState<Lesson[]>([]);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [streak,  setStreak]    = useState(0);
  const [userId, setUserId]     = useState(1);

  useEffect(() => {
    (async () => {
      const u = await AsyncStorage.getItem('user');
      if (u) { try { const user = JSON.parse(u); if (user?.id) setUserId(user.id); } catch {} }
      const done = await AsyncStorage.getItem('completed_lessons');
      if (done) { try { setCompleted(new Set(JSON.parse(done))); } catch {} }
      if (incomingCategory) setFilterCat(incomingCategory as string);
      try {
        const r = await cachedGet('/lessons');
        setLessons(r.data || []);
        cacheLessons(r.data); // save for offline
      } catch {
        // Offline -- load from cache
        const { lessons: cached, cachedAt, isCache } = await getCachedLessons();
        if (isCache) {
          setLessons(cached);
        }
      }
      setLoading(false);
    })();
  }, [incomingCategory]);

  const markComplete = async (id: number, pts: number) => {
    if (completed.has(id)) return;
    try {
      await api.post(`/lessons/${id}/complete`, { user_id: userId });
      const next = new Set(completed).add(id);
      setCompleted(next);
      await AsyncStorage.setItem('completed_lessons', JSON.stringify(Array.from(next)));
      // Update local points
      const stored = await AsyncStorage.getItem(`points_${userId}`);
      const newPts = (parseInt(stored || '0', 10) + pts);
      await AsyncStorage.setItem(`points_${userId}`, String(newPts));
      Alert.alert('✓ Completed!', `+${pts} points added to your rewards balance.`);
    } catch (e: any) {
      Alert.alert('Could Not Load Lessons', e.response?.data?.error || 'Could not mark complete.');
    }
  };

  const displayLessons = filterCat
    ? lessons.filter(l => l.category === filterCat)
    : lessons;

  const totalPts  = lessons.reduce((s, l) => s + l.points, 0);
  const earnedPts = lessons.filter(l => completed.has(l.id)).reduce((s, l) => s + l.points, 0);
  const pct = totalPts > 0 ? earnedPts / totalPts : 0;

  const renderLesson = useCallback(({ item }: { item: any }) => {
            const done = completed.has(item.id);
            const open = expanded === item.id;
            const color = CAT_COLORS[item.category] || colors.blue;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                style={[styles.card, done && styles.cardDone]}
                onPress={() => setExpanded(open ? null : item.id)}
                activeOpacity={0.85}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.doneCircle, done && styles.doneCircleDone]}>
                    {done && <Text maxFontSizeMultiplier={1.4} style={styles.doneCheck}>✓</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text maxFontSizeMultiplier={1.4} style={[styles.cardTitle, done && styles.cardTitleDone]}>{item.title}</Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.catBadge, { backgroundColor: color + '18', borderColor: color + '55' }]}>
                        <Text maxFontSizeMultiplier={1.4} style={[styles.catText, { color }]}>{item.category}</Text>
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={styles.ptsText}>+{item.points} pts</Text>
                    </View>
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>{open ? '▲' : '▼'}</Text>
                </View>

                {open && (
                  <View style={styles.contentArea}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.contentText}>{item.content}</Text>
                    {!done && (
                      <TouchableOpacity style={styles.completeBtn}
                        accessibilityRole="button"
                        onPress={() => markComplete(item.id, item.points || 0)}
                        >
                        <Text maxFontSizeMultiplier={1.4} style={styles.completeBtnText}>✓  Mark as complete  (+{item.points} pts)</Text>
                      </TouchableOpacity>
                    )}
                    {done && <Text maxFontSizeMultiplier={1.4} style={styles.completedLabel}>✓ Completed -- {item.points} points earned</Text>}
                  </View>
                )}
              </TouchableOpacity>
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
            );
  }, [colors, completed, expanded]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      {/* Progress banner */}
      <View style={styles.progressCard}>
        <View style={styles.progressTop}>
          <Text maxFontSizeMultiplier={1.4} style={styles.progressTitle}>Know Your Rights</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.progressPts}>{earnedPts} / {totalPts} pts</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.progressSub}>{completed.size} of {lessons.length} lessons complete</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} />
      ) : lessons.length === 0 ? (
        <View style={styles.empty}><Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>No lessons available yet.</Text></View>
      ) : (
        <>
        {/* Category filter chips */}
        {filterCat && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>
            {['Criminal','General','Civil','Constitutional'].map(cat => (
              <TouchableOpacity
                key={cat}
                style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20,
                  backgroundColor: filterCat === cat ? (CAT_COLORS[cat] || colors.navy) : colors.bg }}
                onPress={() => setFilterCat(filterCat === cat ? null : cat)}
            accessibilityRole="button"
              >
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700',
                  color: filterCat === cat ? colors.bgCard : colors.textMuted }}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <FlatList
          getItemLayout={(_, index) => ({ length: 110, offset: 110 * index, index })}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={true}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load().finally(() => setRefreshing(false)); }} tintColor={colors.textSecond} />}
          data={displayLessons}
          keyExtractor={l => String(l.id)}
          ListFooterComponent={
            <View style={styles.lifeCard}>
              <Text maxFontSizeMultiplier={1.4} style={styles.lifeTitle}>Your legal needs go beyond this arrest.</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.lifeSub}>Justice Gavel covers DUI, divorce, immigration, employment, and 18 other areas of law. Find a specialist for your next legal moment.</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity style={styles.lifeBtn} onPress={() => navigation.navigate("LawyersTab")}
            accessibilityRole="button"
          >
                  <Text maxFontSizeMultiplier={1.4} style={styles.lifeBtnText}>Find a Lawyer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.lifeBtn, { backgroundColor: colors.emergencyDark }]}
                  onPress={() => navigation.navigate('MoreTab', { screen: 'RightsCard' })}
                accessibilityRole="button"
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.lifeBtnText}>📋 Get Rights Card</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              No lessons found. Check your connection.
            </Text>
          }
          renderItem={renderLesson}
        />
      </>
      )
    }
    </View>
  );
}

const makeStyles = (colors: any) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'transparent' },
  progressCard: { backgroundColor: '#042C53', padding: 20, margin: 12, borderRadius: 16 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressTitle: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  progressPts: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, fontWeight: '700' },
  progressBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.legal, borderRadius: 4 },
  progressSub: { color: COLORS.bgSubtle, fontSize: 12, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: colors.steel, fontSize: 14,
    lineHeight: 21, },
  card: { backgroundColor: COLORS.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  cardDone: { borderWidth: 1, borderColor: colors.legal },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  doneCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  doneCircleDone: { backgroundColor: colors.legal, borderColor: colors.legal },
  doneCheck: { color: COLORS.bgCard, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' },
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: '#042C53', marginBottom: 4 },
  cardTitleDone: { color: colors.steel },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  catText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  ptsText: { fontSize: 12, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  chevron: { fontSize: 12, color: colors.steel, marginLeft: 4 },
  contentArea: { marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.bg, paddingTop: 10 },
  contentText: { fontSize: 14, color: colors.bgCard, lineHeight: 22, marginBottom: 14 },
  completeBtn: { backgroundColor: colors.legal, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  completeBtnText: { color: COLORS.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  completedLabel: { textAlign: 'center', color: colors.legal, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  lifeCard: {
    backgroundColor: COLORS.bgSubtle, borderRadius: 14, padding: 16,
    margin: 12, borderWidth: 1, borderColor: COLORS.bgSubtle,
  },
  lifeTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#042C53', marginBottom: 4 },
  lifeSub:   { fontSize: 12, color: colors.steel, lineHeight: 17 },
  lifeBtn:   { backgroundColor: '#042C53', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  lifeBtnText: { color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#FFA726', borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: '#FFA726', margin: 12, padding: 12 },
  streakFlame: { fontSize: 28 },
  streakCount: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: '#FFA726' },
  streakSub:   { fontSize: 11, color: colors.emergency },
});

// Module-level fallback for helper components
const styles = makeStyles(COLORS);