"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { cx } from "@/lib/cx";
import type {
  CommitResult,
  DryRunResult,
  ImportJobReport,
  ReportedRow,
  RowAction,
} from "@/types/admin";
import { PillButton } from "../../ui/PillButton";
import { Notice } from "../form";
import { formatTimestamp } from "../time";

type Report = Readonly<{
  importJobId: string;
  filename: string | null;
  status: ImportJobReport["status"];
  expiresAt: string;
  summary: DryRunResult["summary"];
  rows: readonly ReportedRow[];
  newFounders: readonly string[] | null;
  newInvestors: readonly string[] | null;
}>;

const ACTION_LABELS: Record<RowAction, string> = {
  create: "Create",
  update: "Update",
  skip: "Skip",
  error: "Error",
};

const COLUMNS =
  "name (required), slug, tagline, description, websiteUrl, careersUrl, stage, workType, headcountBand, foundedYear, location, industries, founders, investors";

/**
 * CSV import (FR-206, FR-402): upload for a dry run, read what each row would do, then commit
 * within 24 hours. Nothing is written until the commit, and everything it creates is a draft.
 */
export function ImportScreen({
  job,
}: Readonly<{ job: ImportJobReport | null }>) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(
    job ? { ...job, newFounders: null, newInvestors: null } : null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<RowAction | "all">("all");
  const [pending, setPending] = useState<"upload" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<CommitResult | null>(null);

  async function upload() {
    if (!file) return;
    setPending("upload");
    setError(null);
    setCommitted(null);
    const form = new FormData();
    form.set("file", file);
    const result = await adminApi<DryRunResult>(
      "POST",
      "/api/v1/import/dry-run",
      form,
    );
    setPending(null);
    if (!result.ok) {
      setError(
        result.details.length > 0
          ? result.details.map((issue) => issue.message).join(" ")
          : result.message,
      );
      return;
    }
    setReport({ ...result.data, filename: file.name, status: "dry_run" });
    setFilter("all");
    router.replace(`/admin/import?job=${result.data.importJobId}`, {
      scroll: false,
    });
  }

  async function commit() {
    if (!report) return;
    setPending("commit");
    setError(null);
    const result = await adminApi<CommitResult>(
      "POST",
      "/api/v1/import/commit",
      {
        importJobId: report.importJobId,
      },
    );
    setPending(null);
    if (!result.ok) {
      setError(
        result.code === "IMPORT_EXPIRED"
          ? "This dry run is over 24 hours old. Upload the file again."
          : result.code === "CONFLICT"
            ? "This dry run was already committed."
            : result.message,
      );
      if (result.code === "IMPORT_EXPIRED") {
        setReport({ ...report, status: "expired" });
      }
      return;
    }
    setCommitted(result.data);
    setReport({ ...report, status: "committed" });
  }

  const rows = report
    ? report.rows.filter((row) => filter === "all" || row.action === filter)
    : [];
  const actionable = report ? report.summary.create + report.summary.update : 0;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="upload"
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <h2 id="upload" className="font-medium text-base">
          Upload a CSV
        </h2>
        <p className="text-fg-muted text-sm">
          Up to 1,000 rows and 4 MB. Columns: {COLUMNS}. Founders, investors and
          industries are separated by semicolons; unknown columns are ignored.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="import-file">
            CSV file
          </label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:h-8 file:rounded-pill file:border file:border-border-strong file:bg-transparent file:px-3 file:text-fg file:text-xs"
          />
          <PillButton
            size="sm"
            disabled={!file || pending !== null}
            onClick={() => void upload()}
          >
            {pending === "upload" ? "Checking…" : "Dry run"}
          </PillButton>
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}
      {committed && (
        <Notice tone="success" title="Imported">
          {committed.created} created and {committed.updated} updated as drafts;{" "}
          {committed.skipped} skipped. Review them in{" "}
          <Link href="/admin/startups?status=draft" className="underline">
            draft startups
          </Link>
          .
        </Notice>
      )}

      {report && (
        <section aria-labelledby="report" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="report" className="font-medium text-lg">
                Dry run{report.filename ? `: ${report.filename}` : ""}
              </h2>
              <p className="meta text-fg-subtle">
                {report.status === "committed"
                  ? "Committed"
                  : report.status === "expired"
                    ? "Expired"
                    : report.status === "failed"
                      ? "Failed — upload the file again"
                      : `Commit before ${formatTimestamp(report.expiresAt)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PillButton
                href={`/api/v1/import/${report.importJobId}/export.csv`}
                prefetch={false}
                size="sm"
                variant="outline"
              >
                Export report
              </PillButton>
              {report.status === "dry_run" && (
                <PillButton
                  size="sm"
                  disabled={pending !== null || actionable === 0}
                  onClick={() => void commit()}
                >
                  {pending === "commit"
                    ? "Importing…"
                    : `Commit ${actionable} ${actionable === 1 ? "row" : "rows"}`}
                </PillButton>
              )}
            </div>
          </div>

          <nav aria-label="Row filter">
            <ul className="flex flex-wrap gap-1">
              {(["all", "create", "update", "skip", "error"] as const).map(
                (action) => (
                  <li key={action}>
                    <button
                      type="button"
                      aria-pressed={filter === action}
                      onClick={() => setFilter(action)}
                      className={cx(
                        "inline-flex h-8 items-center gap-1.5 rounded-pill px-3 text-sm",
                        filter === action
                          ? "bg-inverse-bg text-inverse-fg"
                          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                      )}
                    >
                      {action === "all" ? "All" : ACTION_LABELS[action]}
                      <span className="tabular-nums opacity-70">
                        {action === "all"
                          ? report.rows.length
                          : report.summary[action]}
                      </span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </nav>

          {report.newFounders?.length || report.newInvestors?.length ? (
            <Notice title="New records a commit would create as drafts">
              {report.newFounders && report.newFounders.length > 0 && (
                <p>Founders: {report.newFounders.join(", ")}</p>
              )}
              {report.newInvestors && report.newInvestors.length > 0 && (
                <p>
                  Investors (type VC, correct later):{" "}
                  {report.newInvestors.join(", ")}
                </p>
              )}
            </Notice>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-border border-b bg-surface">
                <tr>
                  <th
                    scope="col"
                    className="meta w-14 px-3 py-2 font-normal text-fg-subtle"
                  >
                    Row
                  </th>
                  <th
                    scope="col"
                    className="meta w-20 px-3 py-2 font-normal text-fg-subtle"
                  >
                    Action
                  </th>
                  <th
                    scope="col"
                    className="meta px-3 py-2 font-normal text-fg-subtle"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="meta px-3 py-2 font-normal text-fg-subtle"
                  >
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.row} className="align-top">
                    <td className="px-3 py-2 text-fg-muted tabular-nums">
                      {row.row}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cx(
                          "meta",
                          row.action === "error"
                            ? "text-danger"
                            : row.action === "skip"
                              ? "text-fg-subtle"
                              : "text-fg",
                        )}
                      >
                        {ACTION_LABELS[row.action]}
                      </span>
                    </td>
                    {/* Values from the file are rendered as text, never markup (SEC-07). */}
                    <td className="px-3 py-2">
                      {row.name}
                      {row.slug && (
                        <span className="block font-mono text-fg-subtle text-xs">
                          {row.slug}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-fg-muted">
                      {row.reason}
                      {row.errors && (
                        <ul className="flex flex-col gap-0.5">
                          {row.errors.map((issue) => (
                            <li key={`${issue.path}:${issue.message}`}>
                              <span className="font-mono text-xs">
                                {issue.path}
                              </span>
                              : {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
