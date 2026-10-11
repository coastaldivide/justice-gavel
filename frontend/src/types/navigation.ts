// ── Navigation prop types (pragmatic — avoids explicit any types on all screens) ──────────
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

export type RootStackParamList = Record<string, object | undefined>;
export type AppNavigation  = NativeStackNavigationProp<RootStackParamList>;
export type AppRoute<T extends string = string> = RouteProp<RootStackParamList, T>;

// Convenience shorthand for screen props.
// `route` is required: react-navigation always passes it to screen components,
// and keeping it optional makes ComponentType<ScreenProps> unassignable to the
// navigator's ScreenComponentType under strictFunctionTypes (propTypes variance).
export interface ScreenProps<T extends string = string> {
  navigation: AppNavigation;
  route:      AppRoute<T>;
  [key: string]: unknown;
}
