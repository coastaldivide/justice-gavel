module.exports = {
  loadAsync: jest.fn().mockResolvedValue(true),
  isLoaded: jest.fn().mockReturnValue(true),
  requestCalendarPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getCalendarsAsync: jest.fn().mockResolvedValue([{ id: '1', isPrimary: true }]),
  createEventAsync: jest.fn().mockResolvedValue('event123'),
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ name: 'test.pdf', uri: 'file://test.pdf', size: 1024 }] }),
  printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file://output.pdf' }),
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue({}),
  EntityTypes: { EVENT: 'event' },
  default: {
    loadAsync: jest.fn().mockResolvedValue(true),
  },
};
