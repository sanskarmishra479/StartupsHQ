import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/auth/LoginForm";
import { readSession } from "../../_lib/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const status = await readSession();
  if (status.kind === "authed") redirect("/admin");
  if (status.kind === "enrollment-required") redirect("/admin/enroll");
  return <LoginForm />;
}
