const useNavigation = () => ({
  navigate: jest.fn(), goBack: jest.fn(), push: jest.fn(),
  reset: jest.fn(), setOptions: jest.fn(), replace: jest.fn(),
});
const useRoute = () => ({ params: {}, name: 'TestScreen' });
const NavigationContainer = ({ children }) => children;
const createNativeStackNavigator = () => ({
  Navigator: ({ children }) => children,
  Screen: () => null,
});
module.exports = { useNavigation, useRoute, NavigationContainer, createNativeStackNavigator };
