import type { Metadata } from "next";
import { AuthChoice } from "@/components/auth/AuthChoice";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.auth.signIn };
}

export default function LoginPage() {
  return <AuthChoice mode="login" />;
}
