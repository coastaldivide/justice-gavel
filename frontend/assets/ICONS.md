# App Icon + Splash Screen Generation

The source logo is at `assets/logo.svg`.

## Required output files

| File | Size | Purpose |
|---|---|---|
| `icon.png` | 1024×1024 | App Store + Google Play icon |
| `adaptive-icon.png` | 1024×1024 | Android adaptive icon foreground |
| `splash.png` | 1284×2778 | iOS splash screen |
| `favicon.png` | 48×48 | Web favicon |

## Generate with Expo tools (recommended)

```bash
# Install sharp-based generator
npm install -g @expo/image-utils

# Generate all icon sizes from logo.svg
npx @expo/image-utils icon --input ./assets/logo.svg --output ./assets/icon.png
```

## Generate manually (any SVG tool)

1. Open `logo.svg` in Figma, Sketch, or Inkscape
2. Export at 1024×1024 on navy background (#042C53) → `icon.png`
3. Export foreground only (no background) at 1024×1024 → `adaptive-icon.png`
4. Export at 1284×2778 with navy background + centered logo → `splash.png`

## app.json configuration (already set)

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#042C53"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#042C53"
      }
    }
  }
}
```

## Quick placeholder (for development only)

If you just need something to test with, run this from the `frontend` directory:

```bash
# Creates a simple navy square with "JTB" text as a placeholder icon
node -e "
const { createCanvas } = require('canvas');
const fs = require('fs');
const canvas = createCanvas(1024, 1024);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#042C53';
ctx.fillRect(0, 0, 1024, 1024);
ctx.fillStyle = '#85B7EB';
ctx.font = 'bold 280px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('JTB', 512, 512);
fs.writeFileSync('assets/icon.png', canvas.toBuffer('image/png'));
console.log('Placeholder icon.png created');
"
```
