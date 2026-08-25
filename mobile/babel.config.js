/**
 * Babel for Expo + NativeWind.
 *
 * `jsxImportSource: "nativewind"` is what lets `className` exist on React
 * Native components at all — it swaps the JSX factory for NativeWind's, which
 * compiles class strings into styles. Without it every `className` prop is
 * silently ignored, which looks like "my styles do nothing" rather than an
 * error, so it is the single most important line in this file.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
