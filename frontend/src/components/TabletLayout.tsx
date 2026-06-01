/**
 * components/TabletLayout.tsx — Tablet-aware layout wrapper
 *
 * Wraps screen content with maxWidth centering on iPad/tablet.
 * On phone: transparent pass-through (no visual change).
 * On tablet: content column centered, max 600pt wide.
 *
 * Usage:
 *   <TabletLayout>
 *     <ScrollView>...</ScrollView>
 *   </TabletLayout>
 *
 *   Or with a sidebar for two-column layout on wide screens:
 *   <TabletLayout sidebar={<CaseList />}>
 *     <CaseDetail />
 *   </TabletLayout>
 */

import React from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { CONTENT_MAX_WIDTH } from '../utils/responsive';

interface TabletLayoutProps {
  children:   React.ReactNode;
  sidebar?:   React.ReactNode;
  maxWidth?:  number;
  padding?:   number;
  style?:     object;
}

export function TabletLayout({
  children,
  sidebar,
  maxWidth  = CONTENT_MAX_WIDTH,
  padding   = 0,
  style,
}: TabletLayoutProps) {
  const { width } = useWindowDimensions();
  const isTablet  = width >= 768;

  // Two-column layout for tablet if sidebar provided
  if (isTablet && sidebar) {
    return (
      <View style={[s.row, style]}>
        <View style={s.sidebar}>{sidebar}</View>
        <View style={[s.main, { maxWidth }]}>{children}</View>
      </View>
    );
  }

  // Single column, centered on tablet
  if (isTablet) {
    return (
      <View style={[s.center, style]}>
        <View style={{ width: '100%', maxWidth, paddingHorizontal: padding || 24 }}>
          {children}
        </View>
      </View>
    );
  }

  // Phone: full width, no change
  return (
    <View style={[s.phone, style]}>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  center:  { flex: 1, alignItems: 'center', width: '100%' },
  phone:   { flex: 1 },
  row:     { flex: 1, flexDirection: 'row' },
  sidebar: { width: 320, borderRightWidth: 0.5, borderRightColor: '#E5E7EB' },
  main:    { flex: 1, paddingHorizontal: 24 },
});

export default TabletLayout;
