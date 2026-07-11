
/**
 * Accessibility: Minimum touch target size (WCAG 2.5.5 - 44x44 points)
 * Use touchTarget on any TouchableOpacity/Pressable that might be small
 */
import { StyleSheet } from 'react-native';

export const a11y = StyleSheet.create({
  touchTarget: {
    minHeight: 44,
    minWidth:  44,
    alignItems:     'center',
    justifyContent: 'center',
  },
  touchTargetRow: {
    minHeight: 44,
    flexDirection:  'row',
    alignItems:     'center',
  },
  liveRegion: {
    // Apply to Text that updates dynamically (AI responses, status changes)
    // accessibilityLiveRegion="polite" on the View wrapping this Text
  },
});

/** Apply to Text wrapping dynamic content for screen reader announcements */
export const LIVE_REGION_PROPS = {
  accessible:            true,
  accessibilityLiveRegion: 'polite' as const,
};
