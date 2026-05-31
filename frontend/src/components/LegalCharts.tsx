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

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path, G, Rect, Text as SvgText, Defs,
              LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { COLORS } from '../constants/theme';
import { AppIcon, ICONS } from './AppIcon';

// ── Lethality Gauge ────────────────────────────────────────────────────────────
interface LethalilyGaugeProps {
  score: number;      // 1–11
  maxScore?: number;
  size?: number;
}

export function LethalilyGauge({ score, maxScore = 11, size = 160 }: LethalilyGaugeProps) {
  const pct      = Math.min(score / maxScore, 1);
  const r        = size * 0.38;
  const cx       = size / 2;
  const cy       = size / 2;
  const circumf  = 2 * Math.PI * r;
  // Start at -220 degrees, sweep 260 degrees (a wide arc opening at bottom)
  const startAngle = -220 * (Math.PI / 180);
  const sweepAngle = 260 * (Math.PI / 180);
  const endAngle   = startAngle + sweepAngle * pct;

  const level = score >= 8 ? 'extreme' : score >= 4 ? 'high' : score >= 2 ? 'moderate' : 'low';
  const colors = { extreme: '#C62828', high: '#E65100', moderate: '#F59E0B', low: '#1B5E20' };
  const labels = { extreme: 'Extreme Risk', high: 'High Risk', moderate: 'Moderate', low: 'Low Risk' };
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
        <Path d={bgPath} stroke="#E8ECF4" strokeWidth={size * 0.08}
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
                 fontSize={size * 0.09} fill="#888" fontWeight="400">
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
interface BailBreakdownProps {
  bailAmount: number;
  bondsmanRate?: number;
}

export function BailBreakdown({ bailAmount, bondsmanRate = 0.10 }: BailBreakdownProps) {
  const bondsmanCost = Math.round(bailAmount * bondsmanRate);
  const cashFull     = bailAmount;
  const fmt = (n: number) => '$' + n.toLocaleString('en-US');

  return (
    <View style={gc.bailCard}>
      <Text style={gc.bailTitle}>Payment Options</Text>

      {/* Cash bail */}
      <View style={gc.bailRow}>
        <View style={gc.bailLabelRow}>
          <AppIcon name={ICONS.bail} size={16} color={COLORS.navy} />
          <Text style={gc.bailLabel}>Cash bail (full amount)</Text>
        </View>
        <Text style={gc.bailAmount}>{fmt(cashFull)}</Text>
      </View>
      <View style={gc.track}>
        <View style={[gc.fill, { width: '100%', backgroundColor: COLORS.navy }]} />
      </View>

      {/* Bondsman */}
      <View style={[gc.bailRow, { marginTop: 14 }]}>
        <View style={gc.bailLabelRow}>
          <AppIcon name={ICONS.receipt} size={16} color={COLORS.gold} />
          <Text style={gc.bailLabel}>Bondsman ({Math.round(bondsmanRate * 100)}% non-refundable)</Text>
        </View>
        <Text style={[gc.bailAmount, { color: COLORS.gold }]}>{fmt(bondsmanCost)}</Text>
      </View>
      <View style={gc.track}>
        <View style={[gc.fill, {
          width: `${bondsmanRate * 100}%`,
          backgroundColor: COLORS.gold,
        }]} />
      </View>

      <Text style={gc.bailNote}>
        The bondsman premium is non-refundable regardless of case outcome.
        Cash bail is returned when the case concludes.
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
  const config = {
    low:      { pct: 0.20, color: '#1B5E20', bg: '#E8F5E9', label: 'Low' },
    medium:   { pct: 0.50, color: '#E65100', bg: '#FFF3E0', label: 'Medium' },
    high:     { pct: 0.75, color: '#C62828', bg: '#FFEBEE', label: 'High' },
    critical: { pct: 1.00, color: '#7B1FA2', bg: '#F3E5F5', label: 'Critical' },
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
  const daysLeft = Math.max(0, deadline - daysInUS);
  const pct      = Math.min(daysInUS / deadline, 1);
  const urgent   = daysLeft <= 65;
  const barred   = daysInUS >= deadline;
  const color    = barred ? '#C62828' : urgent ? '#E65100' : '#1B5E20';

  return (
    <View style={gc.clockCard}>
      <View style={gc.clockHeader}>
        <AppIcon name={ICONS.clock} size={18} color={color} />
        <Text style={[gc.clockTitle, { color }]}>
          {barred ? 'Asylum Bar Reached' : urgent ? 'Asylum Deadline Approaching' : 'Asylum Clock'}
        </Text>
      </View>
      <View style={gc.clockNumbers}>
        <View style={gc.clockNum}>
          <Text style={[gc.clockBig, { color: COLORS.navy }]}>{daysInUS.toLocaleString()}</Text>
          <Text style={gc.clockSub}>days in US</Text>
        </View>
        <View style={gc.clockDivider} />
        <View style={gc.clockNum}>
          <Text style={[gc.clockBig, { color }]}>{barred ? '—' : daysLeft}</Text>
          <Text style={gc.clockSub}>{barred ? 'barred' : 'days left'}</Text>
        </View>
      </View>
      <View style={gc.clockTrack}>
        <View style={[gc.clockFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={gc.clockNote}>
        {barred
          ? 'Asylum filing deadline has passed. Withholding of removal or CAT may still apply.'
          : urgent
          ? `File immediately. Only ${daysLeft} days remain before the one-year asylum bar.`
          : `${daysLeft} days before the one-year asylum filing deadline (INA § 208).`}
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
  const config = {
    CRITICAL: { bg: '#C62828', text: '#fff', icon: ICONS.alertCritical },
    HIGH:     { bg: '#E65100', text: '#fff', icon: ICONS.alertHigh },
    NORMAL:   { bg: '#185FA5', text: '#fff', icon: ICONS.alertNormal },
    INFO:     { bg: '#E8F2FC', text: '#185FA5', icon: ICONS.alertNormal },
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
  bailCard:     { backgroundColor: '#fff', borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: COLORS.border },
  bailTitle:    { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 14, fontFamily: 'Inter_700Bold' },
  bailRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  bailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bailLabel:    { fontSize: 13, color: COLORS.textSecond, fontFamily: 'Inter_400Regular' },
  bailAmount:   { fontSize: 15, fontWeight: '700', color: COLORS.navy, fontFamily: 'Inter_700Bold' },
  track:        { height: 6, backgroundColor: '#EEF3FA', borderRadius: 3, overflow: 'hidden' },
  fill:         { height: 6, borderRadius: 3 },
  bailNote:     { fontSize: 12, color: COLORS.textMuted, marginTop: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  riskContainer:{ marginVertical: 8 },
  riskHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  riskLabel:    { fontSize: 13, color: COLORS.textSecond, fontFamily: 'Inter_500Medium' },
  riskBadge:    { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  riskBadgeText:{ fontSize: 12, fontWeight: '600', fontFamily: 'Inter_600SemiBold' },
  riskTrack:    { height: 8, backgroundColor: '#EEF3FA', borderRadius: 4, overflow: 'hidden' },
  riskFill:     { height: 8, borderRadius: 4 },
  clockCard:    { backgroundColor: '#fff', borderRadius: 14, padding: 18, borderWidth: 0.5, borderColor: COLORS.border },
  clockHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  clockTitle:   { fontSize: 14, fontWeight: '700', fontFamily: 'Inter_700Bold' },
  clockNumbers: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  clockNum:     { flex: 1, alignItems: 'center' },
  clockDivider: { width: 1, height: 40, backgroundColor: COLORS.border },
  clockBig:     { fontSize: 28, fontWeight: '800', fontFamily: 'Inter_800ExtraBold' },
  clockSub:     { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Inter_400Regular', marginTop: 2 },
  clockTrack:   { height: 8, backgroundColor: '#EEF3FA', borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  clockFill:    { height: 8, borderRadius: 4 },
  clockNote:    { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, fontFamily: 'Inter_400Regular' },
  signalBadge:  { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start' },
  signalText:   { fontSize: 12, fontWeight: '700', fontFamily: 'Inter_700Bold' },
});
