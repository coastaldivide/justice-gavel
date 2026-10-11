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

interface Props {
  route: { params?: { matterId?: string; attorneyId?: string; topic?: string } };
  navigation: any;
}

function VideoConsultationScreen({ route, navigation }: Props) {
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { showToast } = useToast();
  const { matterId, attorneyId, topic } = route.params || {};
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
        showToast('Video consultations are available on Legal Pro and Esquire plans.');
      } else {
        setError(apiErrorMessage(e, 'Could not start video session'));
      }
    } finally {
      setLoading(false);
    }
  }, [matterId, attorneyId, topic, showToast]);

  const endSession = useCallback(async () => {
    if (roomName) {
      await api.delete(`/video/session/${roomName}`).catch(() => showToast('Action failed. Please try again.', 'error'));
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
          Session Ready
        </Text>
        <TouchableOpacity
          style={[styles.startBtn, { backgroundColor: colors.navy || COLORS.navy, marginBottom: 16 }]}
          onPress={() => openBrowserAsync(sessionUrl)}
          accessibilityRole="button"
          accessibilityHint="Double-tap to activate"
        >
          <Text style={styles.startBtnText}>Open Video Call</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.cancelBtn} onPress={endSession}>
          <Text style={[styles.cancelText, { color: colors.textSecond }]}>End Session</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Pre-session / lobby view ───────────────────────────────────────────
  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.textPrimary }]}>
          Video Consultation
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.subtitle, { color: colors.textSecond }]}>
          {topic || 'Attorney-Client Session'}
        </Text>
      </View>

      <View style={styles.infoCard}>
        <Text style={[styles.infoTitle, { color: colors.textPrimary }]}>Before you start</Text>
        {[
          '🔒 End-to-end encrypted (Daily.co)',
          '⚖️  Protected by attorney-client privilege',
          '📱 Works on iOS, Android, and web',
          '⏱  Session lasts up to 2 hours',
          '🚫 Session is not recorded by default',
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
          accessibilityHint="Double-tap to activate"
      >
        {loading
          ? <ActivityIndicator color={colors.white} />
          : <Text style={styles.startBtnText}>Start Video Call</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={styles.cancelBtn}>
        <Text style={[styles.cancelText, { color: colors.textSecond }]}>Cancel</Text>
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