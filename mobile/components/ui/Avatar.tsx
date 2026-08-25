import { useState } from "react";
import { Image, Text, View } from "react-native";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "size-8", text: "text-[12px]" },
  md: { box: "size-10", text: "text-[14px]" },
  lg: { box: "size-16", text: "text-[20px]" },
} as const;

/**
 * A profile picture, with initials behind it.
 *
 * ## The initials are the base layer, not the error state
 *
 * The image is drawn ON TOP of them, so a slow or broken load shows a
 * readable placeholder rather than a grey square — and a signed avatar URL
 * that has expired degrades to initials instead of a missing-image icon.
 * `failed` only stops React Native retrying a URL that already 404'd.
 */
export function Avatar({
  name,
  src,
  size = "md",
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const style = SIZES[size];

  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      className={cn(
        "items-center justify-center overflow-hidden rounded-full border border-line bg-brand-soft",
        style.box,
      )}
    >
      <Text className={cn("font-semibold text-brand-ink", style.text)}>
        {initials}
      </Text>
      {src && !failed ? (
        <Image
          source={{ uri: src }}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
          className="absolute inset-0 h-full w-full"
        />
      ) : null}
    </View>
  );
}
