/**
 * FloatingSOSButton — the SOS control, docked at the bottom of the screen.
 *
 * It sits in its own lane below the scrolling content (a dock in normal
 * layout flow, not an overlay), so it can never cover text or a button at any
 * width or scroll position. Screens may put other always-there actions in the
 * lane beside it (`children`, e.g. Home's 911 / 988 row). Calm but
 * unmistakable: a solid emergency-red control with a still halo — no endless
 * pulse. A tap works as before (haptic + the screen's onPress, which asks
 * before sending), so the face says just "SOS" and the accessibility hint
 * says "tap, then confirm" — never "hold".
 */
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { COLORS, useTheme, type ThemeColors } from '../constants/theme';
import { hapticImpact } from '../utils/webCompat';
import { t, useLang } from '../i18n';

/** Width of the content column the dock lines up with on wide screens. */
export const SOS_DOCK_MAX_WIDTH = 760;

function FloatingSOSButton({ onPress, sending, children }: { onPress: () => void; sending?: boolean; children?: React.ReactNode }) {
  useLang();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View testID="sos-dock" style={[styles.dock, { backgroundColor: colors.bg, borderTopColor: colors.border }]}>
      <View style={styles.inner}>
        <View style={styles.lead}>{children}</View>
        <View style={[styles.halo, { backgroundColor: colors.emergencyBg, borderColor: colors.emergency }]}>
          <TouchableOpacity testID="sos-button" style={styles.btn} onPress={() => { hapticImpact('Heavy').catch(() => {}); onPress(); }}
            accessibilityLabel={t('x_floating_sosbutton_emergency_call_help')}
            accessibilityRole="button"
            accessibilityHint={t('sos_btn_hint')} activeOpacity={0.85} disabled={sending}>
            {sending
              ? <ActivityIndicator color={COLORS.white} size="small" />
              : <Text maxFontSizeMultiplier={1.2} style={styles.label}>SOS</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  dock:  { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 8 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '100%', maxWidth: SOS_DOCK_MAX_WIDTH, alignSelf: 'center' },
  lead:  { flex: 1, minWidth: 0 },
  halo:  { borderRadius: 34, padding: 3, borderWidth: 1 },
  btn:   {
    backgroundColor: colors.emergencyDark,
    width: 60, height: 60, borderRadius: 30,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { color: colors.white, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 18, lineHeight: 22, letterSpacing: 1.5 },
});

export default React.memo(FloatingSOSButton);
