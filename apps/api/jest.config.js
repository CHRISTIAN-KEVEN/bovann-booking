/**
 * Two projects:
 *  - unit:        fast, no I/O (src/**\/*.spec.ts)
 *  - integration: real MySQL, DATABASE_URL_TEST must point at a disposable database
 *                 (test/**\/*.int-spec.ts)
 */
const tsJest = ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }];

/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.int-spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
    },
  ],
};
