/**
 * CourtDayPlan — "Plan your court day" on a court date (build plan A8).
 *
 *   - checklist saved on the court date (PUT /api/court-dates/:id/plan): ride, time off work,
 *     child care, documents, address and room — each "done" plus a short note
 *   - help links from the server: call 211 / 211.org, the county's transit agency (only where the
 *     server has a cited source; the source and the date checked are shown), map directions
 *   - ride offers from family followers, with Accept / No thanks (the follower is told)
 *   - the court-date phone line's number, when the line is on
 * The plan is the owner's own; nothing here is shown to followers.
 */
import React, { useEffect, useState } from 'react';
import { Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, apiErrorMessage } from '../services/api';
import { useToast } from './ToastProvider';
import { useTheme } from '../constants/theme';
import { t } from '../i18n';
import { IconLabel, ICONS } from './AppIcon';

export const PLAN_ITEMS = ['ride', 'time_off', 'child_care', 'documents', 'address_room'] as const;
export type PlanItemId = typeof PLAN_ITEMS[number];
export interface PlanItem { id: PlanItemId; done: boolean; note: string | null }
export interface HelpLinks {
  call_211: { phone: string; url: string };
  transit: { agency: string; serves: string; url: string; trip_planner: boolean; source_url: string; checked: string } | null;
  directions_url: string | null;
  public_defender: null | { name: string; phone: string; source_url: string };
}
export interface RideOffer { id: number; status: 'offered' | 'accepted' | 'declined'; name: string | null }

const open = (url: string) => Linking.openURL(url).catch(() => {});

/** Help links only (also used on the check-in link page). */
export function CourtHelpLinks({ help, styles, testID = 'court-help' }: { help: HelpLinks; styles: any; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID}>
      <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cdp_help_title')}</Text>
      <TouchableOpacity accessibilityRole="link" testID={`${testID}-211`} style={styles.secondaryBtn} onPress={() => open(`tel:${help.call_211.phone}`)}>
        <IconLabel center icon={ICONS.phone} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdp_call_211')}</IconLabel>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="link" testID={`${testID}-211-web`} onPress={() => open(help.call_211.url)}>
        <Text maxFontSizeMultiplier={1.4} style={styles.link}>{t('cdp_211_web')}</Text>
      </TouchableOpacity>
      <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('cdp_211_about')}</Text>
      {help.transit && (
        <View testID={`${testID}-transit`}>
          <TouchableOpacity accessibilityRole="link" style={styles.secondaryBtn} onPress={() => open(help.transit!.url)}>
            <IconLabel center icon={ICONS.car} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>
              {t(help.transit.trip_planner ? 'cdp_transit_planner' : 'cdp_transit_site', { agency: help.transit.agency })}
            </IconLabel>
          </TouchableOpacity>
          <Text maxFontSizeMultiplier={1.4} style={styles.source}>{t('cdp_transit_serves', { area: help.transit.serves, date: help.transit.checked })}</Text>
        </View>
      )}
      {!!help.directions_url && (
        <TouchableOpacity accessibilityRole="link" testID={`${testID}-directions`} style={styles.secondaryBtn} onPress={() => open(help.directions_url!)}>
          <IconLabel center icon={ICONS.directions} color={colors.textPrimary} textStyle={styles.secondaryBtnText} maxFontSizeMultiplier={1.3}>{t('cdp_directions')}</IconLabel>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function CourtDayPlan({ courtDateId, plan, help, offers, phoneLine, styles, onOffers }: {
  courtDateId: number; plan: PlanItem[]; help: HelpLinks | null; offers: RideOffer[]; phoneLine?: { number: string } | null;
  styles: any; onOffers: (o: RideOffer[]) => void;
}) {
  const { colors } = useTheme();
  const { showToast } = useToast();
  const [items, setItems] = useState<PlanItem[]>(plan);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setItems(plan); setDirty(false); }, [plan]);

  const change = (id: PlanItemId, patch: Partial<PlanItem>) => {
    setItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = { items: Object.fromEntries(items.map(i => [i.id, { done: i.done, note: i.note || '' }])) };
      const r = await api.put<{ plan: PlanItem[] }>(`/court-dates/${courtDateId}/plan`, body);
      setItems(r.data.plan); setDirty(false);
      showToast(t('cdp_saved'), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdp_save_failed')), 'error'); }
    finally { setBusy(false); }
  };
  const decide = async (o: RideOffer, decision: 'accept' | 'decline') => {
    try {
      const r = await api.post<{ ride_offers: RideOffer[] }>(`/court-dates/${courtDateId}/ride-offers/${o.id}`, { decision });
      onOffers(r.data.ride_offers);
      showToast(t(decision === 'accept' ? 'cdp_ride_accepted' : 'cdp_ride_declined', { name: o.name || t('cdp_family_member') }), 'success');
    } catch (e) { showToast(apiErrorMessage(e, t('cdp_save_failed')), 'error'); }
  };

  return (
    <View style={styles.box} testID="court-day-plan">
      <IconLabel icon={ICONS.clipboard} color={colors.textPrimary} textStyle={styles.boxTitle}>{t('cdp_title')}</IconLabel>
      <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{t('cdp_intro')}</Text>
      {items.map(i => (
        <View key={i.id} testID={`plan-${i.id}`} style={{ marginTop: 8 }}>
          <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: i.done }} testID={`plan-${i.id}-done`} onPress={() => change(i.id, { done: !i.done })}>
            <IconLabel icon={i.done ? ICONS.checkbox : ICONS.checkboxEmpty} color={colors.textPrimary} textStyle={styles.boxStrong}>{t(`cdp_item_${i.id}`)}</IconLabel>
          </TouchableOpacity>
          <TextInput accessibilityLabel={t('cdp_note_a11y', { item: t(`cdp_item_${i.id}`) })} testID={`plan-${i.id}-note`} style={styles.inputFull}
            value={i.note || ''} onChangeText={v => change(i.id, { note: v })} placeholder={t(`cdp_hint_${i.id}`)} placeholderTextColor={colors.textMuted} maxLength={200} />
        </View>
      ))}
      <TouchableOpacity accessibilityRole="button" testID="plan-save" style={[styles.primaryBtn, !dirty && { opacity: 0.6 }]} disabled={busy || !dirty} onPress={save}>
        <Text maxFontSizeMultiplier={1.3} style={styles.primaryBtnText}>{busy ? '…' : t('cdp_save')}</Text>
      </TouchableOpacity>

      {offers.length > 0 && (
        <View testID="ride-offers" style={{ marginTop: 12 }}>
          <Text maxFontSizeMultiplier={1.4} style={styles.label}>{t('cdp_rides_title')}</Text>
          {offers.map(o => (
            <View key={o.id} testID="ride-offer" style={{ marginTop: 6 }}>
              <Text maxFontSizeMultiplier={1.4} style={styles.boxText}>{t(`cdp_ride_status_${o.status}`, { name: o.name || t('cdp_family_member') })}</Text>
              {o.status === 'offered' && (
                <View style={styles.followRow}>
                  <TouchableOpacity accessibilityRole="button" testID="ride-accept" style={[styles.goBtn, { flex: 1 }]} onPress={() => decide(o, 'accept')}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.goBtnText}>{t('cdp_accept')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" testID="ride-decline" style={[styles.secondaryBtn, { flex: 1, marginTop: 0 }]} onPress={() => decide(o, 'decline')}>
                    <Text maxFontSizeMultiplier={1.3} style={styles.secondaryBtnText}>{t('cdp_decline')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {help && <CourtHelpLinks help={help} styles={styles} />}
      {!!phoneLine?.number && (
        <TouchableOpacity accessibilityRole="link" testID="court-phone-line" onPress={() => open(`tel:${phoneLine.number}`)}>
          <Text maxFontSizeMultiplier={1.4} style={styles.link}>{t('cdp_phone_line', { number: phoneLine.number })}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
