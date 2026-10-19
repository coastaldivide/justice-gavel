import { COLORS, useTheme } from '../constants/theme';
import { useToast } from '../components/ToastProvider';
/**
 * VideoConsultationScreen.tsx
 * Secure attorney-client video consultations (Legal Pro + Esquire tiers).
 * Embeds Daily.co session in a WebView — works on iOS, Android, and Web.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, LayoutAnimation } from 'react-native';
import { Linking } from 'react-native'; // open Daily.co session in system browser
const openBrowserAsync = (url: string) => Linking.openURL(url);
import { api, apiErrorMessage } from '../services/api';
import { ScreenProps } from '../types/navigation';
import { RouteParams } from '../types/api';
import { t, useLang } from '../i18n';

type Props = ScreenProps<'VideoConsultation'>;

function VideoConsultationScreen({ route, navigation }: Props) {
  useLang();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { showToast } = useToast();
  const { matterId, attorneyId, topic } = (route.params ?? {}) as RouteParams;
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [sessionUrl, setSessionUrl]   = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [inSession, setInSession]     = useState(false);
  const [roomName, setRoomName]       = useState<string | null>(null);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post('/video/session', {
        matter_id:     matterId,
        attorney_id:   attorneyId,
        topic:         topic || 'Legal Consultation',
      });
      setSessionUrl(data.join_url);
      setRoomName(data.room_name);
      setInSession(true);
    } catch (e: any) {
      if (e?.response?.status === 403 && e?.response?.data?.upgrade) {
        showToast(t('x_video_consultation_video_consultations_available_legal'));
      } else {
        setError(apiErrorMessage(e, t('x_video_consultation_could_not_start_video')));
      }
    } finally {
      setLoading(false);
    }
  }, [matterId, attorneyId, topic, showToast]);

  const endSession = useCallback(async () => {
    if (roomName) {
      await api.delete(`/video/session/${roomName}`).catch(() => showToast(t('action_failed'), 'error'));
    }
    setInSession(false);
    setSessionUrl(null);
    setRoomName(null);
    navigation.goBack();
  }, [roomName, navigation, showToast]);

  // ── Active session view ────────────────────────────────────────────────
  if (inSession && sessionUrl) {
    // Open in system browser until react-native-webview is installed
    // Replace with <WebView source={{ uri: sessionUrl }} /> after: npm i react-native-webview
    return (
      <View style={[styles.screen, { backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[styles.title, { color: colors.textPrimary, marginBottom: 16 }]}>
          {t('x_video_consultation_session_ready')}
        </Text>
        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: colors.navy || COLORS.navy, marginBottom: 16 }]}
          onPress={() => openBrowserAsync(sessionUrl)}
          accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
        >
          <Text style={styles.startBtnText}>{t('x_video_consultation_open_video_call')}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={endSession}>
          <Text style={[styles.cancelText, { color: colors.textSecond }]}>{t('x_video_consultation_end_session')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Pre-session / lobby view ───────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.textPrimary }]}>
          {t('x_nav_video_consultation')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.subtitle, { color: colors.textSecond }]}>
          {topic || t('x_video_consultation_attorney_client_session')}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>{t('x_video_consultation_before_start')}</Text>
        {[
          t('x_video_consultation_end_end_encrypted_daily'),
          t('x_video_consultation_protected_by_attorney_client'),
          t('x_video_consultation_works_ios_android_web'),
          t('x_video_consultation_session_lasts_up_2'),
          t('x_video_consultation_session_not_recorded_by'),
        ].map((item, i) => (
          <Text key={`info-${i}`} style={[styles.infoItem, { color: colors.textSecond }]}>
            {item}
          </Text>
        ))}
      </View>

      {error && (
        <View style={[styles.errorBox, { backgroundColor: colors.emergencyBg }]}>
          <Text style={{ color: colors.bail }}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.startBtn, { backgroundColor: colors.navy || COLORS.navy }]}
        onPress={startSession}
        disabled={loading}
        accessibilityRole="button"
          accessibilityHint={t('cp_double_tap')}
      >
        {loading
          ? <ActivityIndicator color={colors.white} />
          : <Text style={styles.startBtnText}>{t('x_video_consultation_start_video_call')}</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.cancelBtn}>
        <Text style={[styles.cancelText, { color: colors.textSecond }]}>{t('case_cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: any = COLORS) => StyleSheet.create({
  screen:      { flex: 1, padding: 20 },
  fullScreen:  { flex: 1 },
  webview:     { flex: 1 },
  header:      { alignItems: 'center', paddingVertical: 32 },
  title:       { fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subtitle:    { fontSize: 15 },
  infoCard:    { backgroundColor: colors.bgSubtle, borderRadius: 12, padding: 16, marginBottom: 24 },
  infoTitle:   { fontWeight: '600', fontSize: 15, marginBottom: 10 },
  infoItem:    { fontSize: 14, marginBottom: 6 },
  errorBox:    { padding: 12, borderRadius: 8, marginBottom: 16 },
  startBtn:    { borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  startBtnText:{ color: COLORS.white, fontSize: 16, fontWeight: '700' },
  cancelBtn:   { alignItems: 'center', padding: 12 },
  cancelText:  { fontSize: 14 },
  endBtn:      { position: 'absolute', bottom: 32, alignSelf: 'center',
                 paddingHorizontal: 32, paddingVertical: 14, borderRadius: 30 },
  endBtnText:  { color: COLORS.white, fontSize: 16, fontWeight: '700' },
});
export default React.memo(VideoConsultationScreen);