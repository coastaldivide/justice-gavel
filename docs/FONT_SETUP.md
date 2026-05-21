# Font Setup — Justice Gavel
## Adding custom fonts with expo-font

Install:
  npx expo install expo-font @expo-google-fonts/inter

Add to App.tsx:
```typescript
import { useFonts, Inter_400Regular, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    'Inter-Regular':  Inter_400Regular,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold':     Inter_700Bold,
  });

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;
  return <View onLayout={onLayoutRootView}>...</View>;
}
```

Update theme.ts fontFamily:
```typescript
fonts: {
  regular:  'Inter-Regular',
  semibold: 'Inter-SemiBold',
  bold:     'Inter-Bold',
  mono:     'Courier New',
}
```

Why Inter:
- Designed for screen readability
- Variable font — single file covers all weights
- Excellent Latin + Devanagari + Greek coverage
- Free, open-source (Google Fonts)
