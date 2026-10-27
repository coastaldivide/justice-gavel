/**
 * BailAgentCard — "Your bail agent" on Home (B6), for a signed-in person whose
 * account is linked to a bail agent's check-in enrollment (matched by the
 * phone / e-mail the agent enrolled them with).
 *
 *   - agency name and phone (tap to call)
 *   - next court date (the enrollment's or the bond's)
 *   - outstanding balance and the next payment, read-only, when the agent
 *     attached a Bond Desk bond to the enrollment
 *   - next check-in due, with a "Check in" button (the CheckIn screen)
 *
 * Renders nothing when there is no linked enrollment, when signed out, or when
 * the server cannot be reached — the card never shows placeholder data.
 * API: GET /api/me/bail-agent.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { api } from '../services/api';
import * as secureStorage from '../utils/secureStorage';
import { formatCourtDay } from '../services/corePath';
import { FONTS, RADIUS, useTheme } from '../constants/theme';
import { t, useLang, locale } from '../i18n';
import { AppIcon, ICONS } from './AppIcon';

export interface BailAgentInfo {
  enrollment_id: number;
  agency: { name: string | null; phone: string | null };
  next_court_date: string | null;
  check_in: { frequency: 'daily' | 'weekly'; next_due: string; checked_in_today: boolean; done_for_period: boolean; today: string; time_zone: string };
  bond: { status: string; balance_cents: number; next_payment: { due_on: string; amount_cents: number } | null } | null;
}

const money = (c: number) => (c / 100).toLocaleString(locale(), { style: 'currency', currency: 'USD' });

/** The check-in line for the card. */
export function checkInLine(c: BailAgentInfo['check_in']): string {
  if (c.checked_in_today) return t('bac_checked_in_today');
  if (c.done_for_period) return t('bac_next_checkin', { day: formatCourtDay(c.next_due) });
  return t(c.frequency === 'weekly' ? 'bac_checkin_due_week' : 'bac_checkin_due_today');
}

export default function BailAgentCard({ onCheckIn, refreshKey = 0 }: { onCheckIn: (enrollmentId: number) => void; refreshKey?: number }) {
  useLang();
  const { colors } = useTheme();
  const s = makeStyles(colors);
  const [agents, setAgents] = useState<BailAgentInfo[]>([]);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const token = await secureStorage.getToken().catch(() => null);
    if (!token) { if (mounted.current) setAgents([]); return; }
    try {
      const r = await api.get<{ agents: BailAgentInfo[] }>('/me/bail-agent');
      if (mounted.current) setAgents(Array.isArray(r.data?.agents) ? r.data.agents : []);
    } catch { if (mounted.current) setAgents([]); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (!agents.length) return null;
  return (
    <>
      {agents.map(a => {
        const name = a.agency.name || t('bac_your_agent');
        const due = !a.check_in.checked_in_today && !a.check_in.done_for_period;
        return (
          <View key={a.enrollment_id} style={s.card} testID="bail-agent-card">
            <View style={s.titleRow}>
              <AppIcon name={ICONS.bail} size={22} color={colors.textBrand} />
              <Text maxFontSizeMultiplier={1.3} style={s.title} accessibilityRole="header">{t('bac_title')}</Text>
            </View>
            <Text maxFontSizeMultiplier={1.4} style={s.agency} testID="bail-agent-name">{name}</Text>
            {!!a.agency.phone && (
              <TouchableOpacity accessibilityRole="link" accessibilityLabel={t('bac_call', { agency: name })} style={s.link} testID="bail-agent-call"
                onPress={() => Linking.openURL(`tel:${String(a.agency.phone).replace(/[^\d+]/g, '')}`).catch(() => {})}>
                <AppIcon name={ICONS.phone} size={16} color={colors.textBrand} />
                <Text maxFontSizeMultiplier={1.4} style={s.linkText}>{a.agency.phone}</Text>
              </TouchableOpacity>
            )}
            {!!a.next_court_date && (
              <Text maxFontSizeMultiplier={1.4} style={s.line} testID="bail-agent-court">{t('bac_court', { day: formatCourtDay(a.next_court_date) })}</Text>
            )}
            {!!a.bond && a.bond.balance_cents > 0 && (
              <Text maxFontSizeMultiplier={1.4} style={s.line} testID="bail-agent-balance">
                {a.bond.next_payment
                  ? t('bac_balance_next', { balance: money(a.bond.balance_cents), amount: money(a.bond.next_payment.amount_cents), day: formatCourtDay(a.bond.next_payment.due_on) })
                  : t('bac_balance', { balance: money(a.bond.balance_cents) })}
              </Text>
            )}
            <Text maxFontSizeMultiplier={1.4} style={[s.line, due && { color: colors.warnDark, ...FONTS.semiBold }]} testID="bail-agent-checkin">{checkInLine(a.check_in)}</Text>
            {due && (
              <TouchableOpacity accessibilityRole="button" style={s.btn} onPress={() => onCheckIn(a.enrollment_id)} testID="bail-agent-check-in">
                <Text maxFontSizeMultiplier={1.3} style={s.btnText}>{t('bac_check_in')}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </>
  );
}

const makeStyles = (c: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  card: { backgroundColor: c.bgCard, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: c.border, padding: 16, marginBottom: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  title: { color: c.textBrand, fontSize: 17, ...FONTS.black },
  agency: { color: c.textPrimary, fontSize: 16, ...FONTS.semiBold },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  linkText: { color: c.textBrand, fontSize: 15, textDecorationLine: 'underline' },
  line: { color: c.textSecond, fontSize: 14, lineHeight: 20, marginTop: 4 },
  btn: { backgroundColor: c.navy, borderRadius: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnText: { color: c.textOnNavy, fontSize: 15, ...FONTS.black },
});
