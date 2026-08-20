"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input, Select } from "@/components/ui/Field";
import {
  DocumentStatusBadge,
  ProcessingJobStatusBadge,
} from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ProcessingProgress } from "@/components/processing/ProcessingProgress";
import { StreamStatusPill } from "@/components/processing/StreamStatusPill";
import { ActivityIcon, SearchIcon } from "@/components/ui/icons";
import { useProcessingStream } from "@/lib/hooks/useProcessingStream";
import { useI18n } from "@/lib/i18n/context";
import { PROCESSING_JOB_STATUSES } from "@/lib/types";
import type {
  ProcessingJob,
  ProcessingJobStatus,
  ProcessingSummary,
} from "@/lib/types";

interface ProcessingViewProps {
  jobs: ProcessingJob[];
  summary: ProcessingSummary;
}

export function ProcessingView({ jobs, summary }: ProcessingViewProps) {
  const router = useRouter();
  const { d, f, p, dateTime } = useI18n();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const active = jobs.some(
    (job) => job.status === "PENDING" || job.status === "QUEUED" || job.status === "RUNNING",
  );

  /**
   * The table is server-rendered, so a streamed event is handled by re-reading
   * the page rather than patching rows in place. That keeps one source of truth
   * and means a missed event self-corrects on the next one.
   */
  const refresh = useCallback(() => router.refresh(), [router]);

  const streamStatus = useProcessingStream({
    onEvent: refresh,
    onResync: refresh,
  });

  const statusOptions = useMemo(
    () => [
      { value: "all", label: d.processing.allStates },
      ...PROCESSING_JOB_STATUSES.map((status) => ({
        value: status,
        label: d.status.job[status],
      })),
    ],
    [d],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return jobs.filter((job) => {
      if (status !== "all" && job.status !== status) return false;
      if (!needle) return true;
      return [job.document?.originalFileName, job.candidateName].some((field) =>
        (field ?? "").toLowerCase().includes(needle),
      );
    });
  }, [jobs, search, status]);

  const columns: Column<ProcessingJob>[] = [
    {
      key: "document",
      header: d.processing.columnDocument,
      render: (job) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">
            {job.document?.originalFileName ?? d.dashboard.document}
          </p>
          {job.candidateId ? (
            <Link
              href={`/candidates/${job.candidateId}`}
              className="truncate text-[12.5px] text-ink-muted hover:text-brand"
            >
              {job.candidateName}
            </Link>
          ) : (
            <span className="text-[12.5px] text-ink-subtle">
              {d.processing.notLinked}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "documentStatus",
      header: d.processing.columnDocument,
      hideBelow: "lg",
      render: (job) =>
        job.document ? (
          <DocumentStatusBadge status={job.document.status} />
        ) : (
          <span className="text-ink-subtle">{d.tables.empty}</span>
        ),
    },
    {
      key: "progress",
      header: d.processing.columnProgress,
      hideBelow: "md",
      className: "w-40",
      render: (job) => (
        <ProgressBar
          value={job.progress}
          tone={job.status === "FAILED" ? "critical" : "brand"}
          label={`${job.document?.originalFileName ?? d.dashboard.document} progress`}
        />
      ),
    },
    {
      key: "attempts",
      header: d.processing.columnAttempts,
      align: "right",
      hideBelow: "xl",
      render: (job) => (
        <span className="tabular-nums text-ink-muted">{job.attempts}</span>
      ),
    },
    {
      key: "updated",
      header: d.processing.columnUpdated,
      align: "right",
      hideBelow: "xl",
      render: (job) => (
        <span className="whitespace-nowrap text-ink-muted">
          {dateTime(job.updatedAt)}
        </span>
      ),
    },
    {
      key: "status",
      header: d.processing.columnState,
      align: "right",
      render: (job) => (
        <div className="flex flex-col items-end gap-1">
          <ProcessingJobStatusBadge status={job.status} />
          {job.errorMessage ? (
            <span className="max-w-56 text-right text-[11.5px] leading-snug text-critical">
              {job.errorMessage}
            </span>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4">
        <Card>
          <CardHeader
            title={d.processing.pipeline}
            description={p(d.processing.ingested, summary.total)}
            action={<StreamStatusPill status={streamStatus} />}
          />
          <CardBody>
            <ProcessingProgress summary={summary} />
          </CardBody>
        </Card>

      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="search"
          placeholder={d.processing.searchPlaceholder}
          value={search}
          aria-label={d.processing.searchLabel}
          leading={<SearchIcon className="size-4" />}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="sm:max-w-xs sm:flex-1"
        />
        <Select
          aria-label={d.processing.filterState}
          value={status}
          options={statusOptions}
          onChange={(event) => setStatus(event.target.value as ProcessingJobStatus | "all")}
          className="sm:w-44"
        />
        <p className="text-[12.5px] text-ink-muted sm:ml-auto">
          {f(d.processing.shownOfTotal, {
            shown: filtered.length,
            total: jobs.length,
          })}
          {active ? d.processing.workInProgress : ""}
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(job) => job.id}
        caption={d.processing.caption}
        empty={
          <EmptyState
            icon={<ActivityIcon className="size-5" />}
            title={
              jobs.length === 0
                ? d.processing.queueEmpty
                : d.processing.noMatches
            }
            description={
              jobs.length === 0
                ? d.processing.queueEmptyHint
                : d.processing.noMatchesHint
            }
          />
        }
      />

      <p className="text-[12px] leading-relaxed text-ink-subtle">
        {d.processing.retryNote}
      </p>
    </div>
  );
}
