import type { Metadata } from "next";
import { PageHeader } from "@/components/admin/PageHeader";
import { ImportScreen } from "@/components/admin/tools/ImportScreen";
import { NotFoundError } from "@/server/lib/errors";
import { getJob } from "@/server/services/import";
import type { ImportJobReport } from "@/types/admin";
import { requirePanel } from "../../_lib/session";

// FR-206: upload → dry-run table → commit within 24 h. `?job=` reopens a stored dry run.

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({
  searchParams,
}: PageProps<"/admin/import">) {
  const { ctx } = await requirePanel();
  const jobParam = (await searchParams).job;
  const jobId = Array.isArray(jobParam) ? jobParam[0] : jobParam;
  let job: ImportJobReport | null = null;
  if (jobId) {
    try {
      job = await getJob(ctx, jobId);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return (
    <>
      <PageHeader
        title="Import startups"
        description="A dry run shows what each row would do. Nothing changes until you commit."
      />
      <ImportScreen key={job?.importJobId ?? "new"} job={job} />
    </>
  );
}
