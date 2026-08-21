"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getCandidateEvidenceStateAction,
  runJobMatchesAction,
  type JobMatchFailure,
} from "@/app/(candidate)/actions";
import {
  clearCachedJobMatchResult,
  getCachedJobMatchResult,
  patchJobMatchResult,
  setCachedJobMatchResult,
} from "@/lib/candidate/job-match-cache";
import { isJobMatchStale } from "@/lib/candidate/job-match-freshness";
import type {
  ApplicationStatus,
  CandidateEvidenceState,
  JobMatchResult,
} from "@/lib/types";

interface JobMatchState {
  cacheKey: string;
  result: JobMatchResult | null;
  failure: JobMatchFailure | null;
  pending: boolean;
  evidence: CandidateEvidenceState | null;
  readinessPending: boolean;
  readinessFailure: boolean;
  /**
   * True when the displayed result describes an evidence set the candidate has
   * since changed. Such a result is never presented as the current analysis —
   * §"old match results must never masquerade as current".
   */
  stale: boolean;
  /** Ranks every eligible vacancy and shows page 1. */
  run: () => Promise<void>;
  /** Appends the next page of the SAME ranking. Never re-ranks. */
  loadMore: () => Promise<void>;
  loadingMore: boolean;
  clear: () => void;
  patchSaved: (slug: string, saved: boolean) => void;
  patchApplicationState: (
    slug: string,
    applicationState: ApplicationStatus,
  ) => void;
}

const JobMatchStateContext = createContext<JobMatchState | null>(null);

export function JobMatchStateProvider({
  cacheKey,
  children,
}: {
  cacheKey: string;
  children: ReactNode;
}) {
  const [result, setResult] = useState<JobMatchResult | null>(() =>
    getCachedJobMatchResult(cacheKey),
  );
  const [failure, setFailure] = useState<JobMatchFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [evidence, setEvidence] = useState<CandidateEvidenceState | null>(null);
  const [readinessPending, setReadinessPending] = useState(true);
  const [readinessFailure, setReadinessFailure] = useState(false);
  const requestVersion = useRef(0);

  /**
   * Re-reads the evidence state from the backend.
   *
   * Called on mount and again after every run, so a deletion made in another
   * tab — or between opening this page and pressing the button — is reflected
   * rather than assumed away.
   */
  const refreshEvidence = useCallback(async () => {
    try {
      const response = await getCandidateEvidenceStateAction();
      if (response.ok) {
        setEvidence(response.data);
        setReadinessFailure(false);
        return response.data;
      }
      setReadinessFailure(true);
    } catch {
      setReadinessFailure(true);
    }
    return null;
  }, []);

  useEffect(() => {
    let active = true;

    // Wrapped in an async IIFE so nothing is set synchronously during the
    // effect — the state only moves once the backend has actually answered.
    void (async () => {
      await refreshEvidence();
      if (active) setReadinessPending(false);
    })();

    return () => {
      active = false;
    };
  }, [refreshEvidence]);

  const run = useCallback(async () => {
    if (pending) return;

    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setFailure(null);
    setPending(true);

    try {
      // `refresh` re-ranks: this is the candidate asking for a new analysis,
      // not a scroll.
      const response = await runJobMatchesAction({ page: 1, refresh: true });
      if (requestVersion.current !== version) return;

      if (response.ok) {
        setCachedJobMatchResult(cacheKey, response.data);
        setResult(response.data);
      } else {
        setFailure(response.reason);
      }
    } finally {
      if (requestVersion.current === version) setPending(false);
    }
    // The evidence set may have changed during the ~20s call; re-reading it
    // here is what lets the staleness check below notice.
    await refreshEvidence();
  }, [cacheKey, pending, refreshEvidence]);

  /**
   * Appends the next page of the ranking already on screen.
   *
   * Deliberately does NOT pass `refresh`: re-ranking between pages could move
   * a vacancy across a page boundary and show it twice, or drop it entirely.
   * The pages accumulate, so scrolling reveals more of one stable list.
   */
  const loadMore = useCallback(async () => {
    if (loadingMore || pending || !result?.hasMore) return;

    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const response = await runJobMatchesAction({ page: result.page + 1 });
      // A refresh started while this page was in flight wins: appending to a
      // ranking that no longer exists would interleave two different lists.
      if (requestVersion.current !== version) return;
      if (!response.ok) {
        setFailure(response.reason);
        return;
      }

      setResult((current) => {
        if (!current) return response.data;
        const next = {
          ...response.data,
          matches: [...current.matches, ...response.data.matches],
        };
        setCachedJobMatchResult(cacheKey, next);
        return next;
      });
    } finally {
      setLoadingMore(false);
    }
  }, [cacheKey, loadingMore, pending, result]);

  const clear = useCallback(() => {
    requestVersion.current += 1;
    clearCachedJobMatchResult(cacheKey);
    setResult(null);
    setFailure(null);
    setPending(false);
  }, [cacheKey]);

  const patchSaved = useCallback(
    (slug: string, saved: boolean) => {
      setResult((current) => {
        if (!current) return current;
        const next = patchJobMatchResult(current, slug, { saved });
        setCachedJobMatchResult(cacheKey, next);
        return next;
      });
    },
    [cacheKey],
  );

  const patchApplicationState = useCallback(
    (slug: string, applicationState: ApplicationStatus) => {
      setResult((current) => {
        if (!current) return current;
        const next = patchJobMatchResult(current, slug, { applicationState });
        setCachedJobMatchResult(cacheKey, next);
        return next;
      });
    },
    [cacheKey],
  );

  // The rule itself lives in job-match-freshness.ts, where it is tested.
  const stale = isJobMatchStale(result, evidence);

  const value = useMemo<JobMatchState>(
    () => ({
      cacheKey,
      result,
      failure,
      pending,
      evidence,
      readinessPending,
      readinessFailure,
      stale,
      run,
      loadMore,
      loadingMore,
      clear,
      patchSaved,
      patchApplicationState,
    }),
    [
      cacheKey,
      clear,
      evidence,
      failure,
      loadMore,
      loadingMore,
      patchApplicationState,
      patchSaved,
      pending,
      readinessFailure,
      readinessPending,
      result,
      run,
      stale,
    ],
  );

  return (
    <JobMatchStateContext.Provider value={value}>
      {children}
    </JobMatchStateContext.Provider>
  );
}

export function useJobMatchState(): JobMatchState {
  const value = useContext(JobMatchStateContext);
  if (!value) {
    throw new Error("useJobMatchState must be used inside JobMatchStateProvider.");
  }
  return value;
}

export function useOptionalJobMatchState(): JobMatchState | null {
  return useContext(JobMatchStateContext);
}
