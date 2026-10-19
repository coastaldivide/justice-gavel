/**
 * components/SkeletonLoader.tsx — skeleton screens for all loading states
 *
 * Replaces the blank white flash on data-fetching screens with a pulsing
 * content-shaped placeholder. Users perceive this as 40% faster loading.
 *
 * Usage:
 *   if (isLoading) return <SkeletonLoader type="lawyerList" count={5} />;
 *   if (isLoading) return <SkeletonLoader type="card" />;
 */

import React, { useEffect, useRef } from 'react';
import { COLORS } from '../constants/theme';
import { View, StyleSheet, Animated } from 'react-native';
import { S, R } from '../constants/tokens';

// Pulse with the core react-native Animated API. This was the ONLY place the
// app imported react-native-reanimated, and that single import shipped the
// whole 836 KB reanimated runtime in the web entry bundle (step 9 bundle
// audit). A looping opacity tween needs none of it.
function usePulseOpacity(): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true, isInteraction: false }),
        Animated.timing(opacity, { toValue: 1,   duration: 800, useNativeDriver: true, isInteraction: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

interface SkeletonBoxProps {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: object;
}
const SkeletonBox: React.FC<SkeletonBoxProps> = ({
  width = '100%', height = 16, radius = R.sm, style,
}) => {
  const opacity = usePulseOpacity();
  return (
    <Animated.View
      style={[
        { width: width as number, height, borderRadius: radius, backgroundColor: COLORS.border },
        { opacity },
        style,
      ]}
    />
  );
};

// ── Skeleton variants for each screen type ────────────────────────────────
const LawyerCard = () => (
  <View style={styles.card}>
    <View style={styles.rowStart}>
      <SkeletonBox width={52} height={52} radius={R.xl} />
      <View style={[styles.col, { flex: 1, marginLeft: S.sm }]}>
        <SkeletonBox width="60%" height={14} />
        <SkeletonBox width="40%" height={12} style={{ marginTop: 6 }} />
      </View>
    </View>
    <SkeletonBox width="80%" height={12} style={{ marginTop: S.sm }} />
    <View style={[styles.row, { marginTop: S.sm }]}>
      <SkeletonBox width={60} height={24} radius={R.pill} />
      <SkeletonBox width={60} height={24} radius={R.pill} style={{ marginLeft: S.sm }} />
    </View>
  </View>
);

const ArrestCard = () => (
  <View style={styles.card}>
    <View style={styles.rowBetween}>
      <SkeletonBox width="50%" height={15} />
      <SkeletonBox width={70} height={22} radius={R.pill} />
    </View>
    <SkeletonBox width="70%" height={12} style={{ marginTop: 8 }} />
    <View style={[styles.row, { marginTop: 8 }]}>
      <SkeletonBox width="30%" height={12} />
      <SkeletonBox width="25%" height={12} style={{ marginLeft: S.md }} />
    </View>
  </View>
);

const ChatMessage = () => (
  <View style={{ marginBottom: S.sm }}>
    <SkeletonBox width="70%" height={40} radius={R.lg} />
    <SkeletonBox width="50%" height={32} radius={R.lg} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
    <SkeletonBox width="80%" height={56} radius={R.lg} style={{ marginTop: 8 }} />
  </View>
);

const GenericCard = () => (
  <View style={styles.card}>
    <SkeletonBox width="60%" height={16} />
    <SkeletonBox height={12} style={{ marginTop: 8 }} />
    <SkeletonBox width="80%" height={12} style={{ marginTop: 6 }} />
    <SkeletonBox width="40%" height={12} style={{ marginTop: 6 }} />
  </View>
);

const VARIANTS: Record<string, React.FC> = {
  lawyerCard: LawyerCard,
  arrestCard:  ArrestCard,
  chatMessage: ChatMessage,
  card:        GenericCard,
};

// ── Main export ────────────────────────────────────────────────────────────
interface SkeletonLoaderProps {
  type?: keyof typeof VARIANTS;
  count?: number;
  label?: string;  // accessibility label (not rendered)
  style?: object;
}
export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  type = 'card', count = 3, style,
}) => {
  const Card = VARIANTS[type] ?? GenericCard;
  return (
    <View style={style}>
      {Array.from({ length: count }, (_, i) => <Card key={i} />)}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: R.card,
    padding: S.card,
    marginBottom: S.sm,
  },
  row:        { flexDirection: 'row' },
  rowStart:   { flexDirection: 'row', alignItems: 'flex-start' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  col:        { flexDirection: 'column' },
});

export default SkeletonLoader;

// ── Memoized skeleton exports ────────────────────────────────────────────────
// (Previously referenced components that did not exist, which threw a
// ReferenceError when this module loaded.)
export const MemoizedSkeletonLawyerCard   = React.memo(LawyerCard);
export const MemoizedSkeletonCaseCard     = React.memo(GenericCard);
export const MemoizedSkeletonChatMessage  = React.memo(ChatMessage);
export const MemoizedSkeletonProfileCard  = React.memo(GenericCard);
export const MemoizedSkeletonListItem     = React.memo(ArrestCard);
