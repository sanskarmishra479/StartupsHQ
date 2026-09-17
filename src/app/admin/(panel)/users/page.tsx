import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { UsersScreen } from "@/components/admin/tools/UsersScreen";
import { listUsers } from "@/server/services/users";
import { requireAdminPanel } from "../../_lib/session";

// FR-208, admin only.

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const { ctx } = await requireAdminPanel();
  const users = await listUsers(ctx);
  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts. There are no public accounts."
      />
      <UsersScreen users={users} currentUserId={ctx.actor.id} />
    </>
  );
}
