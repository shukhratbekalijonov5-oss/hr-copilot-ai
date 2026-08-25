import { router, Slot } from "expo-router";
import { View } from "react-native";
import { AppHeader } from "@/components/navigation/AppHeader";
import { BottomSheet, SheetItem } from "@/components/navigation/BottomSheet";
import { GridBackground } from "@/components/navigation/GridBackground";
import { OfflineBanner } from "@/components/navigation/OfflineBanner";
import { TabBar } from "@/components/navigation/TabBar";
import {
  BookmarkIcon,
  BriefcaseIcon,
  CompareIcon,
  GlobeIcon,
  LockIcon,
  SearchIcon,
  SparkIcon,
  UsersIcon,
} from "@/components/navigation/icons";
import { Badge } from "@/components/ui/index";
import { useI18n } from "@/lib/i18n/index";
import { allows, requiredPlanFor } from "@/lib/auth/entitlements";
import { useAuth } from "@/lib/auth/context";
import { CANDIDATE_TABS, RECRUITER_TABS } from "@/lib/navigation/tabs";
import { useUiStore } from "@/stores/ui";
import { useThemeStore } from "@/stores/theme";
import { MoreSheet } from "@/components/navigation/MoreSheet";

/**
 * The shell both roles share: grid, header, content, tab bar, sheets.
 *
 * ## One shell, two navigation models
 *
 * The tab list and the domain sheet differ by role; everything else is
 * identical, which is what makes the two sides feel like one product. The
 * role comes from the caller (each route group renders its own), never from
 * a guess about the path.
 */
export function RoleShell({ role }: { role: "candidate" | "recruiter" }) {
  const { d } = useI18n();
  const { user } = useAuth();
  const openSheet = useUiStore((state) => state.openSheet);
  const closeSheet = useUiStore((state) => state.closeSheet);
  const resolved = useThemeStore((state) => state.resolved);

  const iconColor = resolved === "dark" ? "#a8b4c7" : "#6f6877";
  const tabs = role === "candidate" ? CANDIDATE_TABS : RECRUITER_TABS;
  const base = role === "candidate" ? "/(candidate)" : "/(recruiter)";

  function go(path: string) {
    closeSheet();
    router.navigate(`${base}${path}` as never);
  }

  return (
    <View className="flex-1 bg-canvas">
      <GridBackground />
      <AppHeader notificationsHref={`${base}/notifications`} />
      {/* One banner for the whole app, under the header, above every
          screen — so no screen has to remember to explain a dead network. */}
      <OfflineBanner />

      <View className="flex-1">
        <Slot />
      </View>

      <TabBar tabs={tabs} />

      {/* CANDIDATE — Career */}
      <BottomSheet
        visible={openSheet === "career"}
        title={d.sheets.career}
        description={d.sheets.careerHint}
        onClose={closeSheet}
      >
        <SheetItem
          icon={<SearchIcon size={18} color={iconColor} />}
          label={d.titles.normalJobSearch}
          description={d.sheets.normalJobSearchHint}
          onPress={() => go("/jobs")}
        />
        <SheetItem
          icon={<BookmarkIcon size={18} color={iconColor} />}
          label={d.titles.savedJobs}
          description={d.sheets.savedJobsHint}
          onPress={() => go("/saved-jobs")}
        />
        <SheetItem
          icon={<BriefcaseIcon size={18} color={iconColor} />}
          label={d.titles.myApplications}
          description={d.sheets.myApplicationsHint}
          onPress={() => go("/applications")}
        />
      </BottomSheet>

      {/* RECRUITER — Hiring */}
      <BottomSheet
        visible={openSheet === "hiring"}
        title={d.sheets.hiring}
        description={d.sheets.hiringHint}
        onClose={closeSheet}
      >
        <SheetItem
          icon={<BriefcaseIcon size={18} color={iconColor} />}
          label={d.titles.vacancies}
          description={d.sheets.vacanciesHint}
          onPress={() => go("/vacancies")}
        />
        <SheetItem
          icon={<UsersIcon size={18} color={iconColor} />}
          label={d.titles.candidates}
          description={d.sheets.candidatesHint}
          onPress={() => go("/candidates")}
        />
        <SheetItem
          icon={<CompareIcon size={18} color={iconColor} />}
          label={d.titles.compare}
          description={d.sheets.compareHint}
          onPress={() => go("/compare")}
        />
      </BottomSheet>

      {/* AI Search — different destinations per role, same shape. */}
      <BottomSheet
        visible={openSheet === "aiSearch"}
        title={d.sheets.aiSearch}
        description={d.sheets.aiSearchHint}
        onClose={closeSheet}
      >
        {role === "candidate" ? (
          <>
            <SheetItem
              icon={<SparkIcon size={18} color={iconColor} />}
              label={d.titles.internalAiJobs}
              description={d.sheets.internalAiJobsHint}
              badge={
                allows(user, "INTERNAL_AI_SEARCH") ? undefined : (
                  <Badge label={requiredPlanFor("INTERNAL_AI_SEARCH")} tone="brand" />
                )
              }
              onPress={() => go("/job-matches")}
            />
            <SheetItem
              icon={<GlobeIcon size={18} color={iconColor} />}
              label={d.titles.externalAiJobs}
              description={d.sheets.externalAiJobsHint}
              badge={
                allows(user, "EXTERNAL_AI_SEARCH") ? undefined : (
                  <Badge label={requiredPlanFor("EXTERNAL_AI_SEARCH")} tone="brand" />
                )
              }
              onPress={() => go("/external-jobs")}
            />
          </>
        ) : (
          <>
            <SheetItem
              icon={<SearchIcon size={18} color={iconColor} />}
              label={d.titles.internalAiSearch}
              description={d.sheets.internalSearchHint}
              onPress={() => go("/search")}
            />
            <SheetItem
              icon={<LockIcon size={18} color={iconColor} />}
              label={d.titles.externalAiSearch}
              description={d.sheets.externalSearchHint}
              // Marked before the tap, not after: the screen behind it is a
              // roadmap, and the sheet should say so first.
              badge={<Badge label={d.plans.comingSoon} tone="neutral" />}
              onPress={() => go("/external-search")}
            />
          </>
        )}
      </BottomSheet>

      <MoreSheet
        visible={openSheet === "more"}
        role={role}
        onClose={closeSheet}
        onNavigate={go}
      />
    </View>
  );
}
