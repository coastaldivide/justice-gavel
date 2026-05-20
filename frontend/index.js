// index.js — App entry point for web (Expo SDK 51+)
// On native: this file is not used (expo uses the 'main' field in package.json)
// On web:    Metro requires this entry point when bundling for web
import '@expo/metro-runtime';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
