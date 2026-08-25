/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not `tailwind-merge`: NativeWind resolves conflicting classes
 * itself at compile time, and pulling in a merge library to solve a problem
 * the compiler already handles would cost bundle size for nothing.
 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}
