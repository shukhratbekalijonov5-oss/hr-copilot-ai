/**
 * Copying text, and admitting when it did not work.
 *
 * ## Why this is not two lines inline in a button
 *
 * `navigator.clipboard.writeText` fails in more ordinary situations than it
 * succeeds in some deployments: it is undefined outside a secure context,
 * rejects when the document is not focused, and is refused outright by
 * permissions policy in an embedded frame. A button that assumes it worked
 * shows "Copied" to somebody holding an empty clipboard — and they find out
 * when they paste an old address into a job application.
 *
 * So the result is a value the caller must handle, and the failure path has
 * its own message rather than silence.
 *
 * ## Why the API is injected
 *
 * Taking the clipboard as an argument is what lets the rule above be tested
 * at all: the interesting cases are "the API is missing" and "the API
 * rejects", neither of which a browser will produce on demand. A hook that
 * reached for the global directly would leave exactly those two paths
 * unexercised, which are the only two that matter.
 */

export interface ClipboardLike {
  writeText: (text: string) => Promise<void>;
}

export async function copyToClipboard(
  value: string,
  clipboard: ClipboardLike | undefined,
): Promise<boolean> {
  // Nothing to copy is not a success: reporting "Copied" for an empty string
  // would tell somebody their letter is on the clipboard when it is not.
  if (!value) return false;
  if (!clipboard || typeof clipboard.writeText !== "function") return false;

  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    // Denied by permissions policy, an unfocused document, or a browser that
    // simply refuses. None of these are worth a stack trace on screen — the
    // caller shows "could not copy" and the reader selects the text instead,
    // which is why the text is always rendered and never hidden behind this
    // button.
    return false;
  }
}

/**
 * The whole letter as one string, for the clipboard.
 *
 * Subject and body separated by a blank line, so what lands in an email is
 * laid out the way it was read. A subject with no body copies as nothing,
 * because a subject line alone is not the thing the button offered.
 */
export function coverLetterClipboardText(
  subject: string | null,
  content: string | null,
): string {
  if (!content) return "";
  return subject ? `${subject}\n\n${content}` : content;
}
