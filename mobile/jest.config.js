/**
 * Jest for the app's PURE logic.
 *
 * ## Why not `jest-expo`
 *
 * jest-expo ships a custom environment that is incompatible with the jest
 * version this SDK resolves (its module mocker is missing an API the runtime
 * calls). Everything tested here — token storage, the navigation model, the
 * dictionaries — is plain TypeScript with no React Native rendering, so it
 * needs neither the RN preset nor a native environment.
 *
 * The consequence is stated rather than hidden: COMPONENT rendering is not
 * covered by this config. Adding it means resolving the jest-expo/jest
 * mismatch first, and doing it silently would leave a suite that looks like
 * it tests screens and does not.
 */
module.exports = {
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  transform: {
    "^.+\\.[jt]sx?$": [
      "babel-jest",
      {
        babelrc: false,
        configFile: false,
        presets: [
          ["@babel/preset-env", { targets: { node: "current" } }],
          "@babel/preset-typescript",
          ["@babel/preset-react", { runtime: "automatic" }],
        ],
      },
    ],
  },
};
