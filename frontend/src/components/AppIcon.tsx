/**
 * components/AppIcon.tsx — Unified icon component
 *
 * Wraps @expo/vector-icons Ionicons. Replaces emoji icons on all primary
 * navigation, headers, and action buttons. Fully theme-aware — inherits
 * color from theme tokens by default.
 *
 * Usage:
 *   <AppIcon name="shield-checkmark" size={24} color={COLORS.navy} />
 *   <AppIcon name="alert-circle" size={20} />   // defaults to textPrimary
 */

import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';

interface AppIconProps {
  name: keyof typeof Ionicons.glyphMap;
  size?: number;
  color?: string;
  style?: object;
}

export function AppIcon({ name, size = 22, color = COLORS.textPrimary, style }: AppIconProps) {
  return <Ionicons name={name} size={size} color={color} style={style} />;
}

// ── Semantic icon map — consistent icons across the app ──────────────────────
// Use these constants instead of raw name strings for maintainability
export const ICONS = {
  // Navigation
  home:           'home-outline'         as const,
  cases:          'folder-open-outline'  as const,
  lawyers:        'people-outline'       as const,
  settings:       'settings-outline'     as const,
  more:           'grid-outline'         as const,
  back:           'chevron-back'         as const,
  close:          'close'                as const,
  menu:           'menu-outline'         as const,

  // Legal status
  gavel:          'hammer-outline'       as const,
  shield:         'shield-checkmark-outline' as const,
  scale:          'scale-outline'        as const,
  document:       'document-text-outline'as const,
  briefcase:      'briefcase-outline'    as const,

  // Alerts & urgency
  alertCritical:  'alert-circle'         as const,
  alertHigh:      'warning-outline'      as const,
  alertNormal:    'information-circle-outline' as const,
  checkmark:      'checkmark-circle'     as const,
  emergency:      'flash'                as const,

  // Actions
  add:            'add-circle-outline'   as const,
  edit:           'pencil-outline'       as const,
  delete:         'trash-outline'        as const,
  share:          'share-outline'        as const,
  download:       'download-outline'     as const,
  search:         'search-outline'       as const,
  filter:         'funnel-outline'       as const,
  refresh:        'refresh-outline'      as const,

  // Communication
  phone:          'call-outline'         as const,
  message:        'chatbubble-outline'   as const,
  chat:           'chatbubbles-outline'  as const,
  notification:   'notifications-outline'as const,
  mail:           'mail-outline'         as const,

  // Finance
  bail:           'cash-outline'         as const,
  card:           'card-outline'         as const,
  receipt:        'receipt-outline'      as const,

  // User / Account
  user:           'person-outline'       as const,
  attorney:       'person-circle-outline'as const,
  firm:           'business-outline'     as const,
  lock:           'lock-closed-outline'  as const,

  // Rights / Legal content
  rights:         'hand-right-outline'   as const,
  ice:            'warning'              as const,
  crisis:         'heart-outline'        as const,
  family:         'people-circle-outline'as const,

  // UI controls
  chevronRight:   'chevron-forward'      as const,
  chevronDown:    'chevron-down'         as const,
  chevronUp:      'chevron-up'           as const,
  eye:            'eye-outline'          as const,
  location:       'location-outline'     as const,
  calendar:       'calendar-outline'     as const,
  clock:          'time-outline'         as const,
  star:           'star-outline'         as const,
  starFilled:     'star'                 as const,
} as const;

export default AppIcon;
