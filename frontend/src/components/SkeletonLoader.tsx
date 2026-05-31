import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';

interface Props {
  width?:  number | string;
  height?: number;
  style?:  ViewStyle;
  rows?:   number;   // render multiple skeleton rows stacked
  label?:  string;   // ignored (accessibility label for the group)
}

export default function SkeletonLoader({ width = '100%', height = 18, style, rows = 1, label }: Props) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0,1], outputRange: [0.3, 0.7] });
  if (rows > 1) {
    return (
      <View accessibilityLabel={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonLoader key={i} width={width} height={height} style={style} />
        ))}
      </View>
    );
  }
  return (
    <Animated.View style={[s.base, { width: width as any, height, opacity }, style]} />
  );
}
const s = StyleSheet.create({
  base: { backgroundColor: '#CFD8DC', borderRadius: 4, marginVertical: 4 },
});
