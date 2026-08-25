import { ScrollView, Text, Pressable } from "react-native";
import { useMyVacancies } from "@/features/recruiter/queries";
import { useI18n } from "@/lib/i18n/index";
import { cn } from "@/lib/utils";

/**
 * The vacancy this screen is scoped to.
 *
 * ## Why every recruiting screen carries one
 *
 * Evidence, interview questions and comparison cells are all defined per
 * (candidate, vacancy) pair. A screen without a vacancy is not "showing all
 * of them" — it is showing nothing meaningful, because the same candidate's
 * evidence differs entirely depending on which role it is being read
 * against. Making the picker prominent is what stops a recruiter reading one
 * vacancy's answers under another vacancy's heading.
 *
 * ## It offers OWNED vacancies only
 *
 * `/vacancies/mine`, not `/vacancies`. Every vacancy-scoped read — evidence,
 * interview questions, the comparison table, the candidate list — is refused
 * with `VACANCY_NOT_OWNED` for a vacancy a colleague created. A picker built
 * from the organization's full list would therefore be a menu whose options
 * mostly 403, which reads as a broken app rather than as the ownership rule
 * it is. The backend still refuses either way; this only stops the app
 * offering doors it knows are locked.
 */
export function VacancyPicker({
  value,
  onChange,
  allowAll = false,
}: {
  value: string | null;
  onChange: (vacancyId: string | null) => void;
  /** Offers an "all my vacancies" option, where the backend supports one. */
  allowAll?: boolean;
}) {
  const { d } = useI18n();
  const vacancies = useMyVacancies();
  const rows = vacancies.rows;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-3"
      accessibilityLabel={d.candidates.selectVacancy}
    >
      {allowAll ? (
        <Option
          label={d.hrSearch.allVacancies}
          selected={value === null}
          onPress={() => onChange(null)}
        />
      ) : null}
      {rows.map((vacancy) => (
        <Option
          key={vacancy.id}
          label={vacancy.title}
          selected={value === vacancy.id}
          onPress={() => onChange(vacancy.id)}
        />
      ))}
    </ScrollView>
  );
}

function Option({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      className={cn(
        "min-h-[38px] max-w-[220px] justify-center rounded-full border px-3.5",
        selected ? "border-brand bg-brand-soft" : "border-line bg-surface",
      )}
    >
      <Text
        numberOfLines={1}
        className={cn(
          "text-[13px]",
          selected ? "font-semibold text-brand-ink" : "text-ink-muted",
        )}
      >
        {label}
      </Text>
    </Pressable>
  );
}
