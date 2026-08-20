import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.auth.organizationSignIn };
}

export default function OrganizationLoginPage() {
  return <LoginForm accountType="ORGANIZATION" />;
}
