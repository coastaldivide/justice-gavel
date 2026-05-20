// ── Navigation prop types (pragmatic — avoids explicit any types on all screens) ──────────
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export type RootStackParamList = Record<string, object | undefined>;
export type AppNavigation  = NativeStackNavigationProp<RootStackParamList>;
export type AppRoute<T extends string = string> = RouteProp<RootStackParamList, T>;

// Convenience shorthand for screen props
export interface ScreenProps {
  navigation: AppNavigation;
  route?:     AppRoute;
  [key: string]: unknown;
}
