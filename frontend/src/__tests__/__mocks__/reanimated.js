// Mock for react-native-reanimated and worklets in Jest
module.exports = {
  default: {},
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  withTiming: (v) => v,
  withSpring: (v) => v,
  withRepeat: (v) => v,
  withSequence: (...args) => args[0],
  runOnJS: (fn) => fn,
  runOnUI: (fn) => fn,
  Easing: { linear: (t) => t, ease: (t) => t, bezier: () => (t) => t },
  FadeIn: {}, FadeOut: {}, SlideInRight: {}, SlideOutLeft: {},
  createAnimatedComponent: (C) => C,
  Animated: { View: 'View', Text: 'Text', ScrollView: 'ScrollView' },
};
