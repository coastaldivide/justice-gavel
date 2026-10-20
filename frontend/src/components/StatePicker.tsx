/**
 * StatePicker — "📍 Tennessee · Change state" button + a modal list of the 50
 * states and DC in the app's language. `allowAll` adds an "All states" row
 * (value ''). The choice is remembered as the person's state (setUserState).
 */
import React, { useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../constants/theme';
import { localizedStateList, setUserState, stateName } from '../utils/userState';
import { t, useLang } from '../i18n';

export function StatePicker({ value, onChange, allowAll = false, remember = true, testID = 'state-picker' }: {
  value: string; onChange: (code: string) => void; allowAll?: boolean; remember?: boolean; testID?: string;
}): React.JSX.Element {
  useLang();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const rows = [...(allowAll ? [{ code: '', name: t('src_all_states') }] : []), ...localizedStateList()];
  const choose = (code: string) => {
    setOpen(false);
    onChange(code);
    if (remember && code) setUserState(code).catch(() => {});
  };
  return (
    <>
      <TouchableOpacity accessibilityRole="button" testID={testID} accessibilityLabel={t('src_choose_state_a11y', { state: value ? stateName(value) : t('src_no_state') })}
        style={[styles.pick, { borderColor: colors.border, backgroundColor: colors.bgCard }]} onPress={() => setOpen(true)}>
        <Text maxFontSizeMultiplier={1.3} style={[styles.pickText, { color: colors.textPrimary }]} numberOfLines={1}>
          📍 {value ? stateName(value) : allowAll ? t('src_all_states') : t('src_no_state')}
        </Text>
        <Text maxFontSizeMultiplier={1.3} style={[styles.change, { color: colors.textBrand }]}>{t('pen_change_state')}</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.back}>
          <View style={[styles.card, { backgroundColor: colors.bgCard }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.title, { color: colors.textPrimary }]} accessibilityRole="header">{t('pen_change_state')}</Text>
            <FlatList
              data={rows}
              keyExtractor={s => s.code || 'all'}
              renderItem={({ item }) => (
                <TouchableOpacity accessibilityRole="button" testID={`${testID}-${item.code || 'ALL'}`} style={[styles.row, { borderBottomColor: colors.border }]} onPress={() => choose(item.code)}>
                  <Text maxFontSizeMultiplier={1.3} style={[styles.rowText, { color: colors.textPrimary }, item.code === value && styles.bold]}>{item.name}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity accessibilityRole="button" style={[styles.cancel, { borderColor: colors.navy }]} onPress={() => setOpen(false)}>
              <Text maxFontSizeMultiplier={1.3} style={[styles.cancelText, { color: colors.textBrand }]}>{t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  pickText: { fontSize: 15, fontWeight: '700', flexShrink: 1 },
  change: { fontSize: 13, fontWeight: '700' },
  back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  card: { borderRadius: 16, padding: 16, maxHeight: '80%', width: '100%', maxWidth: 480, alignSelf: 'center' },
  title: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  row: { minHeight: 44, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { fontSize: 15 },
  bold: { fontWeight: '800' },
  cancel: { minHeight: 44, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: 12 },
  cancelText: { fontSize: 14, fontWeight: '700' },
});
