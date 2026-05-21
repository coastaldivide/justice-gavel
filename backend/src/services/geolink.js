export const googleMapsLink=(lat,lng)=>`https://maps.google.com/?q=${lat},${lng}`;

/**
 * haversineKm — precise great-circle distance in kilometers.
 * Used for sorting providers by distance from user GPS coordinates.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat  = toRad(lat2 - lat1);
  const dLon  = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

export const haversineMiles = (lat1, lon1, lat2, lon2) =>
  haversineKm(lat1, lon1, lat2, lon2) * 0.621371;

/** Bounding-box pre-filter before exact haversine — fast SQL WHERE clause. */
export function bboxFromLatLng(lat, lng, radiusMiles) {
  const latDelta = radiusMiles / 69.0;
  const lngDelta = radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180));
  return { minLat: lat-latDelta, maxLat: lat+latDelta,
           minLng: lng-lngDelta, maxLng: lng+lngDelta };
}
