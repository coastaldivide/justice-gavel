import { useHaptics } from '../hooks/useHaptics';
import { useToast } from '../components/ToastProvider';
/**
 * ConflictCheckScreen.tsx — Attorney conflict of interest check
 * Allows firm attorneys to check for conflicts before accepting a client.
 * Legal Pro + Esquire tier only.
 */
import React, { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, LayoutAnimation} from 'react-native';
import { FlashListCompat as FlashList } from '../components/FlashListCompat';
import {
  View, Text, TextInput, TouchableOpacity, RefreshControl,
  ActivityIndicator, StyleSheet,
} from 'react-native';
import { api } from '../services/api';
import { t } from '../i18n';

interface ConflictResult {
  found: boolean;
  matches: Array<{ party_name: string; matter_title: string; party_role: string }>;
  checked: number;
}

interface Props { navigation: any; }

function ConflictCheckScreen({ navigation }: Props) {
  const { impact, success, error: hapticError } = useHaptics();
  React.useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }, []);
  const { showToast } = useToast();
  const [refreshing, setRefreshing] = React.useState(false);
  const [parties, setParties]   = useState<string>('');
  const [result, setResult]     = useState<ConflictResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    const names = parties.split('\n').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) {
      showToast('Enter at least one party name');
      return;
    }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data } = await api.post('/conflicts/check', {
        parties: names.map(name => ({ name, role: 'adverse' })),
      });
      setResult(data);
    } catch (e: any) {
      if (e?.response?.status === 403) {
        showToast('Conflict checks require a Legal Pro subscription.');
      } else {
        setError(e?.response?.data?.error || 'Conflict check failed');
      }
    } finally {
      setLoading(false);
    }
  }, [parties, navigation]);

  return (
    <View style={styles.screen}>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>Conflict of Interest Check</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
        Enter party names (one per line) to check for conflicts with existing firm clients.
      </Text>

      <TextInput
        style={styles.input}
        value={parties}
        onChangeText={setParties}
        placeholder={"John Smith\nAcme Corporation\nMary Jones"}
        multiline
        numberOfLines={6}
        returnKeyType="default"
        maxLength={10000}
      />

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={runCheck}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Run conflict check"
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>Run Conflict Check</Text>
        }
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <View style={styles.results}>
          <View style={[styles.resultBanner, { backgroundColor: result.found ? '#fef2f2' : '#f0fdf4' }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.resultTitle, { color: result.found ? '#c0392b' : '#16a34a' }]}>
              {result.found ? `⚠️  ${result.matches.length} Conflict(s) Found` : '✅ No Conflicts Found'}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.resultSub}>
              Checked {result.checked} parties against firm's client database
            </Text>
          </View>

          {result.matches.length > 0 && (
            <FlashList
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(false)} />}
              data={result.matches}
              keyExtractor={(item, idx) => `conflict-${idx}`}
              renderItem={({ item }) => (
                <View style={styles.matchRow}>
                  <Text maxFontSizeMultiplier={1.3} style={styles.matchName}>{item.party_name}</Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.matchMatter}>{item.matter_title}</Text>
                  <Text maxFontSizeMultiplier={1.3} style={styles.matchRole}>Role: {item.party_role}</Text>
                </View>
              )}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen:       { flex: 1, padding: 20, backgroundColor: '#f9fafb' },
  title:        { fontSize: 22, fontWeight: '700', color: '#042C53', marginBottom: 6 },
  subtitle:     { fontSize: 14, color: '#666', marginBottom: 16, lineHeight: 20 },
  input:        { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12,
                  fontSize: 14, backgroundColor: '#fff', minHeight: 120, textAlignVertical: 'top',
                  marginBottom: 16 },
  btn:          { backgroundColor: '#042C53', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnDisabled:  { opacity: 0.6 },
  btnText:      { color: '#fff', fontSize: 15, fontWeight: '700' },
  error:        { color: '#c0392b', marginTop: 12, fontSize: 14 },
  results:      { marginTop: 20 },
  resultBanner: { borderRadius: 10, padding: 14, marginBottom: 16 },
  resultTitle:  { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  resultSub:    { fontSize: 13, color: '#666' },
  matchRow:     { backgroundColor: '#fff', borderRadius: 8, padding: 12, marginBottom: 8,
                  borderLeftWidth: 3, borderLeftColor: '#c0392b' },
  matchName:    { fontSize: 15, fontWeight: '600', color: '#111', marginBottom: 2 },
  matchMatter:  { fontSize: 13, color: '#374151', marginBottom: 2 },
  matchRole:    { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },
});
export default React.memo(ConflictCheckScreen);
