import { Redirect } from "expo-router";
import { RoleShell } from "@/components/navigation/RoleShell";
import { useAuth } from "@/lib/auth/context";

/**
 * The recruiter shell, and its role gate.
 *
 * Both checks read `/auth/me` through `useAuth`. This is a UX guard — it
 * keeps somebody out of the wrong shell — not a security boundary: every
 * endpoint behind these screens is authorized independently by the backend,
 * which is what actually prevents cross-role access.
 */
export default function RecruiterLayout() {
  const { restoring, user } = useAuth();

  if (restoring) return null;
  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (user.accountType !== "ORGANIZATION") return <Redirect href="/" />;

  return <RoleShell role="recruiter" />;
}
