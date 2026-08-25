import { ScrollView, View } from "react-native";
import { AmbientGlow } from "@/components/navigation/GridBackground";
import { Body, Stat, Title } from "@/components/ui/index";
import { useSessionUser } from "@/lib/auth/context";
import { format, useI18n } from "@/lib/i18n/index";
import { useRecruiterDashboard } from "@/features/recruiter/queries";

/**
 * The recruiter's home.
 *
 * Metrics come from the organization's own stats endpoint and nothing is
 * derived: a figure the server did not send renders as an em dash rather
 * than zero, because "no open vacancies" and "could not load" are different
 * facts.
 */
export default function RecruiterHomeScreen() {
  const { d } = useI18n();
  const user = useSessionUser();
  const dashboard = useRecruiterDashboard();

  const show = (value: number | undefined) =>
    value === undefined ? "—" : String(value);
  const stats = dashboard.data;

  return (
    <ScrollView contentContainerClassName="px-4 pb-8 pt-4 gap-5" showsVerticalScrollIndicator={false}>
      <View className="overflow-hidden rounded-card border border-line bg-surface-raised p-5">
        <AmbientGlow />
        <View className="gap-2">
          <Title>
            {format(d.dashboard.greeting, {
              name: user.fullName.split(" ")[0] || user.fullName,
            })}
          </Title>
          <Body>{d.dashboard.recruiterSubtitle}</Body>
        </View>
      </View>

      <View className="flex-row gap-3">
        <Stat label={d.dashboard.openVacancies} value={show(stats?.openVacancies)} />
        <Stat label={d.dashboard.newApplications} value={show(stats?.applications)} />
        <Stat label={d.dashboard.toReview} value={show(stats?.candidates)} />
      </View>
    </ScrollView>
  );
}
