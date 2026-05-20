const mockApi = {
  get:    jest.fn().mockResolvedValue({ data: {} }),
  post:   jest.fn().mockResolvedValue({ data: {} }),
  put:    jest.fn().mockResolvedValue({ data: {} }),
  delete: jest.fn().mockResolvedValue({ data: {} }),
  defaults: { headers: { common: {} } },
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  create: function() { return mockApi; },
};
module.exports = mockApi;
module.exports.default = mockApi;
