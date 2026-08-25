import { View } from "react-native";

/**
 * The page grid, in pure React Native views.
 *
 * ## Why views and not an image or SVG
 *
 * A 32px grid is just evenly spaced hairlines. Absolutely-positioned views
 * with a 1px edge render on the GPU with no decode step, no asset to ship
 * and no SVG parser — which matters because this sits behind every screen.
 * An image would also have to exist in two themes.
 *
 * ## It never participates in layout or touch
 *
 * `pointerEvents="none"` and absolute fill, so it can never intercept a tap
 * or change a measurement. The fade is a stack of increasingly opaque
 * overlays rather than a real gradient: React Native has no CSS gradient
 * without a library, and three flat layers are indistinguishable at 4%.
 */
const SPACING = 32;
const LINES = 40;

export function GridBackground() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute inset-0"
    >
      {Array.from({ length: LINES }, (_, index) => (
        <View
          key={`v-${index}`}
          className="absolute top-0 bottom-0 w-px bg-grid/[0.05]"
          style={{ left: index * SPACING }}
        />
      ))}
      {Array.from({ length: LINES }, (_, index) => (
        <View
          key={`h-${index}`}
          className="absolute left-0 right-0 h-px bg-grid/[0.05]"
          style={{ top: index * SPACING }}
        />
      ))}
    </View>
  );
}

/**
 * The ambient accent wash behind a hero.
 *
 * One soft rounded block at low opacity, blurred by being large and faint
 * rather than by an expensive blur filter — a real `blur` on Android is a
 * measurable frame cost for something nobody should consciously notice.
 */
export function AmbientGlow() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="absolute -left-24 -top-32 size-80 rounded-full bg-brand/10"
    />
  );
}
