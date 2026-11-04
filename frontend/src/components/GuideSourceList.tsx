/**
 * GuideSourceList — "Sources" under a section of the court guide or a stage of "Your case, step
 * by step": each official page (publisher, page title, checked date) as a link, and the app's own
 * sourced content (rights card, record-clearing check) by name. constants/guideSources.ts.
 *
 * The weekly source re-check (docs/AI_PLATFORM.md §9) can move a source's "checked" date (only
 * when the page still says the same thing) or an admin can withhold a source while it is being
 * re-checked: GET /legal-sources/status (public, cached) is merged over the bundled dates; a
 * withheld source is shown without its link, marked "being re-checked". Offline / no answer →
 * the bundled dates as before.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { t, useLang } from '../i18n';
import { recordedDate } from './LegalSource';
import { GUIDE_SOURCES, type SourceId } from '../constants/guideSources';
import { api } from '../services/api';

type SourceStatus = Record<string, { checked_on: string | null; withheld: boolean }>;
let statusCache: Promise<SourceStatus> | null = null;
/** The guide sources' re-check status (one request per app start; {} when it fails). */
export function guideSourceStatus(): Promise<SourceStatus> {
  if (!statusCache) {
    statusCache = api.get<{ datasets: { guide?: SourceStatus } }>('/legal-sources/status', { params: { dataset: 'guide' } })
      .then((r) => r.data?.datasets?.guide || {})
      .catch(() => { statusCache = null; return {}; });
  }
  return statusCache;
}
/** Test hook. */
export function _resetGuideSourceStatus(): void { statusCache = null; }
const later = (a: string, b: string | null | undefined) => (b && b > a ? b : a);

export function sourceName(id: SourceId): string {
  const s = GUIDE_SOURCES[id];
  return s.labelKey ? t(s.labelKey) : `${s.org}, “${s.page}”`;
}

export default function GuideSourceList({ ids, styles, testID }: { ids: readonly SourceId[]; styles: any; testID?: string }) {
  useLang();
  const [status, setStatus] = useState<SourceStatus>({});
  useEffect(() => { let live = true; guideSourceStatus().then((x) => { if (live) setStatus(x); }); return () => { live = false; }; }, []);
  return (
    <View testID={testID} style={{ marginTop: 10 }}>
      <Text maxFontSizeMultiplier={1.4} style={[styles.source, { fontWeight: '800' }]}>{t('cgd_sources')}</Text>
      {ids.map((id) => {
        const s = GUIDE_SOURCES[id];
        const st = status[id];
        const label = `${sourceName(id)} · ${st?.withheld ? t('cgd_source_rechecking') : t('cgd_checked', { date: recordedDate(later(s.checked, st?.checked_on)) })}`;
        return s.url && !st?.withheld ? (
          <TouchableOpacity key={id} accessibilityRole="link" accessibilityLabel={t('cgd_open_source_a11y', { source: sourceName(id) })}
            testID={testID ? `${testID}-${id}` : undefined} style={{ minHeight: 44, justifyContent: 'center' }}
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
