"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi, fieldErrors } from "@/lib/admin-api";
import type { AdminUser } from "@/types/admin";
import { PillButton } from "../../ui/PillButton";
import { Field, inputClasses, Notice, TextInput } from "../form";
import { formatTimestamp } from "../time";

type Role = AdminUser["role"];

/**
 * Staff accounts (FR-208), admins only: invite, change a role, reset someone's two-factor, switch
 * an account off or on. Each change signs that person out; the server refuses an admin demoting or
 * deactivating themselves, so the controls for your own row are not offered.
 */
export function UsersScreen({
  users,
  currentUserId,
}: Readonly<{ users: readonly AdminUser[]; currentUserId: string }>) {
  const router = useRouter();
  const [notice, setNotice] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});

  async function act(
    key: string,
    run: () => ReturnType<typeof adminApi>,
    success: string,
  ) {
    setBusy(key);
    setNotice(null);
    const result = await run();
    setBusy(null);
    if (!result.ok) {
      setNotice({ tone: "error", text: result.message });
      return false;
    }
    setNotice({ tone: "success", text: success });
    router.refresh();
    return true;
  }

  return (
    <div className="flex flex-col gap-6">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section
        aria-labelledby="invite"
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <h2 id="invite" className="font-medium text-base">
          Invite someone
        </h2>
        <p className="text-fg-muted text-sm">
          They get an email with a link to set a password, valid for one hour,
          and set up two-factor authentication at first sign-in.
        </p>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const name = String(form.get("name") ?? "").trim();
            setInviteErrors({});
            setBusy("invite");
            setNotice(null);
            const result = await adminApi("POST", "/api/v1/users/invite", {
              email: String(form.get("email") ?? "").trim(),
              role: String(form.get("role") ?? "editor"),
              ...(name ? { name } : {}),
            });
            setBusy(null);
            if (!result.ok) {
              setInviteErrors(fieldErrors(result.details));
              setNotice({
                tone: "error",
                text:
                  result.status === 409
                    ? "That address already has an enrolled or deactivated account."
                    : result.message,
              });
              return;
            }
            formElement.reset();
            setNotice({ tone: "success", text: "Invite sent." });
            router.refresh();
          }}
        >
          <Field label="Email" error={inviteErrors.email}>
            <TextInput name="email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Name" hint="Optional">
            <TextInput name="name" maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Role">
            <select name="role" defaultValue="editor" className={inputClasses}>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <PillButton
            type="submit"
            size="sm"
            className="h-9"
            disabled={busy !== null}
          >
            {busy === "invite" ? "Sending…" : "Send invite"}
          </PillButton>
        </form>
      </section>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-border border-b bg-surface">
            <tr>
              {["Person", "Role", "Two-factor", "Status", "Actions"].map(
                (heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="meta px-3 py-2 font-normal text-fg-subtle"
                  >
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((user) => {
              const self = user.id === currentUserId;
              return (
                <tr key={user.id} className="align-middle">
                  <td className="px-3 py-2">
                    <span className="block">
                      {user.name}
                      {self && (
                        <span className="meta ml-2 text-fg-subtle">You</span>
                      )}
                    </span>
                    <span className="block text-fg-muted text-xs">
                      {user.email}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {self ? (
                      <span className="capitalize">{user.role}</span>
                    ) : (
                      <select
                        aria-label={`Role for ${user.email}`}
                        value={user.role}
                        disabled={busy !== null || user.deactivatedAt !== null}
                        onChange={(event) =>
                          void act(
                            `role:${user.id}`,
                            () =>
                              adminApi("PATCH", `/api/v1/users/${user.id}`, {
                                role: event.target.value as Role,
                              }),
                            `${user.email} is now ${event.target.value === "admin" ? "an admin" : "an editor"}. They have been signed out.`,
                          )
                        }
                        className={`${inputClasses} h-8 w-28`}
                      >
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {user.twoFactorEnabled ? "Enrolled" : "Not yet"}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {user.deactivatedAt
                      ? `Deactivated ${formatTimestamp(user.deactivatedAt)}`
                      : "Active"}
                  </td>
                  <td className="px-3 py-2">
                    {!self && (
                      <div className="flex flex-wrap gap-2">
                        {user.twoFactorEnabled && !user.deactivatedAt && (
                          <PillButton
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Reset two-factor for ${user.email}? They must enrol again at next sign-in.`,
                                )
                              )
                                return;
                              void act(
                                `2fa:${user.id}`,
                                () =>
                                  adminApi(
                                    "POST",
                                    `/api/v1/users/${user.id}/reset-2fa`,
                                  ),
                                `Two-factor reset for ${user.email}. They have been emailed and signed out.`,
                              );
                            }}
                          >
                            Reset two-factor
                          </PillButton>
                        )}
                        {user.deactivatedAt ? (
                          <PillButton
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `on:${user.id}`,
                                () =>
                                  adminApi(
                                    "POST",
                                    `/api/v1/users/${user.id}/reactivate`,
                                  ),
                                `${user.email} can sign in again.`,
                              )
                            }
                          >
                            Reactivate
                          </PillButton>
                        ) : (
                          <PillButton
                            size="sm"
                            variant="outline"
                            disabled={busy !== null}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Deactivate ${user.email}? They are signed out and cannot sign in.`,
                                )
                              )
                                return;
                              void act(
                                `off:${user.id}`,
                                () =>
                                  adminApi(
                                    "POST",
                                    `/api/v1/users/${user.id}/deactivate`,
                                  ),
                                `${user.email} is deactivated.`,
                              );
                            }}
                          >
                            Deactivate
                          </PillButton>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
