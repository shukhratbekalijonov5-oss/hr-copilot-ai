import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/RegisterForm";
import { getTranslations } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const d = await getTranslations();
  return { title: d.auth.createAccount };
}

export default function RegisterPage() {
  return <RegisterForm />;
}
