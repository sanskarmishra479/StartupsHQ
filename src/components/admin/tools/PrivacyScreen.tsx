"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, fieldErrors } from "@/lib/admin-api";
import type { AdminListItem, PrivacyRequest } from "@/types/admin";
import { PillButton } from "../../ui/PillButton";
import { Dialog } from "../Dialog";
import { Combobox, type ComboOption } from "../editor/Combobox";
import { Field, inputClasses, Notice, TextArea, TextInput } from "../form";
import { formatTimestamp } from "../time";

const REQUEST_TYPES = ["access", "correction", "erasure", "objection"] as const;

/** Founders by name, carrying the slug the erasure confirmation must repeat. */
async function loadFounders(query: string): Promise<ComboOption[]> {
  const params = new URLSearchParams({ limit: "8" });
  if (query) params.set("q", query);
  const result = await adminApi<AdminListItem[]>(
    "GET",
    `/api/v1/founders?${params}`,
  );
  if (!result.ok) return [];
  return result.data.map((founder) => ({
    id: founder.id,
    label: founder.name,
    detail: founder.slug,
  }));
}

/**
 * Privacy requests and founder erasure (FR-210, FR-410), admin only. Requests arrive by email and
 * are recorded here with a 30-day due date. Erasure is irreversible and needs the typed
 * confirmation the API also checks.
 */
export function PrivacyScreen({
  requests,
}: Readonly<{ requests: readonly PrivacyRequest[] }>) {
  const router = useRouter();
  const [notice, setNotice] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [resolving, setResolving] = useState<PrivacyRequest | null>(null);
  const [erasing, setErasing] = useState<ComboOption | null>(null);
  const [typed, setTyped] = useState("");

  const confirmation = erasing ? `ERASE ${erasing.detail ?? ""}` : "";

  return (
    <div className="flex flex-col gap-8">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section
        aria-labelledby="record-request"
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <h2 id="record-request" className="font-medium text-base">
          Record a request
        </h2>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const received = String(form.get("receivedAt") ?? "");
            const notes = String(form.get("notes") ?? "").trim();
            setPending("record");
            setErrors({});
            const result = await adminApi("POST", "/api/v1/privacy/requests", {
              requestType: form.get("requestType"),
              subjectEntityType: form.get("subjectEntityType"),
              receivedAt: received ? new Date(received).toISOString() : "",
              ...(notes ? { notes } : {}),
            });
            setPending(null);
            if (!result.ok) {
              setErrors(fieldErrors(result.details));
              setNotice({ tone: "error", text: result.message });
              return;
            }
            formElement.reset();
            setNotice({
              tone: "success",
              text: "Request recorded. It is due in 30 days.",
            });
            router.refresh();
          }}
        >
          <Field label="Type">
            <select
              name="requestType"
              className={inputClasses}
              defaultValue="access"
            >
              {REQUEST_TYPES.map((type) => (
                <option key={type} value={type} className="capitalize">
                  {type[0]?.toUpperCase() + type.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="About">
            <select
              name="subjectEntityType"
              className={inputClasses}
              defaultValue="founder"
            >
              <option value="founder">A founder</option>
              <option value="user">A staff user</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Received" error={errors.receivedAt}>
            <TextInput name="receivedAt" type="datetime-local" required />
          </Field>
          <Field
            label="Notes"
            className="sm:col-span-3"
            hint="Who asked and how to reach them; no more than needed."
          >
            <TextArea name="notes" rows={2} maxLength={4000} />
          </Field>
          <div className="sm:col-span-3">
            <PillButton type="submit" size="sm" disabled={pending !== null}>
              {pending === "record" ? "Recording…" : "Record request"}
            </PillButton>
          </div>
        </form>
      </section>

      <section aria-labelledby="requests" className="flex flex-col gap-3">
        <h2 id="requests" className="font-medium text-lg">
          Requests
        </h2>
        {requests.length === 0 ? (
          <p className="text-fg-muted text-sm">No privacy requests.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {requests.map((request) => {
              const overdue =
                request.status === "open" &&
                new Date(request.dueAt).getTime() < Date.now();
              return (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm capitalize">
                      {request.requestType} · {request.subjectEntityType}
                    </span>
                    <span className="meta text-fg-subtle">
                      {request.status === "open"
                        ? `${overdue ? "Overdue — was due" : "Due"} ${formatTimestamp(request.dueAt)}`
                        : `${request.status} ${request.resolvedAt ? formatTimestamp(request.resolvedAt) : ""}`}
                    </span>
                    {request.notes && (
                      <span className="whitespace-pre-line text-fg-muted text-xs">
                        {request.notes}
                      </span>
                    )}
                  </span>
                  {request.status === "open" && (
                    <PillButton
                      size="sm"
                      variant="outline"
                      onClick={() => setResolving(request)}
                    >
                      Resolve
                    </PillButton>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="erase"
        className="flex flex-col gap-3 rounded-md border border-danger p-4"
      >
        <h2 id="erase" className="font-medium text-base">
          Erase a founder
        </h2>
        <p className="text-fg-muted text-sm">
          Removes the founder, their roles and old addresses, queues their photo
          for deletion and redacts their details from the audit log. This cannot
          be undone.
        </p>
        {erasing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending("erase");
              const result = await adminApi<{ scrubbedAuditRows: number }>(
                "POST",
                `/api/v1/founders/${erasing.id}/erase`,
                { confirm: typed },
              );
              setPending(null);
              if (!result.ok) {
                setNotice({ tone: "error", text: result.message });
                return;
              }
              setNotice({
                tone: "success",
                text: `${erasing.label} was erased; ${result.data.scrubbedAuditRows} audit entries redacted.`,
              });
              setErasing(null);
              setTyped("");
              router.refresh();
            }}
          >
            <p className="text-sm">
              Founder: <strong>{erasing.label}</strong>
            </p>
            <Field label={`Type “${confirmation}” to confirm`}>
              <TextInput
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <div className="flex gap-2">
              <PillButton
                type="submit"
                size="sm"
                disabled={pending !== null || typed !== confirmation}
              >
                {pending === "erase" ? "Erasing…" : "Erase permanently"}
              </PillButton>
              <PillButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setErasing(null);
                  setTyped("");
                }}
              >
                Cancel
              </PillButton>
            </div>
          </form>
        ) : (
          <Combobox
            label="Find the founder to erase"
            placeholder="Search founders by name"
            debounceMs={200}
            load={loadFounders}
            onSelect={setErasing}
          />
        )}
      </section>

      <ResolveDialog
        request={resolving}
        onClose={() => setResolving(null)}
        onDone={(status) => {
          setResolving(null);
          setNotice({ tone: "success", text: `Request marked ${status}.` });
          router.refresh();
        }}
      />
    </div>
  );
}

function ResolveDialog({
  request,
  onClose,
  onDone,
}: Readonly<{
  request: PrivacyRequest | null;
  onClose: () => void;
  onDone: (status: string) => void;
}>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={request !== null} onClose={onClose} title="Resolve request">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!request) return;
          const form = new FormData(event.currentTarget);
          const status = String(form.get("status"));
          const notes = String(form.get("notes") ?? "").trim();
          setPending(true);
          const result = await adminApi(
            "PATCH",
            `/api/v1/privacy/requests/${request.id}`,
            {
              status,
              ...(notes ? { notes } : {}),
            },
          );
          setPending(false);
          if (!result.ok) {
            setError(result.message);
            return;
          }
          onDone(status);
        }}
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Outcome">
          <select
            name="status"
            defaultValue="completed"
            className={inputClasses}
          >
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Notes" hint="What was done, or why it was refused.">
          <TextArea name="notes" rows={3} maxLength={4000} />
        </Field>
        <div className="flex justify-end gap-2">
          <PillButton
            type="button"
            size="sm"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </PillButton>
          <PillButton type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </PillButton>
        </div>
      </form>
    </Dialog>
  );
}
