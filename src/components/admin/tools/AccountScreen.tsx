"use client";

import { useState } from "react";
import { authApi } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { RecoveryCodes } from "../auth/RecoveryCodes";
import { Field, Notice, TextInput } from "../form";

/**
 * Your own account: new recovery codes, which replace the old ones, and a password change, which
 * signs out every other session.
 */
export function AccountScreen({ email }: Readonly<{ email: string }>) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(null);
  const [pending, setPending] = useState<"codes" | "password" | null>(null);

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section
        aria-labelledby="codes"
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <h2 id="codes" className="font-medium text-base">
          Recovery codes
        </h2>
        <p className="text-fg-muted text-sm">
          Generate ten new codes. The codes you have now stop working.
        </p>
        {codesError && <Notice tone="error">{codesError}</Notice>}
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setPending("codes");
              setCodesError(null);
              const result = await authApi<{ backupCodes: string[] }>(
                "/two-factor/generate-backup-codes",
                { password: String(form.get("password") ?? "") },
              );
              setPending(null);
              if (!result.ok) {
                setCodesError("The password is incorrect.");
                return;
              }
              setCodes(result.data.backupCodes);
            }}
          >
            <input
              type="email"
              name="username"
              autoComplete="username"
              value={email}
              readOnly
              hidden
            />
            <Field label="Password">
              <TextInput
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <div>
              <PillButton type="submit" size="sm" disabled={pending !== null}>
                {pending === "codes" ? "Generating…" : "Generate new codes"}
              </PillButton>
            </div>
          </form>
        )}
      </section>

      <section
        aria-labelledby="password"
        className="flex flex-col gap-3 rounded-md border border-border p-4"
      >
        <h2 id="password" className="font-medium text-base">
          Change password
        </h2>
        {passwordNotice && (
          <Notice tone={passwordNotice.tone}>{passwordNotice.text}</Notice>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            const newPassword = String(form.get("newPassword") ?? "");
            if (newPassword !== String(form.get("confirm") ?? "")) {
              setPasswordNotice({
                tone: "error",
                text: "The new passwords do not match.",
              });
              return;
            }
            setPending("password");
            setPasswordNotice(null);
            const result = await authApi("/change-password", {
              currentPassword: String(form.get("currentPassword") ?? ""),
              newPassword,
              revokeOtherSessions: true,
            });
            setPending(null);
            if (!result.ok) {
              setPasswordNotice({
                tone: "error",
                text:
                  result.code === "PASSWORD_TOO_SHORT"
                    ? "Use at least 12 characters."
                    : result.code === "INVALID_PASSWORD"
                      ? "The current password is incorrect."
                      : result.message,
              });
              return;
            }
            formElement.reset();
            setPasswordNotice({
              tone: "success",
              text: "Password changed. Other sessions were signed out.",
            });
          }}
        >
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
          />
          <Field label="Current password">
            <TextInput
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password" hint="At least 12 characters.">
            <TextInput
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </Field>
          <Field label="Confirm new password">
            <TextInput
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </Field>
          <div>
            <PillButton type="submit" size="sm" disabled={pending !== null}>
              {pending === "password" ? "Changing…" : "Change password"}
            </PillButton>
          </div>
        </form>
      </section>
    </div>
  );
}
