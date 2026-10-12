// These UI/unit tests do not need the legacy suite's network/database setup.
module.exports = {
  ...require('../jest.config.json'),
  rootDir: '..',
  setupFilesAfterEnv: [],
  testMatch: ['**/tests/persistentEditFieldsUI.test.ts', '**/tests/editorNodeExecution.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx', resolveJsonModule: true, target: 'ES2022' } }] },
};
