import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.auth.signIn };
}

export default function LoginPage() {
  return <LoginForm />;
}
