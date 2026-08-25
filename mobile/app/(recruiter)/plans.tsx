import { ScrollView, View } from "react-native";
import { AiCard, Badge, Body, Card, Chip, SectionTitle, Title } from "@/components/ui/index";
import { PLANNED_SOURCES, RECRUITER_TIERS } from "@/lib/billing/plans";
import { useI18n } from "@/lib/i18n/index";

/**
 * Where HR Copilot for recruiters is going — and nothing more.
 *
 * Every claim is marked: FREE lists what a recruiter can do today, PRO and
 * MAX wear "Coming soon", carry no price, and offer no control that could
 * start a purchase. There is no recruiter billing anywhere in this app, and
 * this file imports none of the candidate checkout code.
 */
export default function RecruiterPlansScreen() {
  const { d } = useI18n();

  return (
    <ScrollView contentContainerClassName="px-4 pb-8 pt-4 gap-4" showsVerticalScrollIndicator={false}>
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <Title className="text-[22px]">{d.plans.recruiterTitle}</Title>
          <Badge label={d.plans.comingSoon} tone="brand" />
        </View>
        <Body>{d.plans.recruiterSubtitle}</Body>
      </View>

      {/* Stated BEFORE the tiers: nobody should hunt for a buy button first. */}
      <Card className="bg-surface-muted">
        <Body>{d.plans.recruiterNotice}</Body>
      </Card>

      {RECRUITER_TIERS.map((tier) => (
        <Card key={tier.id} className="gap-2">
          <View className="flex-row items-center justify-between">
            <SectionTitle>
              {d.plans[tier.id.toLowerCase() as "free" | "pro" | "max"]}
            </SectionTitle>
            <Badge
              label={tier.availability === "planned" ? d.plans.comingSoon : d.plans.currentPlan}
              tone={tier.availability === "planned" ? "brand" : "neutral"}
            />
          </View>
          {/* No approved price exists for the paid tiers, so no number is shown. */}
          {tier.monthlyUsd === null ? (
            <Body>{d.plans.pricingComingSoon}</Body>
          ) : (
            <Title className="text-[28px]">{`$${tier.monthlyUsd}`}</Title>
          )}
        </Card>
      ))}

      <AiCard>
        <SectionTitle className="text-ai-ink">{d.external.comingSoonTitle}</SectionTitle>
        <Body className="mt-2">{d.external.comingSoonHint}</Body>

        <View className="mt-4 gap-2 border-t border-ai-line pt-3">
          <Body className="text-[12px] font-semibold uppercase">{d.plans.plannedSources}</Body>
          <View className="flex-row flex-wrap gap-1.5">
            {PLANNED_SOURCES.map((source) => (
              // Name plus an explicit "Planned" on EVERY chip: a bare product
              // name beside an AI feature reads as an integration.
              <Chip key={source} label={`${source} · ${d.plans.planned}`} />
            ))}
          </View>
          <Body className="text-[12px]">{d.plans.plannedSourcesNote}</Body>
        </View>
      </AiCard>
    </ScrollView>
  );
}
