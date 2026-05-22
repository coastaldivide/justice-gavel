module.exports = {
  default: {
    fetch: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }),
    addEventListener: jest.fn().mockReturnValue(jest.fn()),
    useNetInfo: jest.fn().mockReturnValue({ isConnected: true }),
  },
  NetInfoStateType: {},
};
