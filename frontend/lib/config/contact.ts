import type { ComponentType } from "react";
import {
  FacebookIcon,
  InstagramIcon,
  TelegramIcon,
  XIcon,
  type IconProps,
} from "@/components/ui/icons";

/**
 * How to reach the product, in one file.
 *
 * ## Why a module and not markup
 *
 * A phone number written into a component is a phone number that gets changed
 * in one of three places when it moves. These are the values themselves; the
 * footer decides how they look.
 */
export const CONTACT = {
  phone: "010-8211-0660",
  /*
   * The dialable form, which is not the readable one. `tel:` wants no spaces
   * or dashes, and a handset does not care how a human reads the number —
   * so the display string and the href are stated separately rather than one
   * being derived from the other by a `replace` that would silently mangle an
   * international format later.
   */
  phoneHref: "tel:01082110660",
  email: "shukhratbekalijonov4@gmail.com",
} as const;

export const CONTACT_EMAIL_HREF = `mailto:${CONTACT.email}`;

/**
 * Social profiles.
 *
 * ## Empty until somebody supplies a real URL
 *
 * These are deliberately blank. The alternatives were both worse than showing
 * nothing: a made-up handle is a link to someone else's account, and a link
 * to `instagram.com` presented as "our Instagram" tells the reader we have a
 * profile there when we have not said so. `configuredSocialLinks` filters the
 * blanks out, so filling one in HERE is the only step needed to make it
 * appear — no component changes, no conditional to remember.
 */
export const SOCIAL_LINKS: Record<SocialId, string> = {
  instagram: "",
  telegram: "",
  facebook: "",
  x: "",
};

export type SocialId = "instagram" | "telegram" | "facebook" | "x";

export interface SocialProfile {
  id: SocialId;
  /** The network's own name; not translated, because a brand is a brand. */
  label: string;
  url: string;
  icon: ComponentType<IconProps>;
}

const SOCIAL_META: { id: SocialId; label: string; icon: ComponentType<IconProps> }[] = [
  { id: "instagram", label: "Instagram", icon: InstagramIcon },
  { id: "telegram", label: "Telegram", icon: TelegramIcon },
  { id: "facebook", label: "Facebook", icon: FacebookIcon },
  { id: "x", label: "X", icon: XIcon },
];

/** Only the profiles that actually have a URL. Order is the list above. */
export function configuredSocialLinks(
  links: Record<SocialId, string> = SOCIAL_LINKS,
): SocialProfile[] {
  return SOCIAL_META.filter((meta) => links[meta.id].trim().length > 0).map(
    (meta) => ({ ...meta, url: links[meta.id].trim() }),
  );
}
