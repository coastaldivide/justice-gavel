import * as Location from 'expo-location';
import { STATE_NAMES, setUserState, getUserState } from '../utils/userState';
import { api } from './api';

export interface Coords {
  lat: number;
  lng: number;
}

export interface LocationResult extends Coords {
  city: string | null;        // nearest city in our dataset
  distanceToCityKm: number | null;
  permissionGranted: boolean;
  source: 'gps' | 'manual' | 'default';
}

const DEFAULT_LOCATION: LocationResult = {
  lat: 36.1627,
  lng: -86.7816,
  city: 'Nashville, TN',
  distanceToCityKm: null,
  permissionGranted: false,
  source: 'default'
};

/**
 * Request GPS and resolve to nearest dataset city.
 * Falls back to Nashville if permission denied or GPS unavailable.
 */
export async function getLocationWithCity(): Promise<LocationResult> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return DEFAULT_LOCATION;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });
    const { latitude: lat, longitude: lng } = loc.coords;

    // Ask backend to resolve nearest city
    try {
      const res = await api.get('/providers/nearest-city', { params: { lat, lng } });
      return {
        lat,
        lng,
        city: res.data.city,
        distanceToCityKm: res.data.distanceKm,
        permissionGranted: true,
        source: 'gps'
      };
    } catch {
      // Backend unreachable — still return coords, city resolution failed
      return { lat, lng, city: null, distanceToCityKm: null, permissionGranted: true, source: 'gps' };
    }
  } catch {
    return DEFAULT_LOCATION;
  }
}

/**
 * Raw coords only — for bail search and other simple distance queries.
 */
export async function getLocation(): Promise<Coords> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission denied');

  // Try last-known position first for instant response (< 10min old)
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 600_000,       // 10 minutes
    requiredAccuracy: 1000, // 1km — good enough for bail/lawyer search
  }).catch(() => null);
  if (lastKnown) {
    return { lat: lastKnown.coords.latitude, lng: lastKnown.coords.longitude };
  }

  // Fresh GPS fix with 5-second timeout — prevents indefinite hang on Android cold start
  const loc = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('GPS timeout')), 5_000)
    ),
  ]).catch(() =>
    // Timeout fallback: try one more time with reduced accuracy
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest })
  );
  return { lat: loc.coords.latitude, lng: loc.coords.longitude };
}

/**
 * Format distance for display: show miles if < 500 mi, else show km.
 */

/**
 * detectAndSaveUserState — auto-detect state from GPS and save it.
 * Called silently on first GPS permission grant.
 * Uses expo-location's built-in reverseGeocodeAsync — no API key needed.
 * Never throws or shows an error to the user.
 *
 * Returns the detected state code, or null if detection failed.
 */
export async function detectAndSaveUserState(): Promise<string | null> {
  try {
    // Only auto-detect if the user hasn't already set a preference
    const existing = await getUserState();
    if (existing?.code) return existing.code;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const loc = await Location.getCurrentPositionAsync({
      accuracy: (Location.Accuracy as any).Reduced,  // coarse is enough for state-level
    });

    const [geo] = await Location.reverseGeocodeAsync({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });

    if (!geo?.region) return null;

    // expo-location returns full state name in geo.region
    // Match to our 2-letter code
    const stateName = geo.region.trim();
    const stateCode = Object.entries(STATE_NAMES)
      .find(([, name]) => name.toLowerCase() === stateName.toLowerCase())?.[0];

    if (stateCode) {
      await setUserState(stateCode);
      return stateCode;
    }

    // Try abbreviated region (some devices return 'TN' directly)
    if (stateName.length === 2 && STATE_NAMES[stateName.toUpperCase()]) {
      await setUserState(stateName.toUpperCase());
      return stateName.toUpperCase();
    }

    return null;
  } catch {
    return null;  // silent — auto-detection is best-effort
  }
}

export function formatDistance(distanceKm: number | null): string {
  if (distanceKm == null) return '';
  const miles = distanceKm * 0.621371;
  if (miles < 1) return `${Math.round(distanceKm * 1000)} m away`;
  if (miles < 500) return `${miles.toFixed(1)} mi away`;
  return `${distanceKm.toFixed(0)} km away`;
}
