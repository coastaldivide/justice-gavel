/**
 * utils/animations.ts — Reanimated 3 animation primitives
 *
 * react-native-reanimated v4 is already installed but unused.
 * This file provides ready-to-use animated components that run
 * on the UI thread — smooth even when JS is busy with network requests.
 *
 * Usage:
 *   <FadeInView delay={200}><Card /></FadeInView>
 *   <SlideInView from="bottom"><Sheet /></SlideInView>
 *   <ScalePressable onPress={handlePress}><Button /></ScalePressable>
 */

import React from 'react';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, withSpring, withDelay,
  withSequence, withRepeat,
  FadeIn, FadeOut, SlideInRight, SlideInDown,
  SlideOutRight, SlideOutDown, ZoomIn, ZoomOut,
  LinearTransition, Easing,
  runOnJS,
} from 'react-native-reanimated';
import { Pressable, ViewStyle, StyleSheet } from 'react-native';

// ── Spring config presets ─────────────────────────────────────────────────
export const SPRING = {
  gentle:  { damping: 20, stiffness: 200 },
  snappy:  { damping: 15, stiffness: 400 },
  bouncy:  { damping: 8,  stiffness: 200 },
  stiff:   { damping: 30, stiffness: 500 },
} as const;

// ── Fade in view ──────────────────────────────────────────────────────────
interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
}
export const FadeInView: React.FC<FadeInViewProps> = ({
  children, delay = 0, duration = 300, style,
}) => (
  <Animated.View
    entering={FadeIn.delay(delay).duration(duration)}
    exiting={FadeOut.duration(200)}
    style={style}
  >
    {children}
  </Animated.View>
);

// ── Slide in from direction ───────────────────────────────────────────────
type Direction = 'right' | 'bottom' | 'left';
interface SlideInViewProps {
  children: React.ReactNode;
  from?: Direction;
  delay?: number;
  style?: ViewStyle;
}
export const SlideInView: React.FC<SlideInViewProps> = ({
  children, from = 'right', delay = 0, style,
}) => {
  const entering = from === 'bottom'
    ? SlideInDown.delay(delay).springify().damping(20)
    : SlideInRight.delay(delay).springify().damping(20);
  const exiting = from === 'bottom'
    ? SlideOutDown.duration(200)
    : SlideOutRight.duration(200);
  return (
    <Animated.View entering={entering} exiting={exiting} style={style}>
      {children}
    </Animated.View>
  );
};

// ── Zoom in (for cards, modals) ───────────────────────────────────────────
interface ZoomInViewProps { children: React.ReactNode; delay?: number; style?: ViewStyle; }
export const ZoomInView: React.FC<ZoomInViewProps> = ({ children, delay = 0, style }) => (
  <Animated.View
    entering={ZoomIn.delay(delay).springify().damping(15)}
    exiting={ZoomOut.duration(150)}
    style={style}
  >
    {children}
  </Animated.View>
);

// ── Scale pressable (replaces TouchableOpacity) ───────────────────────────
interface ScalePressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  scale?: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab';
}
export const ScalePressable: React.FC<ScalePressableProps> = ({
  children, onPress, onLongPress, disabled, scale = 0.96, style,
  accessibilityLabel, accessibilityRole = 'button',
}) => {
  const scaleVal = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleVal.value }],
  }));
  return (
    <Animated.View style={[animStyle, style]}>
      <Pressable
        onPressIn={() => { scaleVal.value = withSpring(scale, SPRING.snappy); }}
        onPressOut={() => { scaleVal.value = withSpring(1, SPRING.gentle); }}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
};

// ── Stagger list items (for FlatList renderItem) ──────────────────────────
export const makeStaggeredItem = (index: number) => ({
  entering: FadeIn.delay(index * 60).duration(300),
});

// ── Pulse animation (for loading indicators, notifications) ───────────────
export const usePulse = (active = true) => {
  const opacity = useSharedValue(1);
  React.useEffect(() => {
    if (active) {
      opacity.value = withRepeat(
        withSequence(withTiming(0.4, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1, true
      );
    } else {
      opacity.value = withTiming(1);
    }
  }, [active]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
};

// ── Shake animation (for error feedback) ──────────────────────────────────
export const useShake = () => {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const shake = () => {
    x.value = withSequence(
      withTiming(-8, { duration: 50 }),
      withTiming(8,  { duration: 50 }),
      withTiming(-8, { duration: 50 }),
      withTiming(8,  { duration: 50 }),
      withTiming(0,  { duration: 50 }),
    );
  };
  return { style, shake };
};

// ── Layout transition (for list reorders/filters) ──────────────────────────
export const LIST_LAYOUT_TRANSITION = LinearTransition.springify().damping(20);
