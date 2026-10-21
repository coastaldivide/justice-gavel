/**
 * components/Illustrations.tsx — SVG illustrations for key app states
 *
 * Replaces blank screens and emoji with branded, professional SVG artwork.
 * All illustrations use the Justice Gavel color system (#042C53 navy, #85B7EB steel).
 *
 * Covers:
 *   EmptyCases      — no cases yet
 *   EmptyLawyers    — no search results
 *   BailSuccess     — bondsman connected
 *   RightsCard      — rights being read
 *   CrisisSupport   — crisis resources
 *   DocumentReady   — motion/document generated
 *   Searching       — loading/searching state
 *   ErrorState      — something went wrong
 */

import React, { memo } from 'react';
import { ART, COLORS, useTheme } from '../constants/theme';
import Svg, { Circle, Rect, Path, Ellipse, Line } from 'react-native-svg';

interface IllustrationProps {
  width?: number;
  height?: number;
}

// ── Empty Cases ───────────────────────────────────────────────────────────────
export function IllustrationEmptyCases({ width = 220, height = 180 }: IllustrationProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 220 180">
      {/* Desk surface */}
      <Ellipse cx="110" cy="160" rx="90" ry="14" fill={ART.silver} />
      {/* Folder stack */}
      <Rect x="55" y="80" width="110" height="76" rx="8" fill={ART.steelTint} />
      <Rect x="60" y="72" width="100" height="76" rx="8" fill={COLORS.steel} />
      <Rect x="65" y="65" width="90" height="76" rx="8" fill={COLORS.navy} />
      {/* Folder tab */}
      <Rect x="75" y="58" width="30" height="14" rx="4" fill={COLORS.navy} />
      {/* Lines on top folder */}
      <Rect x="77" y="80" width="56" height="3" rx="1.5" fill="rgba(255,255,255,0.3)" />
      <Rect x="77" y="90" width="42" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
      <Rect x="77" y="100" width="50" height="3" rx="1.5" fill="rgba(255,255,255,0.2)" />
      {/* Plus sign */}
      <Circle cx="150" cy="52" r="18" fill={ART.amber} />
      <Rect x="141" y="50" width="18" height="4" rx="2" fill={COLORS.white} />
      <Rect x="148" y="43" width="4" height="18" rx="2" fill={COLORS.white} />
      {/* Shadow under stack */}
      <Ellipse cx="110" cy="143" rx="52" ry="5" fill="rgba(4,44,83,0.08)" />
    </Svg>
  );
}

// ── Empty Lawyers ─────────────────────────────────────────────────────────────
export function IllustrationEmptySearch({ width = 200, height = 170 }: IllustrationProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 200 170">
      {/* Search circle */}
      <Circle cx="85" cy="80" r="52" fill="none" stroke={ART.steelTint} strokeWidth="8" />
      <Circle cx="85" cy="80" r="40" fill={ART.mist} />
      {/* Question mark */}
      <Path d="M78 72 Q78 60 85 60 Q94 60 94 70 Q94 78 85 82 L85 88" stroke={COLORS.navy} strokeWidth="5" strokeLinecap="round" fill="none" />
      <Circle cx="85" cy="96" r="3.5" fill={COLORS.navy} />
      {/* Handle */}
      <Line x1="126" y1="122" x2="155" y2="152" stroke={COLORS.steel} strokeWidth="10" strokeLinecap="round" />
      {/* Sparkles */}
      <Circle cx="155" cy="38" r="4" fill={ART.amber} />
      <Circle cx="168" cy="58" r="2.5" fill={COLORS.steel} />
      <Circle cx="140" cy="22" r="3" fill={ART.steelTint} />
    </Svg>
  );
}

// ── Bail / Bondsman Connected ─────────────────────────────────────────────────
export function IllustrationBailSuccess({ width = 200, height = 170 }: IllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} viewBox="0 0 200 170">
      {/* Handshake base */}
      <Ellipse cx="100" cy="150" rx="70" ry="10" fill={ART.silver} />
      {/* Left hand */}
      <Path d="M30 100 Q40 80 55 78 L80 90 L75 110 L40 115 Z" fill={COLORS.steel} />
      <Rect x="28" y="98" width="16" height="40" rx="8" fill={ART.steelTint} />
      {/* Right hand */}
      <Path d="M170 100 Q160 80 145 78 L120 90 L125 110 L160 115 Z" fill={COLORS.navy} />
      <Rect x="156" y="98" width="16" height="40" rx="8" fill={COLORS.blue} />
      {/* Clasped center */}
      <Ellipse cx="100" cy="92" rx="22" ry="16" fill={ART.amber} />
      <Path d="M82 88 Q100 78 118 88 Q100 102 82 88Z" fill={ART.amberDeep} />
      {/* Check badge */}
      <Circle cx="100" cy="46" r="20" fill={colors.legal} />
      <Path d="M90 46 L97 53 L113 38" stroke={COLORS.white} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// ── Rights Being Read ─────────────────────────────────────────────────────────
export function IllustrationRights({ width = 200, height = 180 }: IllustrationProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 200 180">
      {/* Document */}
      <Rect x="45" y="25" width="110" height="140" rx="10" fill={COLORS.white} stroke={ART.steelTint} strokeWidth="1.5" />
      <Rect x="45" y="25" width="110" height="32" rx="10" fill={COLORS.navy} />
      {/* Gavel icon on header */}
      <Path d="M85 38 L88 30 L98 40 L95 48 Z" fill={ART.amber} />
      <Rect x="95" y="44" width="20" height="5" rx="2.5" transform="rotate(45 95 44)" fill={ART.brassGold} />
      {/* Title line */}
      <Rect x="108" y="34" width="36" height="4" rx="2" fill="rgba(255,255,255,0.5)" />
      <Rect x="108" y="42" width="24" height="3" rx="1.5" fill="rgba(255,255,255,0.3)" />
      {/* Content lines */}
      <Rect x="60" y="72" width="80" height="4" rx="2" fill={ART.silver} />
      <Rect x="60" y="84" width="66" height="4" rx="2" fill={ART.silver} />
      <Rect x="60" y="96" width="74" height="4" rx="2" fill={ART.silver} />
      <Rect x="60" y="112" width="80" height="4" rx="2" fill={ART.silver} />
      <Rect x="60" y="124" width="55" height="4" rx="2" fill={ART.silver} />
      <Rect x="60" y="136" width="70" height="4" rx="2" fill={ART.silver} />
      {/* Shield badge */}
      <Path d="M154 20 Q166 24 166 34 Q166 46 154 52 Q142 46 142 34 Q142 24 154 20Z" fill={COLORS.navy} stroke={COLORS.steel} strokeWidth="1.5" />
      <Path d="M148 36 L152 40 L160 30" stroke={COLORS.white} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

// ── Crisis Support ────────────────────────────────────────────────────────────
export function IllustrationCrisis({ width = 200, height = 170 }: IllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} viewBox="0 0 200 170">
      {/* Phone */}
      <Rect x="70" y="30" width="60" height="110" rx="14" fill={COLORS.navy} />
      <Rect x="76" y="40" width="48" height="82" rx="6" fill={ART.mist} />
      {/* Screen content - heart */}
      <Path d="M100 90 Q100 76 110 76 Q120 76 120 86 Q120 96 100 108 Q80 96 80 86 Q80 76 90 76 Q100 76 100 90Z" fill={colors.emergency} />
      {/* Home indicator */}
      <Rect x="90" y="130" width="20" height="4" rx="2" fill={COLORS.blue} />
      {/* Call waves */}
      <Path d="M48 80 Q44 90 48 100" stroke={ART.amber} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M38 70 Q32 90 38 110" stroke={ART.amber} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
      <Path d="M152 80 Q156 90 152 100" stroke={ART.amber} strokeWidth="3" strokeLinecap="round" fill="none" />
      <Path d="M162 70 Q168 90 162 110" stroke={ART.amber} strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.6" />
      {/* Stars / care indicators */}
      <Circle cx="55" cy="40" r="5" fill={COLORS.steel} opacity="0.7" />
      <Circle cx="148" cy="135" r="4" fill={COLORS.steel} opacity="0.6" />
      <Circle cx="165" cy="55" r="3" fill={ART.steelTint} opacity="0.8" />
    </Svg>
  );
}

// ── Document Generated ────────────────────────────────────────────────────────
export function IllustrationDocumentReady({ width = 200, height = 170 }: IllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} viewBox="0 0 200 170">
      {/* Paper stack shadow */}
      <Rect x="55" y="40" width="95" height="120" rx="8" fill={ART.steelTint} transform="translate(5,5)" />
      {/* Paper */}
      <Rect x="50" y="35" width="100" height="120" rx="8" fill={COLORS.white} stroke={ART.steelTint} strokeWidth="1.5" />
      {/* Header bar */}
      <Rect x="50" y="35" width="100" height="28" rx="8" fill={COLORS.navy} />
      <Rect x="50" y="55" width="100" height="8" fill={COLORS.navy} />
      {/* "AI" chip */}
      <Rect x="100" y="41" width="38" height="16" rx="8" fill="rgba(255,255,255,0.2)" />
      <Rect x="104" y="46" width="30" height="5" rx="2.5" fill="rgba(255,255,255,0.6)" />
      {/* Content lines with AI shimmer */}
      <Rect x="64" y="80" width="72" height="4" rx="2" fill={ART.silver} />
      <Rect x="64" y="92" width="58" height="4" rx="2" fill={ART.silver} />
      <Rect x="64" y="104" width="66" height="4" rx="2" fill={ART.silver} />
      <Rect x="64" y="116" width="50" height="4" rx="2" fill={ART.silver} />
      <Rect x="64" y="130" width="62" height="4" rx="2" fill={ART.silver} />
      {/* Checkmark badge */}
      <Circle cx="148" cy="38" r="20" fill={colors.legal} />
      <Path d="M138 38 L145 45 L160 28" stroke={COLORS.white} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Sparkle */}
      <Path d="M28 60 L31 52 L34 60 L42 63 L34 66 L31 74 L28 66 L20 63 Z" fill={ART.amber} opacity="0.8" />
    </Svg>
  );
}

// ── Error State ───────────────────────────────────────────────────────────────
export function IllustrationError({ width = 200, height = 170 }: IllustrationProps) {
  const { colors } = useTheme();
  return (
    <Svg width={width} height={height} viewBox="0 0 200 170">
      <Ellipse cx="100" cy="155" rx="65" ry="8" fill={ART.roseTint} />
      {/* Triangle warning */}
      <Path d="M100 30 L170 150 L30 150 Z" fill={colors.emergencyBg} stroke={colors.emergency} strokeWidth="2" strokeLinejoin="round" />
      <Path d="M100 40 L162 144 L38 144 Z" fill={ART.blushTint} />
      {/* ! mark */}
      <Rect x="96" y="70" width="8" height="42" rx="4" fill={colors.emergency} />
      <Circle cx="100" cy="127" r="5" fill={colors.emergency} />
      {/* Small bolts */}
      <Path d="M30 40 L24 52 L34 52 L28 64" stroke={ART.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M172 60 L166 70 L174 70 L168 80" stroke={ART.amber} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.7" />
    </Svg>
  );
}

// ── Convenience export ────────────────────────────────────────────────────────
export const Illustration = {
  EmptyCases:      IllustrationEmptyCases,
  EmptySearch:     IllustrationEmptySearch,
  BailSuccess:     IllustrationBailSuccess,
  Rights:          IllustrationRights,
  Crisis:          IllustrationCrisis,
  DocumentReady:   IllustrationDocumentReady,
  Error:           IllustrationError,
};

export default memo(IllustrationEmptyCases);
