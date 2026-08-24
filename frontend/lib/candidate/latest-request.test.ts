import { describe, expect, it } from "vitest";
import {
  createLatestRequestGate,
  runLatest,
} from "@/lib/candidate/latest-request";

/**
 * The out-of-order answer.
 *
 * These are written as the failure they prevent rather than as unit
 * assertions about a counter: a reader opens job A, then job B, A's server is
 * slower, and the panel ends up showing A's description under B's title with
 * nothing logged anywhere. Every test below sets up exactly that ordering.
 */

/** A promise a test resolves by hand, so the ordering is not a race. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("only the newest answer wins", () => {
  it("keeps B when A finishes last", async () => {
    const gate = createLatestRequestGate();
    const a = deferred<string>();
    const b = deferred<string>();

    const first = runLatest(gate, () => a.promise);
    const second = runLatest(gate, () => b.promise);

    // B answers first, then the slower A arrives.
    b.resolve("job B");
    a.resolve("job A");

    expect(await second).toEqual({ stale: false, ok: true, value: "job B" });
    // A is not an error and not a value — it is simply no longer the answer
    // anyone is waiting for, so the caller writes nothing.
    expect(await first).toEqual({ stale: true });
  });

  it("keeps B even when the superseded request fails", async () => {
    const gate = createLatestRequestGate();
    const a = deferred<string>();
    const b = deferred<string>();

    const first = runLatest(gate, () => a.promise);
    const second = runLatest(gate, () => b.promise);

    b.resolve("job B");
    a.reject(new Error("network"));

    expect(await second).toEqual({ stale: false, ok: true, value: "job B" });
    // Reported as stale, NOT as a failure: flashing "could not load" over the
    // job they actually opened would be a worse bug than the one being fixed.
    expect(await first).toEqual({ stale: true });
  });

  it("reports a genuine failure of the current request", async () => {
    const gate = createLatestRequestGate();
    const error = new Error("boom");
    const outcome = await runLatest(gate, () => Promise.reject(error));
    expect(outcome).toEqual({ stale: false, ok: false, error });
  });

  it("survives three overlapping requests", async () => {
    const gate = createLatestRequestGate();
    const one = deferred<number>();
    const two = deferred<number>();
    const three = deferred<number>();

    const first = runLatest(gate, () => one.promise);
    const second = runLatest(gate, () => two.promise);
    const third = runLatest(gate, () => three.promise);

    // Answers arrive in the worst possible order.
    two.resolve(2);
    three.resolve(3);
    one.resolve(1);

    expect(await third).toEqual({ stale: false, ok: true, value: 3 });
    expect(await first).toEqual({ stale: true });
    expect(await second).toEqual({ stale: true });
  });

  it("discards everything outstanding when the panel closes", async () => {
    const gate = createLatestRequestGate();
    const a = deferred<string>();
    const pending = runLatest(gate, () => a.promise);

    gate.cancel();
    a.resolve("job A");

    expect(await pending).toEqual({ stale: true });
  });

  it("cannot make a cancelled request current again", async () => {
    // A counter that only moves forward is what guarantees this. A reset to
    // zero would let a token issued before the cancel match a later one.
    const gate = createLatestRequestGate();
    const a = deferred<string>();
    const first = runLatest(gate, () => a.promise);
    gate.cancel();

    const b = deferred<string>();
    const second = runLatest(gate, () => b.promise);
    b.resolve("job B");
    a.resolve("job A");

    expect(await second).toEqual({ stale: false, ok: true, value: "job B" });
    expect(await first).toEqual({ stale: true });
  });

  it("lets a lone request through", async () => {
    const gate = createLatestRequestGate();
    expect(await runLatest(gate, () => Promise.resolve("only"))).toEqual({
      stale: false,
      ok: true,
      value: "only",
    });
  });
});
