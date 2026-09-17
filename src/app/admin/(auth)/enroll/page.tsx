import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EnrollFlow } from "@/components/admin/auth/EnrollFlow";
import { readSession } from "../../_lib/session";

export const metadata: Metadata = { title: "Set up two-factor" };

export default async function EnrollPage() {
  const status = await readSession();
  if (status.kind === "anonymous") redirect("/admin/login");
  if (status.kind === "authed") redirect("/admin");
  return <EnrollFlow email={status.user.email} />;
}
