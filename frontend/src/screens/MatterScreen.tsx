/**
 * MatterScreen.tsx — Law firm matter detail view
 * Shows matter details, assigned attorney, court dates, linked cases, billing.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { api } from '../services/api';
import { t } from '../i18n';

interface Props {
  route: { params: { matterId: string } };
  navigation: any;
}

export default function MatterScreen({ route, navigation }: Props) {
  const { matterId } = route.params;
  const [matter, setMatter]   = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data } = await api.get(`/matters/${matterId}`);
      setMatter(data.matter ?? data);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load matter');
    } finally {
      setLoading(false);
    }
  }, [matterId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" /></View>;
  if (error)   return <View style={styles.center}><Text accessibilityRole="alert">{error}</Text></View>;
  if (!matter) return <View style={styles.center}><Text>Matter not found</Text></View>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text maxFontSizeMultiplier={1.3} style={styles.title}>{matter.title}</Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>{matter.client_name}</Text>

      {[
        ['Status',        matter.status],
        ['Type',          matter.matter_type],
        ['Jurisdiction',  matter.jurisdiction],
        ['Court Date',    matter.court_date ? new Date(matter.court_date).toLocaleDateString() : '—'],
        ['Capital Case',  matter.capital_case ? 'Yes' : 'No'],
        ['Co-defendants', matter.co_defendant_count ?? '0'],
        ['Bail Amount',   matter.bail_amount ? `$${Number(matter.bail_amount).toLocaleString()}` : '—'],
        ['Bail Status',   matter.bail_status ?? '—'],
      ].map(([label, value]) => (
        <View key={`field-${label}`} style={styles.row}>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>{label}</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.value}>{value}</Text>
        </View>
      ))}

      {matter.notes && (
        <View style={styles.notes}>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>Notes</Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.noteText}>{matter.notes}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.btn} accessibilityRole="button"
        onPress={() => navigation.navigate('VideoConsultation', { matterId })}>
        accessibilityRole="button" accessibilityLabel="Navigate"
        <Text style={styles.btnText}>Schedule Video Consultation</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: '#f9fafb' },
  content:  { padding: 20 },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title:    { fontSize: 22, fontWeight: '700', color: '#042C53', marginBottom: 4 },
  subtitle: { fontSize: 15, color: '#666', marginBottom: 20 },
  row:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' },
  label:    { fontSize: 14, color: '#666', fontWeight: '500' },
  value:    { fontSize: 14, color: '#111', fontWeight: '600', maxWidth: '60%', textAlign: 'right' },
  notes:    { marginTop: 16 },
  noteText: { fontSize: 14, color: '#374151', lineHeight: 22, marginTop: 4 },
  btn:      { backgroundColor: '#042C53', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnText:  { color: '#fff', fontSize: 16, fontWeight: '700' },
});
