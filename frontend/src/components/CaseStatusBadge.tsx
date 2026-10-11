/**
 * CaseStatusBadge.tsx — Status pill for case cards (Open / Closed / Dismissed / Pending).
 * Extracted from CaseScreen to enable reuse in CaseTimelineScreen and search results.
 */
import React from 'react';
import { TINTS } from '../constants/theme';
import { View, Text } from 'react-native';

type CaseStatus = 'Open' | 'Closed' | 'Dismissed' | 'Pending' | 'Won' | 'Acquitted' | string;

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  Open:      TINTS.blue,
  Pending:   TINTS.orange,
  Closed:    TINTS.gray,
  Dismissed: TINTS.green,
  Won:       TINTS.green,
  Acquitted: TINTS.green,
};

type Props = { status: CaseStatus; size?: 'sm' | 'md' };

export const CaseStatusBadge = React.memo(function CaseStatusBadge({ status, size = 'md' }: Props) {
  const clr = STATUS_COLORS[status] ?? TINTS.gray;
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