import { ScrollView, View } from "react-native";
import { AiCard, Body, Chip, SectionTitle } from "@/components/ui/index";
import { PLANNED_SOURCES } from "@/lib/billing/plans";
import { useI18n } from "@/lib/i18n/index";

/**
 * External candidate sourcing — a roadmap screen, not a feature.
 *
 * There is deliberately no search field: an input that accepts a query and
 * does nothing is worse than no input. The flow is described, the intended
 * sources are named as planned, and nothing claims to work.
 */
export default function ExternalSearchScreen() {
  const { d } = useI18n();

  return (
    <ScrollView contentContainerClassName="px-4 pb-8 pt-4" showsVerticalScrollIndicator={false}>
      <AiCard>
        <SectionTitle className="text-ai-ink">{d.external.comingSoonTitle}</SectionTitle>
        <Body className="mt-2">{d.external.comingSoonHint}</Body>
        <View className="mt-4 gap-2 border-t border-ai-line pt-3">
          <Body className="text-[12px] font-semibold uppercase">{d.plans.plannedSources}</Body>
          <View className="flex-row flex-wrap gap-1.5">
            {PLANNED_SOURCES.map((source) => (
              <Chip key={source} label={`${source} · ${d.plans.planned}`} />
            ))}
          </View>
          <Body className="text-[12px]">{d.plans.plannedSourcesNote}</Body>
        </View>
      </AiCard>
    </ScrollView>
  );
}
