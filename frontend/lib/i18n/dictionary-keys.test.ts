import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/lib/i18n/locales";

/**
 * A duplicate key in a dictionary is INVISIBLE at runtime.
 *
 * `{ openFile: "Open", openFile: "Open {name}" }` is a valid object — the last
 * one silently wins — so every other i18n test in this file passes while one
 * of the two call sites renders the wrong string. TypeScript does catch it
 * (TS1117), but only when someone runs the typecheck; this test makes it fail
 * in the suite, in the file where it happened, with the key named.
 *
 * It reads the SOURCE rather than the imported object for exactly that reason:
 * by the time the module is evaluated the evidence is gone.
 */

const DICTIONARY_DIR = join(process.cwd(), "lib/i18n/dictionaries");

/**
 * Removes comments and string literals so brace counting is not confused by
 * `"{count} applications"` or by a `//` inside a URL. Replaces each with a
 * blank of no structural meaning rather than deleting it, so a stripped line
 * still cannot accidentally join the next one.
 */
function stripStringsAndComments(source: string): string {
  let out = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        // Newlines are kept so reported line numbers stay truthful.
        if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") index += 1;
        else if (source[index] === "\n") out += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Every `key:` declared directly inside each object literal, with its line. */
function duplicateKeys(source: string): string[] {
  const stripped = stripStringsAndComments(source);
  const scopes: Array<Map<string, number>> = [new Map()];
  const duplicates: string[] = [];

  let line = 1;
  let index = 0;
  while (index < stripped.length) {
    const char = stripped[index];

    if (char === "\n") {
      line += 1;
      index += 1;
      continue;
    }
    if (char === "{") {
      scopes.push(new Map());
      index += 1;
      continue;
    }
    if (char === "}") {
      if (scopes.length > 1) scopes.pop();
      index += 1;
      continue;
    }

    // A property name is an identifier followed by a colon that is not `?:`,
    // `::` or part of a ternary — inside a dictionary literal that is enough.
    const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(stripped.slice(index));
    if (match && /[\n{,]\s*$/.test(stripped.slice(0, index))) {
      const key = match[1];
      const scope = scopes[scopes.length - 1];
      const seen = scope.get(key);
      if (seen !== undefined) {
        duplicates.push(`${key} (lines ${seen} and ${line})`);
      } else {
        scope.set(key, line);
      }
      index += match[0].length;
      continue;
    }

    index += 1;
  }

  return duplicates;
}

describe("dictionary sources", () => {
  it.each([...LOCALES])("%s declares every key exactly once", (locale) => {
    const source = readFileSync(join(DICTIONARY_DIR, `${locale}.ts`), "utf8");
    expect(duplicateKeys(source)).toEqual([]);
  });

  it("detects a duplicate when there is one", () => {
    // Guards the guard: a scanner that never fires would pass silently forever.
    const withDuplicate = `
      const d = {
        candidates: {
          openFile: "Open",
          openOriginalLink: "Open original",
          openFile: "Open {name}",
        },
      };
    `;
    expect(duplicateKeys(withDuplicate)).toHaveLength(1);
    expect(duplicateKeys(withDuplicate)[0]).toContain("openFile");
  });

  it("is not fooled by braces inside translated strings", () => {
    const withPlaceholders = `
      const d = {
        a: { label: "Attempt {number}", other: "{count} applications" },
        b: { label: "Attempt {number}" },
      };
    `;
    expect(duplicateKeys(withPlaceholders)).toEqual([]);
  });
});
