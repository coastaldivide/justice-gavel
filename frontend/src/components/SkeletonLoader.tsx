/**
 * SkeletonLoader.tsx — Animated skeleton loading placeholders
 *
 * Replaces ActivityIndicator spinners with shimmer placeholder cards
 * that match the shape of real content. Makes the app feel dramatically
 * faster without changing actual load time.
 *
 * Usage:
 *   import { SkeletonLawyerCard, SkeletonBailCard, SkeletonRow } from '../components/SkeletonLoader';
 *
 *   {loading
 *     ? <SkeletonLawyerList count={4} />
 *     : <FlatList data={lawyers} ... />
 *   }
 */
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';
import { useTheme } from '../constants/theme';

const { width: SW } = Dimensions.get('window');

// ── Base shimmer pulse ─────────────────────────────────────────────────────────
function Shimmer({ width, height, borderRadius = 8, style }: {
  width: number | string; height: number; borderRadius?: number; style?: unknown;
}) {
  const { colors, isDark } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  const base = isDark ? '#1E2D42' : '#DDE3F0';
  const highlight = isDark ? '#1E2D42' : '#F4F6FB';

  return (
    <Animated.View
      style={[
        { width, height, borderRadius, opacity },
        { backgroundColor: base },
        style,
      ]}
    />
  );
}

// ── Lawyer card skeleton ──────────────────────────────────────────────────────
function SkeletonLawyerCard() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
      {/* Name + rating row */}
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 6 }}>
          <Shimmer width="70%" height={16} />
          <Shimmer width="50%" height={12} />
        </View>
        <Shimmer width={44} height={44} borderRadius={22} />
      </View>
      {/* Badges */}
      <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
        <Shimmer width={72} height={22} borderRadius={11} />
        <Shimmer width={60} height={22} borderRadius={11} />
        <Shimmer width={80} height={22} borderRadius={11} />
      </View>
      {/* Call button */}
      <Shimmer width="100%" height={46} borderRadius={14} style={{ marginTop: 10 }} />
      {/* Secondary row */}
      <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
        <Shimmer width={90}  height={32} borderRadius={8} />
        <Shimmer width={80}  height={32} borderRadius={8} />
        <Shimmer width={70}  height={32} borderRadius={8} />
        <Shimmer width={100} height={32} borderRadius={8} />
      </View>
    </View>
  );
}

function SkeletonLawyerList({ count = 4 }: { count?: number }) {
  return (
    <View style={{ padding: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonLawyerCard key={i} />
      ))}
    </View>
  );
}

// ── Bail agent card skeleton ──────────────────────────────────────────────────
function SkeletonBailCard() {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
      <View style={styles.row}>
        <View style={{ flex: 1, gap: 6 }}>
          <Shimmer width="65%" height={16} />
          <Shimmer width="45%" height={12} />
        </View>
        <Shimmer width={60} height={22} borderRadius={11} />
      </View>
      <Shimmer width="100%" height={46} borderRadius={12} style={{ marginTop: 10 }} />
      <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
        <Shimmer width={100} height={32} borderRadius={8} />
        <Shimmer width={90}  height={32} borderRadius={8} />
      </View>
    </View>
  );
}

function SkeletonBailList({ count = 5 }: { count?: number }) {
  return (
    <View style={{ padding: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBailCard key={i} />
      ))}
    </View>
  );
}

// ── Generic text row skeleton ─────────────────────────────────────────────────
function SkeletonRow({ lines = 2 }: { lines?: number }) {
  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Shimmer key={i} width={i === 0 ? "80%" : "60%"} height={13} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16, padding: 14, marginBottom: 10,
    shadowColor: '#042C53', shadowOpacity: 0.06,
    shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
});

// Memoized exports — prevent re-renders when parent state changes
export const MemoizedSkeletonLawyerCard = React.memo(SkeletonLawyerCard);
export const MemoizedSkeletonLawyerList = React.memo(SkeletonLawyerList);
export const MemoizedSkeletonBailCard = React.memo(SkeletonBailCard);
export const MemoizedSkeletonBailList = React.memo(SkeletonBailList);
export const MemoizedSkeletonRow = React.memo(SkeletonRow);

export { SkeletonLawyerCard, SkeletonLawyerList, SkeletonBailCard, SkeletonBailList, SkeletonRow };

export { SkeletonLawyerCard as SkeletonLoader };
