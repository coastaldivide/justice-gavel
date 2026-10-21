/**
 * components/LegalCharts.tsx — Data visualizations for legal metrics
 *
 * Replaces raw numbers with visual indicators:
 *   LethalilyGauge     — circular gauge for DV lethality score
 *   BailBreakdown      — horizontal bar showing cash vs bondsman
 *   RiskMeter          — linear severity meter
 *   AsylumClock        — days remaining visualization
 *   SignalBadge        — escalation level badge with icon
 */

import React, { memo } from 'react';
import { ART } from '../constants/theme';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../constants/theme';
import { AppIcon, ICONS } from './AppIcon';
import { t, useLang } from '../i18n';

// ── Lethality Gauge ────────────────────────────────────────────────────────────
interface LethalilyGaugeProps {
  score: number;      // 1–11
  maxScore?: number;
  size?: number;
}

export function LethalilyGauge({ score, maxScore = 11, size = 160 }: LethalilyGaugeProps) {
  useLang();
  const pct      = Math.min(score / maxScore, 1);
  const r        = size * 0.38;
  const cx       = size / 2;
  const cy       = size / 2;
  // Start at -220 degrees, sweep 260 degrees (a wide arc opening at bottom)
  const startAngle = -220 * (Math.PI / 180);
  const sweepAngle = 260 * (Math.PI / 180);
  const endAngle   = startAngle + sweepAngle * pct;

  const level = score >= 8 ? 'extreme' : score >= 4 ? 'high' : score >= 2 ? 'moderate' : 'low';
  const colors = { extreme: COLORS.emergency, high: COLORS.warn, moderate: ART.amber, low: COLORS.legal };
  const labels = { extreme: t('x_legal_charts_extreme_risk'), high: t('x_legal_charts_high_risk'), moderate: t('x_pilead_moderate'), low: t('x_legal_charts_low_risk') };
  const color  = colors[level];

  // Arc path calculation
  const polarToXY = (angle: number) => ({
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  });
  const start   = polarToXY(startAngle);
  const end_bg  = polarToXY(startAngle + sweepAngle);
  const end_val = polarToXY(endAngle);
  const largeArcBg  = sweepAngle > Math.PI ? 1 : 0;
  const largeArcVal = sweepAngle * pct > Math.PI ? 1 : 0;

  const bgPath  = `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcBg} 1 ${end_bg.x} ${end_bg.y}`;
  const valPath = pct > 0
    ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcVal} 1 ${end_val.x} ${end_val.y}`
    : null;

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <Path d={bgPath} stroke={ART.silver} strokeWidth={size * 0.08}
              fill="none" strokeLinecap="round" />
        {/* Value arc */}
        {valPath && (
          <Path d={valPath} stroke={color} strokeWidth={size * 0.08}
                fill="none" strokeLinecap="round" />
        )}
        {/* Score text */}
        <SvgText x={cx} y={cy - 4} textAnchor="middle"
                 fontSize={size * 0.24} fontWeight="800" fill={color}>
          {score}
        </SvgText>
        <SvgText x={cx} y={cy + size * 0.14} textAnchor="middle"
                 fontSize={size * 0.09} fill={COLORS.textMuted} fontWeight="400">
          / {maxScore}
        </SvgText>
      </Svg>
      <View style={[gc.badge, { backgroundColor: color + '18', borderColor: color + '40' }]}>
        <Text style={[gc.badgeText, { color }]}>{labels[level]}</Text>
      </View>
    </View>
  );
}

// ── Bail Breakdown ─────────────────────────────────────────────────────────────
// No default bail-agent rate: there is no sourced premium data. The agent's
// row is shown only for a rate the person was actually quoted.
interface BailBreakdownProps {
  bailAmount: number;
  /** The fee the bail agent quoted, as a fraction (0.08 = 8%). Omit when unknown. */
  quotedRate?: number | null;
}

export function BailBreakdown({ bailAmount, quotedRate = null }: BailBreakdownProps) {
  useLang();
  const rate = typeof quotedRate === 'number' && quotedRate > 0 && quotedRate < 1 ? quotedRate : null;
  const cashFull = bailAmount;
  const fmt = (n: number) => '$' + n.toLocaleString('en-US');

  return (
    <View style={gc.bailCard}>
      <Text style={gc.bailTitle}>{t('x_legal_charts_payment_options')}</Text>

      {/* Cash bail */}
      <View style={gc.bailRow}>
        <View style={gc.bailLabelRow}>
          <AppIcon name={ICONS.money} size={16} color={COLORS.navy} />
          <Text style={gc.bailLabel}>{t('x_legal_charts_cash_bail_full_amount')}</Text>
        </View>
        <Text style={gc.bailAmount}>{fmt(cashFull)}</Text>
      </View>
      <View style={gc.track}>
        <View style={[gc.fill, { width: '100%', backgroundColor: COLORS.navy }]} />
      </View>

      {/* Bail agent — only with a quoted fee */}
      <View style={[gc.bailRow, { marginTop: 14 }]}>
        <View style={gc.bailLabelRow}>
          <AppIcon name={ICONS.receipt} size={16} color={COLORS.gold} />
          <Text style={gc.bailLabel}>{rate ? t('x_legal_charts_bail_agent_quoted_fee', { value: Math.round(rate * 1000) / 10 }) : t('x_legal_charts_bail_agent')}</Text>
        </View>
        <Text style={[gc.bailAmount, { color: COLORS.goldText }]}>{rate ? fmt(Math.round(bailAmount * rate)) : t('x_legal_charts_ask_agent')}</Text>
      </View>

      <Text style={gc.bailNote}>
        {t('x_legal_charts_bail_agents_set_their')}
      </Text>
    </View>
  );
}

// ── Risk Meter ─────────────────────────────────────────────────────────────────
interface RiskMeterProps {
  level: 'low' | 'medium' | 'high' | 'critical';
  label?: string;
}

export function RiskMeter({ level, label }: RiskMeterProps) {
  useLang();
  const config = {
    low:      { pct: 0.20, color: COLORS.legal, bg: COLORS.legalBg, label: t('x_legal_charts_low') },
    medium:   { pct: 0.50, color: COLORS.warn, bg: COLORS.warnBg, label: t('x_legal_charts_medium') },
    high:     { pct: 0.75, color: COLORS.emergency, bg: COLORS.emergencyBg, label: t('x_legal_charts_high') },
    critical: { pct: 1.00, color: ART.purple, bg: ART.lilacTint, label: t('x_legal_charts_critical') },
  };
  const { pct, color, bg, label: defaultLabel } = config[level];

  return (
    <View style={gc.riskContainer}>
      <View style={gc.riskHeader}>
        <Text style={gc.riskLabel}>{label || defaultLabel}</Text>
        <View style={[gc.riskBadge, { backgroundColor: bg }]}>
          <Text style={[gc.riskBadgeText, { color }]}>{defaultLabel}</Text>
        </View>
      </View>
      <View style={gc.riskTrack}>
        <View style={[gc.riskFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ── Asylum Clock ───────────────────────────────────────────────────────────────
interface AsylumClockProps {
  daysInUS: number;
  deadline?: number;
}

export function AsylumClock({ daysInUS, deadline = 365 }: AsylumClockProps) {
  useLang();
  const daysLeft = Math.max(0, deadline - daysInUS);
  const pct      = Math.min(daysInUS / deadline, 1);
  const urgent   = daysLeft <= 65;
  const barred   = daysInUS >= deadline;
  const color    = barred ? COLORS.emergency : urgent ? COLORS.warn : COLORS.legal;

  return (
    <View style={gc.clockCard}>
      <View style={gc.clockHeader}>
        <AppIcon name={ICONS.clock} size={18} color={color} />
        <Text style={[gc.clockTitle, { color }]}>
          {barred ? t('x_legal_charts_asylum_bar_reached') : urgent ? t('x_legal_charts_asylum_deadline_approaching') : t('x_legal_charts_asylum_clock')}
        </Text>
      </View>
      <View style={gc.clockNumbers}>
        <View style={gc.clockNum}>
          <Text style={[gc.clockBig, { color: COLORS.navy }]}>{daysInUS.toLocaleString()}</Text>
          <Text style={gc.clockSub}>{t('x_legal_charts_days_us')}</Text>
        </View>
        <View style={gc.clockDivider} />
        <View style={gc.clockNum}>
          <Text style={[gc.clockBig, { color }]}>{barred ? '—' : daysLeft}</Text>
          <Text style={gc.clockSub}>{barred ? 'barred' : t('x_legal_charts_days_left')}</Text>
        </View>
      </View>
      <View style={gc.clockTrack}>
        <View style={[gc.clockFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={gc.clockNote}>
        {barred
          ? t('x_legal_charts_asylum_filing_deadline_has')
          : urgent
          ? t('x_legal_charts_file_immediately_only_days', { daysLeft })
          : t('x_legal_charts_days_before_one_year', { daysLeft })}
      </Text>
    </View>
  );
}

// ── Signal Badge ───────────────────────────────────────────────────────────────
interface SignalBadgeProps {
  label:    string;
  priority: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'INFO';
}

export function SignalBadge({ label, priority }: SignalBadgeProps) {
  useLang();
  const config = {
    CRITICAL: { bg: COLORS.emergency, text: COLORS.white, icon: ICONS.alertCritical },
    HIGH:     { bg: COLORS.warn, text: COLORS.white, icon: ICONS.alertHigh },
    NORMAL:   { bg: COLORS.blue, text: COLORS.white, icon: ICONS.alertNormal },
    INFO:     { bg: COLORS.infoBg, text: COLORS.blue, icon: ICONS.alertNormal },
  };
  const { bg, text, icon } = config[priority];

  return (
    <View style={[gc.signalBadge, { backgroundColor: bg }]}>
      <AppIcon name={icon as any} size={13} color={text} />
      <Text style={[gc.signalText, { color: text }]}>{label}</Text>
    </View>
  );
}

const gc = StyleSheet.create({
  badge:        { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, borderWidth: 1, marginTop: 8 },
  badgeText:    { fontSize: 13, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  bailCard:     { backgroundColor: COLORS.white, borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: COLORS.border },
  bailTitle:    { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 14, fontFamily: 'Inter_700Bold' },
  bailRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bailLabel:    { fontSize: 13, color: COLORS.textSecond, fontFamily: 'Inter_400Regular' },
  bailAmount:   { fontSize: 15, fontWeight: '700', color: COLORS.navy, fontFamily: 'Inter_700Bold' },
  track:        { height: 6, backgroundColor: ART.mist, borderRadius: 3, overflow: 'hidden' },
  fill:         { height: 6, borderRadius: 3 },
  bailNote:     { fontSize: 12, color: COLORS.textMuted, marginTop: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  riskContainer:{ marginVertical: 8 },
  riskHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  riskLabel:    { fontSize: 13, color: COLORS.textSecond, fontFamily: 'Inter_500Medium' },
  riskBadge:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  riskBadgeText:{ fontSize: 12, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  riskTrack:    { height: 8, backgroundColor: ART.mist, borderRadius: 4, overflow: 'hidden' },
  riskFill:     { height: 8, borderRadius: 4 },
  clockCard:    { backgroundColor: COLORS.white, borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: COLORS.border },
  clockHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  clockTitle:   { fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  clockNumbers: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  clockNum:     { flex: 1, alignItems: 'center' },
  clockDivider: { width: 1, height: 40, backgroundColor: COLORS.border },
  clockBig:     { fontSize: 28, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  clockSub:     { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  clockTrack:   { height: 8, backgroundColor: ART.mist, borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  clockFill:    { height: 8, borderRadius: 4 },
  clockNote:    { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  signalBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start' },
  signalText:   { fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
});

export default memo(LethalilyGauge);
