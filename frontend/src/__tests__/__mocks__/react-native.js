const Alert = { alert: jest.fn(), prompt: jest.fn() };
const Platform = { OS: 'ios', select: (o) => o.ios ?? o.default };
const Linking = { openURL: jest.fn() };
const Clipboard = { setString: jest.fn() };
const Share = { share: jest.fn().mockResolvedValue({ action: 'sharedAction' }) };
const Haptics = { impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium', Heavy: 'Heavy' } };
const Animated = {
  Value: class { constructor(v) { this._v=v; } },
  timing: () => ({ start: (cb) => cb && cb() }),
  spring: () => ({ start: (cb) => cb && cb() }),
  View: 'Animated.View',
  Text: 'Animated.Text',
};
const StyleSheet = { create: (s) => s, flatten: (s) => s };
const View = 'View';
const Text = 'Text';
const TextInput = 'TextInput';
const TouchableOpacity = 'TouchableOpacity';
const ScrollView = 'ScrollView';
const FlatList = 'FlatList';
const ActivityIndicator = 'ActivityIndicator';
const Switch = 'Switch';
const KeyboardAvoidingView = 'KeyboardAvoidingView';
const RefreshControl = 'RefreshControl';
const Image = 'Image';
const Modal = 'Modal';
const Pressable = 'Pressable';
const SafeAreaView = 'SafeAreaView';
const StatusBar = { setBarStyle: jest.fn() };
const Keyboard = { dismiss: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })) };
const useColorScheme = () => 'dark';
const useWindowDimensions = () => ({ width: 390, height: 844 });
const Dimensions = { get: () => ({ width: 390, height: 844 }) };
const NetInfo = { addEventListener: jest.fn(() => jest.fn()), fetch: jest.fn().mockResolvedValue({ isConnected: true }) };

module.exports = {
  Alert, Platform, Linking, Clipboard, Share, Animated, StyleSheet,
  View, Text, TextInput, TouchableOpacity, ScrollView, FlatList,
  ActivityIndicator, Switch, KeyboardAvoidingView, RefreshControl,
  Image, Modal, Pressable, SafeAreaView, StatusBar, Keyboard,
  useColorScheme, useWindowDimensions, Dimensions,
};
