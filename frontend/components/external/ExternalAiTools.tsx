"use client";

import { useState } from "react";
import { AiToolTabs, type AiTool } from "@/components/ai/AiToolTabs";
import { ExternalWhyMatch } from "@/components/external/ExternalWhyMatch";
import { ExternalCoverLetter } from "@/components/external/ExternalCoverLetter";
import { ExternalInterviewPrep } from "@/components/external/ExternalInterviewPrep";
import { ExternalMatchBreakdown } from "@/components/external/ExternalMatchBreakdown";
import { SparkIcon } from "@/components/ui/icons";
import { useI18n } from "@/lib/i18n/context";

/**
 * The MAX AI tools for one external job, in one place.
 *
 * ## Why a strip and not three stacked panels
 *
 * Three generated documents in a drawer is a scroll nobody reaches the bottom
 * of, and it buries the job's own facts under prose about them. Each tool
 * answers a different question and a reader wants one at a time, so one is
 * shown at a time.
 *
 * ## Adding a tool is one array entry
 *
 * Advanced Match Breakdown was added as exactly that: one `{ id, label, panel }`
 * below, with no change to the strip, the layout, the drawer or any existing
 * panel. A fifth would cost the same. Nothing inert is ever listed here — a
 * "coming soon" tab is clutter that teaches a reader to ignore the strip.
 *
 * ## Selecting a tool generates nothing
 *
 * This component holds no request. Each panel starts work only when its own
 * button is pressed, so switching tabs — and opening this drawer at all — is
 * free. That is what makes it safe to put paid model calls behind a strip a
 * reader will click around in.
 *
 * ## Every tool is MAX
 *
 * All three inherit `EXTERNAL_AI_SEARCH` and no new capability is invented.
 * In practice a reader who can see this drawer already holds it, because the
 * whole external product is gated; each panel still handles a plan refusal,
 * because the backend is the authority and a plan can lapse between opening a
 * page and pressing a button.
 */
export function ExternalAiTools({ externalJobId }: { externalJobId: string }) {
  const { d } = useI18n();
  const [activeId, setActiveId] = useState("why-match");

  const tools: AiTool[] = [
    {
      id: "why-match",
      label: d.externalJobs.whyMatchTitle,
      panel: <ExternalWhyMatch externalJobId={externalJobId} />,
    },
    {
      id: "cover-letter",
      label: d.externalJobs.coverLetterTab,
      panel: <ExternalCoverLetter externalJobId={externalJobId} />,
    },
    {
      id: "interview-prep",
      label: d.externalJobs.interviewPrepTab,
      panel: <ExternalInterviewPrep externalJobId={externalJobId} />,
    },
    {
      id: "match-breakdown",
      label: d.externalJobs.matchBreakdownTab,
      panel: <ExternalMatchBreakdown externalJobId={externalJobId} />,
    },
  ];

  return (
    <section
      aria-labelledby={`ai-tools-${externalJobId}`}
      className="flex flex-col gap-3 border-t border-line pt-4"
    >
      <h3
        id={`ai-tools-${externalJobId}`}
        className="flex items-center gap-2 text-[13px] font-semibold text-ink"
      >
        <SparkIcon className="size-3.5 text-brand" aria-hidden="true" />
        {d.externalJobs.aiToolsTitle}
      </h3>

      <AiToolTabs
        tools={tools}
        activeId={activeId}
        onSelect={setActiveId}
        // Namespaced by job, so reopening the drawer on another job cannot
        // collide with ids left in the document from the previous one.
        idPrefix={`ai-tools-${externalJobId}`}
      />
    </section>
  );
}
