/**
 * LawyerSkeletonCard.tsx — Animated loading placeholder for attorney search results
 * Extracted from LawyersScreen for reuse across BailSearchScreen and RecoveryAgentsScreen.
 */
import React from 'react';
import { Animated, View } from 'react-native';

type ThemeColors = any;

function SkeletonCard({ colors }: { colors: any }) {
  const shimmer = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => shimmer.stopAnimation();
  }, []);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.85] });
  const bg = colors?.bgSubtle || '#E8EEF4';
  return (
    <Animated.View style={{ opacity, backgroundColor: colors?.bgCard || '#fff',
      borderRadius: 14, padding: 16, marginBottom: 10,
      borderWidth: 1, borderColor: colors?.border || '#DDE1E7' }}>
      {/* Avatar + name row */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: bg }} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ height: 14, width: '65%', borderRadius: 6, backgroundColor: bg }} />
          <View style={{ height: 11, width: '45%', borderRadius: 6, backgroundColor: bg }} />
        </View>
      </View>
      {/* Detail rows */}
      <View style={{ height: 11, width: '80%', borderRadius: 6, backgroundColor: bg, marginBottom: 8 }} />
      <View style={{ height: 11, width: '55%', borderRadius: 6, backgroundColor: bg }} />
    </Animated.View>
  );
}

export { SkeletonCard };

export default React.memo(SkeletonCard);
