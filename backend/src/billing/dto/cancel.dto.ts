/**
 * Cancellation takes NO input: the subject is the authenticated caller and
 * the semantics are fixed (cancel at period end). The empty whitelist means
 * any field a client does send — a smuggled userId above all — dies in
 * validation with 400, exactly like every other billing route.
 */
export class CancelDto {}
