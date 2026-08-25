import { Alert, RefreshControl, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import {
  Badge,
  Body,
  Button,
  Card,
  ErrorState,
  Meta,
  SectionTitle,
  Title,
} from "@/components/ui/index";
import { useAuth } from "@/lib/auth/context";
import { CANDIDATE_TIERS } from "@/lib/billing/plans";
import {
  useBilling,
  useCancelSubscription,
  useCheckout,
  type CheckoutPlan,
} from "@/features/billing/queries";
import { format, useI18n } from "@/lib/i18n/index";

/**
 * Candidate plans, and the real Toss checkout.
 *
 * ## The device never touches payment
 *
 * Upgrading asks the NestJS BFF for a checkout session; the BFF talks to the
 * Java payment service, which returns a hosted Toss URL. The app opens that
 * URL and does nothing else — no card fields, no amount, no key of any kind
 * in the bundle. It is the same flow the web client uses, so there is one
 * payment implementation rather than two that can disagree.
 *
 * ## The plan changes when the SERVER says it did
 *
 * Returning from the browser refetches billing rather than assuming success.
 * `openAuthSessionAsync` resolves on dismissal as well as completion, and the
 * two are indistinguishable from here — so neither is treated as proof. A
 * local "you are now PRO" would be a guess about a payment this app cannot
 * observe, shown to somebody who may have cancelled.
 */
export default function CandidatePlansScreen() {
  const { d } = useI18n();
  const { user } = useAuth();
  const billing = useBilling();
  const checkout = useCheckout();
  const cancel = useCancelSubscription();

  /*
   * Billing is the authority; `/auth/me` is a fallback for the moment before
   * it loads. Neither is ever overwritten by something this screen inferred.
   */
  const plan = billing.data?.plan ?? user?.plan ?? null;

  async function upgrade(target: CheckoutPlan) {
    try {
      await checkout.mutateAsync(target);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  function confirmCancel() {
    Alert.alert(d.plans.title, d.plans.cancelWarning, [
      { text: d.common.cancel, style: "cancel" },
      {
        text: d.plans.cancelSubscription,
        style: "destructive",
        onPress: () => cancel.mutate(),
      },
    ]);
  }

  return (
    <ScrollView
      contentContainerClassName="px-4 pb-10 pt-4 gap-4"
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={billing.isRefetching}
          onRefresh={() => void billing.refetch()}
        />
      }
    >
      <View className="gap-1">
        <Title>{d.plans.title}</Title>
        {plan ? <Body>{`${d.plans.currentPlan}: ${plan}`}</Body> : null}
        {/* Cancelled-but-still-paid is a real state, and the date matters. */}
        {billing.data?.effectiveUntil ? (
          <Meta>
            {format(d.plans.activeUntil, {
              date: new Date(billing.data.effectiveUntil).toLocaleDateString(),
            })}
          </Meta>
        ) : null}
      </View>

      {checkout.isError ? (
        <ErrorState
          title={d.common.somethingWentWrong}
          retryLabel={d.common.retry}
        />
      ) : null}

      {CANDIDATE_TIERS.map((tier) => {
        const current = plan === tier.id;

        return (
          <Card key={tier.id} className="gap-2">
            <View className="flex-row items-center justify-between">
              <SectionTitle>
                {d.plans[tier.id.toLowerCase() as "free" | "pro" | "max"]}
              </SectionTitle>
              {current ? <Badge label={d.plans.currentPlan} tone="brand" /> : null}
            </View>

            <Title className="text-[28px]">{`$${tier.monthlyUsd}`}</Title>

            {/* The KRW disclosure sits BEFORE any tap that could lead to a
                charge: the card is billed in won, and a reader who only saw
                the dollar figure would be surprised by their statement. */}
            {tier.krw ? (
              <Body>
                {format(d.plans.chargedAsKrw, {
                  usd: String(tier.monthlyUsd),
                  krw: tier.krw,
                })}
              </Body>
            ) : null}

            {tier.id !== "FREE" && !current ? (
              <Button
                title={format(d.plans.upgrade, { plan: tier.id })}
                loading={checkout.isPending}
                disabled={checkout.isPending}
                onPress={() => void upgrade(tier.id as CheckoutPlan)}
                className="mt-1"
              />
            ) : null}
          </Card>
        );
      })}

      {plan === "PRO" || plan === "MAX" ? (
        <Button
          title={d.plans.cancelSubscription}
          variant="ghost"
          disabled={cancel.isPending}
          onPress={confirmCancel}
        />
      ) : null}
    </ScrollView>
  );
}
