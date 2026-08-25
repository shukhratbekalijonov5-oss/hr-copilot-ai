/** @type {import('tailwindcss').Config} */
module.exports = {
  // Every path that can contain a className. Missing one means its classes
  // are never compiled and the screen renders unstyled.
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./features/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      /*
       * The web product's tokens, as CSS variables so one class works in both
       * themes. `rgb(var(--x) / <alpha-value>)` is what lets `bg-surface/60`
       * and `border-brand/30` keep working — a plain hex variable cannot take
       * an alpha modifier, which is why the values are stored as raw channels.
       */
      colors: {
        canvas: "rgb(var(--canvas) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-raised": "rgb(var(--surface-raised) / <alpha-value>)",
        "surface-muted": "rgb(var(--surface-muted) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        "line-strong": "rgb(var(--line-strong) / <alpha-value>)",

        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        "ink-subtle": "rgb(var(--ink-subtle) / <alpha-value>)",

        brand: "rgb(var(--brand) / <alpha-value>)",
        "brand-hover": "rgb(var(--brand-hover) / <alpha-value>)",
        "brand-soft": "rgb(var(--brand-soft) / <alpha-value>)",
        "brand-ink": "rgb(var(--brand-ink) / <alpha-value>)",

        positive: "rgb(var(--positive) / <alpha-value>)",
        "positive-soft": "rgb(var(--positive-soft) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-soft": "rgb(var(--warning-soft) / <alpha-value>)",
        critical: "rgb(var(--critical) / <alpha-value>)",
        "critical-soft": "rgb(var(--critical-soft) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        "info-soft": "rgb(var(--info-soft) / <alpha-value>)",

        "ai-tint": "rgb(var(--ai-tint) / <alpha-value>)",
        "ai-line": "rgb(var(--ai-line) / <alpha-value>)",
        "ai-ink": "rgb(var(--ai-ink) / <alpha-value>)",
        grid: "rgb(var(--grid) / <alpha-value>)",
      },
      borderRadius: {
        card: "14px",
        sheet: "20px",
        control: "10px",
      },
    },
  },
  plugins: [],
};
