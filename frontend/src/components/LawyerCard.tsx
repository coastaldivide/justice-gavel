/**
 * LawyerCard.tsx — Attorney result card for GPS / city search results.
 * Extracted from LawyersScreen to reduce file size and enable reuse.
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, Linking,
} from 'react-native';

export type Lawyer = {
  id: number;
  name: string;
  city?: string;
  state?: string;
  phone?: string;
  address?: string;
  distanceKm?: number;
  rating?: number;
  reviews?: number;
  hourly_rate?: number;
  free_consultation?: boolean | number;
  pro_bono?: boolean | number;
  specialties?: string;
  languages?: string;
  jtb_verified?: boolean | number;
  bar_verified?: boolean | number;
  gavel_level?: number;
  availability?: string;
  bio?: string;
  website?: string;
};

type LawyerCardProps = {
  lawyer: Lawyer;
  colors: Record<string, string>;
  onPress?: (id: number) => void;
  onCall?: (phone: string) => void;
};

/** Renders a single attorney card with call button, verification badges, and distance. */
export const LawyerCard = React.memo(function LawyerCard({ lawyer, colors, onPress, onCall }: LawyerCardProps) {
  const dist = lawyer.distanceKm != null
    ? lawyer.distanceKm < 1
      ? '< 1 km'
      : `${Math.round(lawyer.distanceKm)} km`
    : null;

  return (
    <TouchableOpacity
      onPress={() => onPress?.(lawyer.id)}
          accessibilityRole="button"
      style={{
        backgroundColor: colors.bgCard,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: colors.border,
      }}
      accessibilityLabel={`Attorney ${lawyer.name}${dist ? `, ${dist} away` : ''}`}>

      {/* Header row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={1.3}
            style={{ fontSize: 15, fontWeight: '700', color: colors.textPrimary }}>
            {lawyer.name}
          </Text>
          {(lawyer.city || lawyer.state) && (
            <Text maxFontSizeMultiplier={1.2}
              style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              {[lawyer.city, lawyer.state].filter(Boolean).join(', ')}
              {dist ? `  ·  ${dist}` : ''}
            </Text>
          )}
        </View>

        {/* Verification badges */}
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {!!lawyer.jtb_verified && (
            <View style={{ backgroundColor: colors.navy, borderRadius: 6,
              paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>JTB ✓</Text>
            </View>
          )}
          {!!lawyer.bar_verified && (
            <View style={{ backgroundColor: '#1B5E20', borderRadius: 6,
              paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>BAR ✓</Text>
            </View>
          )}
        </View>
      </View>

      {/* Specialties */}
      {!!lawyer.specialties && (
        <Text maxFontSizeMultiplier={1.2}
          numberOfLines={1}
          style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          {lawyer.specialties}
        </Text>
      )}

      {/* Meta row */}
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        {lawyer.rating != null && (
          <Text style={{ fontSize: 12, color: colors.textMuted }}>
            ⭐ {lawyer.rating.toFixed(1)} ({lawyer.reviews ?? 0})
          </Text>
        )}
        {!!lawyer.free_consultation && (
          <Text style={{ fontSize: 12, color: '#1B5E20' }}>Free consult</Text>
        )}
        {!!lawyer.pro_bono && (
          <Text style={{ fontSize: 12, color: '#0D47A1' }}>Pro bono</Text>
        )}
      </View>

      {/* Call button */}
      {!!lawyer.phone && (
        <TouchableOpacity
          onPress={() => onCall
            ? onCall(lawyer.phone!)
            : Linking.openURL(`tel:${lawyer.phone}`)}
          style={{
            backgroundColor: colors.navy, borderRadius: 10,
            paddingVertical: 10, alignItems: 'center',
          }}
          accessibilityRole="button"
          accessibilityLabel={`Call ${lawyer.name}`}>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
            📞 Call now
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
})