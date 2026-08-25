const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

/**
 * Metro, wrapped so NativeWind can compile `global.css` through Tailwind and
 * hand the result to the runtime. `input` must point at the same stylesheet
 * the root layout imports, or classes resolve to nothing at runtime.
 */
const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
