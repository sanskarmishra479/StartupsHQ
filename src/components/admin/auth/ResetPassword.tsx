"use client";

import { useState } from "react";
import { authApi } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { Field, Notice, TextInput } from "../form";

/** Mirrors the server's PASSWORD_MIN_LENGTH; the server remains the check that counts. */
const MIN_LENGTH = 12;

/** Ask for a reset link. The answer is the same whether or not the address has an account. */
export function RequestReset() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-medium text-2xl tracking-tight">
          Check your email
        </h1>
        <p className="text-fg-muted text-sm">
          If that address has an account, a reset link is on its way. It works
          for one hour.
        </p>
        <a href="/admin/login" className="text-fg-muted text-sm hover:text-fg">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        const result = await authApi("/request-password-reset", {
          email: String(form.get("email") ?? "").trim(),
          redirectTo: `${window.location.origin}/admin/reset-password`,
        });
        setPending(false);
        if (!result.ok && result.status === 429) {
          setError("Too many requests. Try again later.");
          return;
        }
        setSent(true);
      }}
    >
      <h1 className="font-medium text-2xl tracking-tight">
        Reset your password
      </h1>
      <p className="text-fg-muted text-sm">
        We will email a link to set a new one.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="Email">
        <TextInput
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
      </Field>
      <PillButton type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send link"}
      </PillButton>
      <a
        href="/admin/login"
        className="text-center text-fg-muted text-sm hover:text-fg"
      >
        Back to sign in
      </a>
    </form>
  );
}

/** Set a new password from an emailed link, which is also how an invited account starts. */
export function SetPassword({
  token,
  invite,
}: Readonly<{ token: string; invite: boolean }>) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-medium text-2xl tracking-tight">Password set</h1>
        <p className="text-fg-muted text-sm">
          {invite
            ? "Sign in now. You will set up two-factor authentication next."
            : "Sign in with your new password. Other sessions have been signed out."}
        </p>
        <PillButton href="/admin/login">Sign in</PillButton>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const password = String(form.get("password") ?? "");
        if (password !== String(form.get("confirm") ?? "")) {
          setError("The two passwords do not match.");
          return;
        }
        setPending(true);
        setError(null);
        const result = await authApi("/reset-password", {
          newPassword: password,
          token,
        });
        setPending(false);
        if (!result.ok) {
          setError(
            result.code === "PASSWORD_TOO_SHORT"
              ? `Use at least ${MIN_LENGTH} characters.`
              : result.code === "INVALID_TOKEN"
                ? "This link has expired or was already used. Ask for a new one."
                : result.message,
          );
          return;
        }
        setDone(true);
      }}
    >
      <h1 className="font-medium text-2xl tracking-tight">
        {invite ? "Welcome — choose a password" : "Choose a new password"}
      </h1>
      {error && <Notice tone="error">{error}</Notice>}
      <Field
        label="New password"
        hint={`At least ${MIN_LENGTH} characters. A passphrase from your password manager is ideal.`}
      >
        <TextInput
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          maxLength={128}
          required
          autoFocus
        />
      </Field>
      <Field label="Confirm password">
        <TextInput
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_LENGTH}
          maxLength={128}
          required
        />
      </Field>
      <PillButton type="submit" disabled={pending}>
        {pending ? "Saving…" : "Set password"}
      </PillButton>
    </form>
  );
}
