const expoConfig = require("eslint-config-expo/flat");

module.exports = [
  ...expoConfig,
  { ignores: ["node_modules/**", ".expo/**", "dist/**", "android/**", "ios/**"] },
  {
    // Jest globals exist in the setup file and the suites, and nowhere else —
    // scoping them here keeps `jest` undefined in app code, where a stray
    // reference would be a real bug.
    files: ["jest.setup.js", "__tests__/**/*.ts"],
    languageOptions: {
      globals: {
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
  },
];
