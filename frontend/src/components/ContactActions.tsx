/**
 * ContactActions — Call / Text / Directions / Website for a directory listing
 * (lawyer or bail agent), with the phone number shown formatted.
 *
 * Every button opens a well-formed link (utils/contact.ts); a device that
 * cannot open it gets a toast with the number to dial by hand. Buttons whose
 * data the listing lacks are not shown; with no phone at all the card says so.
 */
import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useToast } from './ToastProvider';
import { t, useLang } from '../i18n';
import { useTheme } from '../constants/theme';
import { hapticCall } from '../services/haptics';
import { formatPhone, telUrl, smsUrl, directionsUrl, websiteUrl } from '../utils/contact';

export interface ContactListing {
  name?: string | null;
  phone?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  website?: string | null;
}

export function ContactActions({ listing, testID, primaryColor }: { listing: ContactListing; testID?: string; primaryColor?: string }) {
  useLang();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const tel = telUrl(listing.phone);
  const sms = smsUrl(listing.phone);
  const dir = directionsUrl(listing);
  const web = websiteUrl(listing.website);
  const shown = formatPhone(listing.phone);

  const open = (url: string, failKey: string, params?: Record<string, string>) =>
    Linking.openURL(url).catch(() => showToast(t(failKey, params), 'warning'));

  return (
    <View testID={testID} style={styles.wrap}>
      {tel ? (
        <TouchableOpacity accessibilityRole="button" testID="contact-call"
          accessibilityLabel={t('ca_call_a11y', { name: listing.name || '', phone: shown })}
          style={[styles.call, { backgroundColor: primaryColor || colors.legalDark }]}
          onPress={() => { hapticCall(); open(tel, 'cp_dial_manually', { num: shown }); }}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.callText, { color: colors.white }]} numberOfLines={1}>
            {t('ca_call', { phone: shown })}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text testID="contact-no-phone" maxFontSizeMultiplier={1.3} style={[styles.noPhone, { color: colors.textMuted, backgroundColor: colors.bgSubtle }]}>
          {t('ca_no_phone')}
        </Text>
      )}
      <View style={styles.row}>
        {sms && (
          <TouchableOpacity accessibilityRole="button" testID="contact-text" accessibilityLabel={t('ca_text_a11y', { name: listing.name || '' })}
            style={[styles.small, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
            onPress={() => open(sms, 'hn_text_unavailable')}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.smallText, { color: colors.textPrimary }]} numberOfLines={1}>{t('x_match_text')}</Text>
          </TouchableOpacity>
        )}
        {dir && (
          <TouchableOpacity accessibilityRole="button" testID="contact-directions" accessibilityLabel={t('ca_directions_a11y', { name: listing.name || '' })}
            style={[styles.small, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
            onPress={() => open(dir, 'hn_maps_unavailable')}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.smallText, { color: colors.textPrimary }]} numberOfLines={1}>{t('ca_directions')}</Text>
          </TouchableOpacity>
        )}
        {web && (
          <TouchableOpacity accessibilityRole="link" testID="contact-website" accessibilityLabel={t('ca_website_a11y', { name: listing.name || '' })}
            style={[styles.small, { borderColor: colors.border, backgroundColor: colors.bgCard }]}
            onPress={() => open(web, 'action_failed')}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.smallText, { color: colors.textPrimary }]} numberOfLines={1}>{t('ca_website')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:      { gap: 8, marginTop: 10 },
  call:      { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  callText:  { fontSize: 15, lineHeight: 22, fontFamily: 'Inter_800ExtraBold', fontWeight: '800' },
  noPhone:   { fontSize: 13, lineHeight: 19, textAlign: 'center', borderRadius: 10, padding: 10 },
  row:       { flexDirection: 'row', gap: 8 },
  small:     { flex: 1, minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  smallText: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter_700Bold', fontWeight: '700' },
});
