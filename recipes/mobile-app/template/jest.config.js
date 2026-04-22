/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // pnpm の .pnpm バーチャルストア配下も含めて @react-native 系を transform 対象にする
  transformIgnorePatterns: [
    // pnpm バーチャルストアの物理パス
    'node_modules/\\.pnpm/(?!.*node_modules/(react-native|@react-native|@react-native-community|expo|@expo|@unimodules|react-navigation|@react-navigation|@testing-library))',
    // 通常の node_modules
    'node_modules/(?!(react-native|@react-native|@react-native-community|expo|@expo|@unimodules|react-navigation|@react-navigation|@testing-library/react-native)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
};
