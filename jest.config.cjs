module.exports = {
  testEnvironment: 'jsdom',
  testMatch: [
    '**/src/**/*.test.ts',
    '**/src/**/*.test.tsx',
    '**/tests/**/*.test.cjs',
  ],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/test/styleMock.cjs',
  },
  setupFilesAfterEnv: ['<rootDir>/test/jest.setup.ts'],
  clearMocks: true,
};
