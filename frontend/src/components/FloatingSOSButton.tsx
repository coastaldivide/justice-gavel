import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Text, StyleSheet, Animated, ActivityIndicator, View } from 'react-native';
import { COLORS } from '../constants/theme';
import { hapticImpact } from '../utils/webCompat';
import { t, useLang } from '../i18n';

function FloatingSOSButton({ onPress, sending }: { onPress: () => void; sending?: boolean }) {
  useLang();
  const pulse = useRef(new Animated.Value(1)).current;
  const ring  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Inner button pulse
    const pAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 800, useNativeDriver: true }),
      ])
    );
    // Outer ring expand + fade
    const rAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1.5, duration: 1200, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1,   duration: 0,    useNativeDriver: true }),
      ])
    );
    pAnim.start();
    rAnim.start();
    return () => { pAnim.stop(); rAnim.stop(); };
  }, [pulse, ring]);

  return (
    <View style={styles.wrap}>
      {/* Pulsing ring */}
      <Animated.View style={[
        styles.ring,
        { transform: [{ scale: ring }], opacity: ring.interpolate({ inputRange: [1, 1.5], outputRange: [0.4, 0] }) }
      ]} />
      {/* Button */}
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <TouchableOpacity style={styles.btn} onPress={() => { hapticImpact('Heavy').catch(() => {}); onPress(); }}
      accessibilityLabel={t('x_floating_sosbutton_emergency_call_help')}
      accessibilityRole="button"
      accessibilityHint={t('x_floating_sosbutton_activates_emergency_mode')} activeOpacity={0.85} disabled={sending}>
          {sending
            ? <ActivityIndicator color={COLORS.white} size="small" />
            : <>
                <Text style={styles.label}>SOS</Text>
                <Text style={styles.sub}>{t('x_floating_sosbutton_hold')}</Text>
              </>
          }
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:  { position: 'absolute', right: 18, bottom: 82, zIndex: 999, alignItems: 'center', justifyContent: 'center' },
  ring:  { position: 'absolute', width: 70, height: 70, borderRadius: 35, backgroundColor: COLORS.emergency },
  btn:   {
    backgroundColor: COLORS.emergency,
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.emergency, shadowOpacity: 0.6,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 12,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.25)',
  },
  label: { color: COLORS.white, fontFamily: 'Inter_900Black', fontWeight: '900', fontSize: 14, lineHeight: 21, letterSpacing: 1.5 },
  sub:   { color: COLORS.textOnNavy, fontWeight: '700', fontSize: 11, letterSpacing: 2, marginTop: 1 },
});

export default React.memo(FloatingSOSButton);
