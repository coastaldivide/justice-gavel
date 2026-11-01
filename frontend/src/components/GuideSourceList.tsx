/**
 * GuideSourceList — "Sources" under a section of the court guide or a stage of "Your case, step
 * by step": each official page (publisher, page title, checked date) as a link, and the app's own
 * sourced content (rights card, record-clearing check) by name. constants/guideSources.ts.
 */
import React from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { t, useLang } from '../i18n';
import { recordedDate } from './LegalSource';
import { GUIDE_SOURCES, type SourceId } from '../constants/guideSources';

export function sourceName(id: SourceId): string {
  const s = GUIDE_SOURCES[id];
  return s.labelKey ? t(s.labelKey) : `${s.org}, “${s.page}”`;
}

export default function GuideSourceList({ ids, styles, testID }: { ids: readonly SourceId[]; styles: any; testID?: string }) {
  useLang();
  return (
    <View testID={testID} style={{ marginTop: 10 }}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.source, { fontWeight: '800' }]}>{t('cgd_sources')}</Text>
      {ids.map((id) => {
        const s = GUIDE_SOURCES[id];
        const label = `${sourceName(id)} · ${t('cgd_checked', { date: recordedDate(s.checked) })}`;
        return s.url ? (
          <TouchableOpacity key={id} accessibilityRole="link" accessibilityLabel={t('cgd_open_source_a11y', { source: sourceName(id) })}
            testID={testID ? `${testID}-${id}` : undefined} style={{ minHeight: 32, justifyContent: 'center' }}
            onPress={() => Linking.openURL(s.url as string).catch(() => {})}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.source, { textDecorationLine: 'underline' }]}>{label}</Text>
          </TouchableOpacity>
        ) : (
          <Text key={id} maxFontSizeMultiplier={1.4} style={[styles.source, { marginVertical: 4 }]} testID={testID ? `${testID}-${id}` : undefined}>{label}</Text>
        );
      })}
    </View>
  );
}
