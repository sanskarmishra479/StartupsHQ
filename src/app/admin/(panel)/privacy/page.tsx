import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { PrivacyScreen } from "@/components/admin/tools/PrivacyScreen";
import { listRequests } from "@/server/services/privacy";
import { requireAdminPanel } from "../../_lib/session";

// FR-210, admin only.

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const { ctx } = await requireAdminPanel();
  const requests = await listRequests(ctx);
  return (
    <>
      <PageHeader
        title="Privacy"
        description="Access, correction, erasure and objection requests (SEC-18), answered within 30 days."
      />
      <PrivacyScreen requests={requests} />
    </>
  );
}
