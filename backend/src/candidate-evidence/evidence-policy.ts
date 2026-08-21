/**
 * Stable error codes for the evidence lifecycle.
 *
 * The UI localizes on the CODE, never on the message — an English sentence
 * shown to a Korean or Uzbek reader is a bug, and a message reworded in a
 * later release must not silently change what the interface says.
 */

/**
 * The account has no files and no professional links, so an evidence-grounded
 * feature has nothing to be grounded in and refuses to run.
 *
 * Deliberately NOT the same condition as "cannot apply": applying requires a
 * resume, matching requires evidence of any kind. A candidate with one
 * portfolio link and no resume can use AI Job Match and still cannot apply,
 * and both of those are correct.
 */
export const NO_CANDIDATE_EVIDENCE = 'NO_CANDIDATE_EVIDENCE';
