/**
 * CaseStatusBadge.tsx — Status pill for case cards (Open / Closed / Dismissed / Pending).
 * Extracted from CaseScreen to enable reuse in CaseTimelineScreen and search results.
 */
import React from 'react';
import { View, Text } from 'react-native';

type CaseStatus = 'Open' | 'Closed' | 'Dismissed' | 'Pending' | 'Won' | 'Acquitted' | string;

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Open:      { bg: '#E3F2FD', text: '#0D47A1' },
  Pending:   { bg: '#FFF3E0', text: '#E65100' },
  Closed:    { bg: '#F5F5F5', text: '#424242' },
  Dismissed: { bg: '#E8F5E9', text: '#1B5E20' },
  Won:       { bg: '#E8F5E9', text: '#1B5E20' },
  Acquitted: { bg: '#E8F5E9', text: '#1B5E20' },
};

type Props = { status: CaseStatus; size?: 'sm' | 'md' };

export const CaseStatusBadge = React.memo(function CaseStatusBadge({ status, size = 'md' }: Props) {
  const clr = STATUS_COLORS[status] ?? { bg: '#F5F5F5', text: '#424242' };
  return (
    <View style={{
      backgroundColor: clr.bg,
      borderRadius: 8,
      paddingHorizontal: size === 'sm' ? 7 : 10,
      paddingVertical:   size === 'sm' ? 2 : 4,
      alignSelf: 'flex-start',
    }}>
      <Text maxFontSizeMultiplier={1.2} style={{
        fontSize:   size === 'sm' ? 10 : 12,
        fontWeight: '700',
        color:      clr.text,
      }}>
        {status}
      </Text>
    </View>
  );
})