import { Text, View } from "react-native";
import { CheckIcon } from "@/components/navigation/icons";
import { useI18n } from "@/lib/i18n/index";
import { timelineFor, type TimelineNodeState } from "@/lib/candidate/status";
import { cn } from "@/lib/utils";
import type { ApplicationStatus } from "@/types";

/**
 * The four-node stage line for one application.
 *
 * States differ by SHAPE as well as tone — a tick for done, a ring for
 * current, a dot for upcoming, a hollow muted node for a closed path — and
 * the stage name is printed under every node. Colour alone never carries it.
 */
export function ApplicationTimeline({ status }: { status: ApplicationStatus }) {
  const { d } = useI18n();
  const nodes = timelineFor(status);

  const label: Record<string, string> = {
    applied: d.applications.applied,
    review: d.applications.review,
    interview: d.applications.interview,
    decision: d.applications.decision,
  };

  return (
    <View className="flex-row">
      {nodes.map((node, index) => (
        <View key={node.id} className="min-w-0 flex-1 items-center gap-1.5">
          <View className="w-full flex-row items-center">
            <View
              className={cn(
                "h-px flex-1",
                index === 0 ? "bg-transparent" : connector(node.state),
              )}
            />
            <Node state={node.state} />
            <View
              className={cn(
                "h-px flex-1",
                index === nodes.length - 1
                  ? "bg-transparent"
                  : connector(nodes[index + 1].state),
              )}
            />
          </View>
          <Text
            numberOfLines={1}
            className={cn(
              "text-[10.5px]",
              node.state === "current" ? "font-semibold text-ink" : "text-ink-muted",
            )}
          >
            {label[node.id]}
          </Text>
        </View>
      ))}
    </View>
  );
}

function connector(state: TimelineNodeState): string {
  if (state === "done" || state === "current") return "bg-brand/40";
  return "bg-line";
}

function Node({ state }: { state: TimelineNodeState }) {
  if (state === "done") {
    return (
      <View className="size-5 items-center justify-center rounded-full border border-brand/30 bg-brand-soft">
        <CheckIcon size={11} color="#4a3ac9" />
      </View>
    );
  }
  if (state === "current") {
    return (
      <View className="size-5 items-center justify-center rounded-full border-2 border-brand bg-surface">
        <View className="size-1.5 rounded-full bg-brand" />
      </View>
    );
  }
  if (state === "closed") {
    return <View className="size-5 rounded-full border border-line-strong bg-surface-muted" />;
  }
  return (
    <View className="size-5 items-center justify-center rounded-full border border-line bg-surface">
      <View className="size-1 rounded-full bg-line-strong" />
    </View>
  );
}
