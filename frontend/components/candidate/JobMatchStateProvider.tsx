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
  getJobMatchReadinessAction,
  runJobMatchesAction,
  type JobMatchFailure,
  type JobMatchReadiness,
} from "@/app/(candidate)/actions";
import {
  clearCachedJobMatchResult,
  getCachedJobMatchResult,
  patchJobMatchResult,
  setCachedJobMatchResult,
} from "@/lib/candidate/job-match-cache";
import type { ApplicationStatus, JobMatchResult } from "@/lib/types";

interface JobMatchState {
  cacheKey: string;
  result: JobMatchResult | null;
  failure: JobMatchFailure | null;
  pending: boolean;
  readiness: JobMatchReadiness | null;
  readinessPending: boolean;
  readinessFailure: boolean;
  run: () => Promise<void>;
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
  const [readiness, setReadiness] = useState<JobMatchReadiness | null>(null);
  const [readinessPending, setReadinessPending] = useState(true);
  const [readinessFailure, setReadinessFailure] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    let active = true;

    getJobMatchReadinessAction()
      .then((response) => {
        if (!active) return;
        if (response.ok) {
          setReadiness(response.data);
          setReadinessFailure(false);
        } else {
          setReadinessFailure(true);
        }
      })
      .catch(() => {
        if (active) setReadinessFailure(true);
      })
      .finally(() => {
        if (active) setReadinessPending(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (pending) return;

    const version = requestVersion.current + 1;
    requestVersion.current = version;
    setFailure(null);
    setPending(true);

    try {
      const response = await runJobMatchesAction();
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
  }, [cacheKey, pending]);

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

  const value = useMemo<JobMatchState>(
    () => ({
      cacheKey,
      result,
      failure,
      pending,
      readiness,
      readinessPending,
      readinessFailure,
      run,
      clear,
      patchSaved,
      patchApplicationState,
    }),
    [
      cacheKey,
      clear,
      failure,
      patchApplicationState,
      patchSaved,
      pending,
      readiness,
      readinessFailure,
      readinessPending,
      result,
      run,
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
