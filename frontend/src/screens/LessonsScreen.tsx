import { useToast } from '../components/ToastProvider';
import React, { useCallback, useEffect, useState } from 'react';
import type { ScreenProps } from '../types/navigation';
import { View, Text, RefreshControl, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutAnimation, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { unwrapList, api, cachedGet, apiErrorMessage } from '../services/api';
import { cacheLessons, getCachedLessons } from '../services/offlineCache';
import { COLORS, RADIUS, useTheme } from '../constants/theme';
import * as Haptics from 'expo-haptics';
import { t, useLang } from '../i18n';

interface Lesson { id: number; title: string; category: string; content: string; points: number; }

const CAT_COLORS: Record<string, string> = {
  Criminal: COLORS.emergencyDark, General: COLORS.blue, Civil: COLORS.legalDark, Constitutional: COLORS.blue,
};

function LessonsScreen({ navigation, route }: ScreenProps) {
  useLang();
  const { showToast } = useToast();

  // Mounted guard -- prevents setState after unmount (crash in strict mode)
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    return () => { mountedRef.current = false; };
  }, []);

  const { colors } = useTheme();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const incomingCategory = (route?.params as import('../types/api').RouteParams)?.category || null;
  const incomingQuery    = (route?.params as import('../types/api').RouteParams)?.query    || null;
  const [lessons, setLessons]   = useState<Lesson[]>([]);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded]   = useState<number | null>(null);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [userId, setUserId]     = useState(1);

  useEffect(() => {
    (async () => {
      const u = await AsyncStorage.getItem('user');
      if (u) { try { const user = JSON.parse(u); if (user?.id) setUserId(user.id); } catch {} }
      const done = await AsyncStorage.getItem('completed_lessons');
      if (done) { try { setCompleted(new Set(JSON.parse(done))); } catch {} }
      if (incomingCategory) setFilterCat(incomingCategory as string);
      const loaded = await loadLessons();
      // Deep link from the Home "tip of the day": open the first matching lesson.
      if (incomingQuery && mountedRef.current) {
        const q = String(incomingQuery).toLowerCase();
        const match = loaded.find(l => `${l.title} ${l.content ?? ''}`.toLowerCase().includes(q));
        if (match) setExpanded(match.id);
      }
      // Not on web: a mount-time vibration is blocked by the browser (no user
      // gesture yet) and logs a Chromium intervention error.
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(()=>{});
      if (mountedRef.current) setLoading(false);
    })();
  }, [incomingCategory, incomingQuery]);

  const loadLessons = async (fresh = false): Promise<Lesson[]> => {
      try {
        const r = fresh ? await api.get('/lessons') : await cachedGet('/lessons');
        setLessons(unwrapList(r.data, 'lessons'));
        cacheLessons(r.data); // save for offline
        return Array.isArray(r.data) ? r.data : [];
      } catch {
        // Offline -- load from cache
        const { lessons: cached, isCache } = (await getCachedLessons()) as any;
        if (isCache) {
          setLessons(cached);
          return Array.isArray(cached) ? cached : [];
        }
        return [];
      }
  };

  const markComplete = useCallback(async (id: number, pts: number) => {
    if (completed.has(id)) return;
    try {
      await api.post(`/lessons/${id}/complete`, { user_id: userId });
      const next = new Set(completed).add(id);
      setCompleted(next);
      await AsyncStorage.setItem('completed_lessons', JSON.stringify(Array.from(next))).catch(() => {}); // non-fatal storage write
      // Update local points
      const stored = await AsyncStorage.getItem(`points_${userId}`);
      const newPts = (parseInt(stored || '0', 10) + pts);
      await AsyncStorage.setItem(`points_${userId}`, String(newPts));
      showToast(t('x_lessons_points_added_rewards', { pts }), 'success');
    } catch (e: any) {
      showToast(apiErrorMessage(e, t('x_lessons_could_not_mark_complete')), 'info');
    }
  }, [completed, userId, showToast]);

  const displayLessons = filterCat
    ? (lessons ?? []).filter(l => l.category === filterCat)
    : lessons;

  const { totalPts, earnedPts, pct } = React.useMemo(() => {
    const total  = (lessons ?? []).reduce((s, l) => s + l.points, 0);
    const earned = (lessons ?? []).filter(l => completed.has(l.id)).reduce((s, l) => s + l.points, 0);
    return { totalPts: total, earnedPts: earned, pct: total > 0 ? earned / total : 0 };
  }, [lessons, completed]);

  const renderLesson = useCallback(({ item }: { item: any }) => {
            const done = completed.has(item.id);
            const open = expanded === item.id;
            const color = CAT_COLORS[item.category] || colors.blue;
            return (
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
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
                        <Text maxFontSizeMultiplier={1.4} style={[styles.catText, { color }]}>{['Criminal', 'General', 'Civil', 'Constitutional'].includes(item.category) ? t(`x_lessons_cat_${String(item.category).toLowerCase()}`) : item.category}</Text>
                      </View>
                      <Text maxFontSizeMultiplier={1.4} style={styles.ptsText}>{t('x_lessons_pts', { points: item.points })}</Text>
                    </View>
                  </View>
                  <Text maxFontSizeMultiplier={1.4} style={styles.chevron}>{open ? '▲' : '▼'}</Text>
                </View>

                {open && (
                  <View style={styles.contentArea}>
                    <Text maxFontSizeMultiplier={1.4} style={styles.contentText}>{item.content}</Text>
                    {!done && (
                      <TouchableOpacity accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')} style={styles.completeBtn}
                        onPress={() => markComplete(item.id, item.points || 0)}
                        >
                        <Text maxFontSizeMultiplier={1.4} style={styles.completeBtnText}>{t('x_lessons_mark_as_complete_pts', { points: item.points })}</Text>
                      </TouchableOpacity>
                    )}
                    {done && <Text maxFontSizeMultiplier={1.4} style={styles.completedLabel}>{t('x_lessons_completed_points_earned', { points: item.points })}</Text>}
                  </View>
                )}
              </TouchableOpacity>
            );
  }, [colors, completed, expanded, markComplete, styles]);

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}
      testID="lessons-screen">
      {/* Progress banner */}
      <View style={styles.progressCard}>
        <View style={styles.progressTop}>
          <Text maxFontSizeMultiplier={1.4} style={styles.progressTitle}>{t('education')}</Text>
          <Text maxFontSizeMultiplier={1.4} style={styles.progressPts}>{t('x_lessons_pts_2', { earnedPts, totalPts })}</Text>
        </View>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` as any }]} />
        </View>
        <Text maxFontSizeMultiplier={1.4} style={styles.progressSub}>{t('x_lessons_lessons_complete', { size: completed.size, length: lessons.length })}</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.navy} />
      ) : lessons.length === 0 ? (
        <View style={styles.empty}><Text maxFontSizeMultiplier={1.4} style={styles.emptyText}>{t('x_lessons_no_lessons_available_yet')}</Text></View>
      ) : (
        <>
        {/* Category filter chips */}
        {filterCat && (
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8, gap: 6 }}>
            {['Criminal','General','Civil','Constitutional'].map(cat => ( // i18n-exempt: lesson category values; label below
              <TouchableOpacity
                accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                key={cat}
                style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 20,
                  backgroundColor: filterCat === cat ? (CAT_COLORS[cat] || colors.navy) : colors.bg }}
                onPress={() => setFilterCat(filterCat === cat ? null : cat)}
          hitSlop={{  top: 12, bottom: 12, left: 12, right: 12  }}
              >
                <Text maxFontSizeMultiplier={1.4} style={{ fontSize: 12, fontFamily: 'Inter_700Bold', fontWeight: '700',
                  color: filterCat === cat ? colors.bgCard : colors.textMuted }}>{t(`x_lessons_cat_${cat.toLowerCase()}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <FlashList
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadLessons(true).finally(() => setRefreshing(false)); }} tintColor={colors.textSecond} />}
          data={displayLessons}
          keyExtractor={l => String(l.id)}
          ListFooterComponent={
            <View style={styles.lifeCard}>
              <Text maxFontSizeMultiplier={1.4} style={styles.lifeTitle}>{t('x_lessons_legal_needs_go_beyond')}</Text>
              <Text maxFontSizeMultiplier={1.4} style={styles.lifeSub}>{t('x_lessons_justice_gavel_covers_dui')}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <TouchableOpacity
          accessibilityRole="button"
 style={styles.lifeBtn} accessibilityLabel={t('lawyers_heading')}
          accessibilityHint={t('x_check_in_searches_attorneys_area')} onPress={() => navigation.navigate("LawyersTab")}
          >
                  <Text maxFontSizeMultiplier={1.4} style={styles.lifeBtnText}>{t('lawyers_heading')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
                  style={[styles.lifeBtn, { backgroundColor: colors.emergencyDark }]}
                  accessibilityLabel={t('x_lessons_get_rights_card')} onPress={() => navigation.navigate('MoreTab', { screen: 'RightsCard' })}
                >
                  <Text maxFontSizeMultiplier={1.4} style={styles.lifeBtnText}>{t('x_lessons_get_rights_card')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          contentContainerStyle={{ padding: 12, paddingBottom: 40}}
          ListEmptyComponent={
            <Text maxFontSizeMultiplier={1.4} style={{ color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              {t('x_lessons_no_lessons_found_check')}
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
  progressCard: { backgroundColor: COLORS.navy, padding: 20, margin: 12, borderRadius: 16 },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  progressTitle: { color: COLORS.bgCard, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_900Black', fontWeight: '900' },
  progressPts: { color: COLORS.bgSubtle, fontSize: 12, lineHeight: 20, fontWeight: '700' },
  progressBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.legal, borderRadius: 4 },
  progressSub: { color: COLORS.bgSubtle, fontSize: 12, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: colors.info, fontSize: 14,
    lineHeight: 21, },
  card: { backgroundColor: colors.bgCard, borderRadius: 14, padding: 16, marginBottom: 10, elevation: 1, shadowColor: COLORS.bg, shadowOpacity: 0.05, shadowRadius: 4 },
  cardDone: { borderWidth: 1, borderColor: colors.legal },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  doneCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center' },
  doneCircleDone: { backgroundColor: colors.legal, borderColor: colors.legal },
  doneCheck: { color: colors.textOnAccent, fontSize: 14, lineHeight: 21, fontFamily: 'Inter_900Black', fontWeight: '900' }, // design-audit-ignore: rendered only when done (legal fill)
  cardTitle: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: colors.textBrand, marginBottom: 4 },
  cardTitleDone: { color: colors.info },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  catText: { fontSize: 11, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  ptsText: { fontSize: 12, color: colors.legal, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  chevron: { fontSize: 12, color: colors.info, marginLeft: 4 },
  contentArea: { marginTop: 12, borderTopWidth: 1, borderTopColor: COLORS.bg, paddingTop: 10 },
  contentText: { fontSize: 14, color: colors.textPrimary, lineHeight: 22, marginBottom: 14 },
  completeBtn: { backgroundColor: colors.legal, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  completeBtnText: { color: colors.bgCard, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', fontSize: 12 },
  completedLabel: { textAlign: 'center', color: colors.legal, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  lifeCard: {
    backgroundColor: colors.bgSubtle, borderRadius: 14, padding: 16,
    margin: 12, borderWidth: 1, borderColor: COLORS.bgSubtle,
  },
  lifeTitle: { fontSize: 14, lineHeight: 21, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: colors.textBrand, marginBottom: 4 },
  lifeSub:   { fontSize: 12, color: colors.info, lineHeight: 17 },
  lifeBtn:   { backgroundColor: COLORS.navy, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  lifeBtnText: { color: COLORS.bgCard, fontSize: 12, lineHeight: 20, fontFamily: 'Inter_700Bold', fontWeight: '700' },
  streakBanner: { flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: COLORS.steelMid, borderRadius: RADIUS.lg, borderWidth: 1,
    borderColor: COLORS.steelMid, margin: 12, padding: 12 },
  streakFlame: { fontSize: 28 },
  streakCount: { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800', color: COLORS.steelMid },
  streakSub:   { fontSize: 11, color: colors.emergency },
});

// Module-level fallback for helper components
export default React.memo(LessonsScreen);