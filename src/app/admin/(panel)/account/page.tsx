import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { AccountScreen } from "@/components/admin/tools/AccountScreen";
import { requirePanel } from "../../_lib/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { user, isAdmin } = await requirePanel();
  return (
    <>
      <PageHeader
        title="Account"
        description={`${user.name} · ${user.email} · ${isAdmin ? "Admin" : "Editor"}`}
      />
      <AccountScreen email={user.email} />
    </>
  );
}
