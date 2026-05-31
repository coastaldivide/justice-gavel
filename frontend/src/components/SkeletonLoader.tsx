/**
 * components/SkeletonLoader.tsx — Professional skeleton loading screens
 *
 * Replaces blank white screens and spinners during data fetch.
 * Animated shimmer effect communicates that content is loading,
 * not broken. Dramatically improves perceived performance.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';
import { COLORS } from '../constants/theme';

interface SkeletonProps {
  width?:  number | string;
  height?: number;
  radius?: number;
  style?:  ViewStyle;
}

export function SkeletonBlock({ width = '100%', height = 16, radius = 6, style }: SkeletonProps) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const bg = anim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['#E8ECF4', '#D0D8E8'],
  });

  return (
    <Animated.View
      style={[{ width: width as any, height, borderRadius: radius }, { backgroundColor: bg as any }, style as any]}
    />
  );
}

// ── Pre-built skeleton layouts ─────────────────────────────────────────────────

export function SkeletonCard() {
  return (
    <View style={sk.card}>
      <View style={sk.cardHeader}>
        <SkeletonBlock width={40} height={40} radius={12} />
        <View style={{ flex: 1, gap: 7 }}>
          <SkeletonBlock width="60%" height={14} />
          <SkeletonBlock width="40%" height={11} />
        </View>
      </View>
      <View style={{ gap: 8, marginTop: 14 }}>
        <SkeletonBlock width="100%" height={12} />
        <SkeletonBlock width="80%"  height={12} />
        <SkeletonBlock width="90%"  height={12} />
      </View>
    </View>
  );
}

export function SkeletonListItem() {
  return (
    <View style={sk.listItem}>
      <SkeletonBlock width={44} height={44} radius={22} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBlock width="55%" height={13} />
        <SkeletonBlock width="75%" height={11} />
      </View>
      <SkeletonBlock width={60} height={28} radius={14} />
    </View>
  );
}

export function SkeletonProfile() {
  return (
    <View style={sk.profile}>
      <SkeletonBlock width={80} height={80} radius={40} style={{ alignSelf: 'center' }} />
      <SkeletonBlock width="50%" height={18} style={{ alignSelf: 'center', marginTop: 12 }} />
      <SkeletonBlock width="35%" height={13} style={{ alignSelf: 'center', marginTop: 6 }} />
      <View style={{ marginTop: 24, gap: 12 }}>
        {[1,2,3,4].map(i => (
          <View key={i} style={sk.profileRow}>
            <SkeletonBlock width={20} height={20} radius={4} />
            <SkeletonBlock width="70%" height={14} />
            <SkeletonBlock width="20%" height={14} />
          </View>
        ))}
      </View>
    </View>
  );
}

export function SkeletonCaseList() {
  return (
    <View style={{ gap: 12, padding: 16 }}>
      {[1,2,3].map(i => (
        <View key={i} style={sk.caseItem}>
          <View style={sk.caseHeader}>
            <SkeletonBlock width="55%" height={15} />
            <SkeletonBlock width={70} height={24} radius={12} />
          </View>
          <SkeletonBlock width="100%" height={11} style={{ marginTop: 8 }} />
          <SkeletonBlock width="70%"  height={11} style={{ marginTop: 5 }} />
          <View style={sk.caseMeta}>
            <SkeletonBlock width={80} height={11} />
            <SkeletonBlock width={80} height={11} />
          </View>
        </View>
      ))}
    </View>
  );
}

const sk = StyleSheet.create({
  card:       { backgroundColor: '#fff', borderRadius: 14, padding: 16,
                 borderWidth: 0.5, borderColor: COLORS.border, marginHorizontal: 16, marginTop: 12 },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 4 },
  listItem:   { flexDirection: 'row', alignItems: 'center', gap: 14,
                 paddingVertical: 12, paddingHorizontal: 16,
                 borderBottomWidth: 0.5, borderColor: COLORS.border },
  profile:    { padding: 20 },
  profileRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  caseItem:   { backgroundColor: '#fff', borderRadius: 14, padding: 16,
                 borderWidth: 0.5, borderColor: COLORS.border },
  caseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  caseMeta:   { flexDirection: 'row', gap: 20, marginTop: 10 },
});

export default SkeletonBlock;

// ── Backward-compatible SkeletonLoader (used by CheckIn, GoldenGavel, SavedLawyers) ─
interface SkeletonLoaderProps {
  rows?:  number;
  label?: string;
  style?: any;
}

export function SkeletonLoader({ rows = 3, label, style }: SkeletonLoaderProps) {
  return (
    <View style={[{ padding: 16, gap: 12 }, style]}>
      {label && (
        <SkeletonBlock width="45%" height={12} radius={4} style={{ marginBottom: 4 }} />
      )}
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ gap: 8 }}>
          <SkeletonBlock width="100%" height={14} />
          <SkeletonBlock width={`${60 + (i * 11) % 30}%`} height={11} />
        </View>
      ))}
    </View>
  );
}
