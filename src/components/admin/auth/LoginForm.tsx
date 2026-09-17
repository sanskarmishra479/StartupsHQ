"use client";

import { useState } from "react";
import { type ApiFailure, authApi } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { Field, Notice, TextInput } from "../form";

type Step = "password" | "second-factor";

/** Better Auth's answer when the password step's short-lived challenge cookie is gone. */
const EXPIRED_CHALLENGE = "INVALID_TWO_FACTOR_COOKIE";

function signInMessage(failure: ApiFailure): string {
  if (failure.status === 429) {
    return failure.retryAfter
      ? `Too many attempts. Try again in ${failure.retryAfter} seconds.`
      : "Too many attempts. Try again later.";
  }
  if (failure.status === 401 || failure.status === 400) {
    return "The email or password is incorrect.";
  }
  return failure.message;
}

function codeMessage(failure: ApiFailure, recovery: boolean): string {
  if (failure.status === 429) return signInMessage(failure);
  if (failure.code === EXPIRED_CHALLENGE) {
    return "The sign-in took too long. Start again.";
  }
  return recovery
    ? "That recovery code is not valid or has been used."
    : "That code is not valid. Check the time on your device and try the current code.";
}

/**
 * Email and password, then the second factor (FR-201). Every account has enrolled one; an account
 * that has not yet is sent to enrolment by the server once the password is accepted.
 */
export function LoginForm() {
  const [step, setStep] = useState<Step>("password");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A full load, so the server renders the panel with the new session and a fresh nonce.
  const enter = (path: string) => window.location.assign(path);

  async function submitPassword(form: FormData) {
    setPending(true);
    setError(null);
    const result = await authApi<{ twoFactorRedirect?: boolean }>(
      "/sign-in/email",
      {
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      },
    );
    setPending(false);
    if (!result.ok) {
      setError(signInMessage(result));
      return;
    }
    if (result.data?.twoFactorRedirect) {
      setStep("second-factor");
      return;
    }
    enter("/admin/enroll");
  }

  async function submitCode(form: FormData) {
    setPending(true);
    setError(null);
    const code = String(form.get("code") ?? "").replace(/\s+/g, "");
    const result = await authApi(
      recovery ? "/two-factor/verify-backup-code" : "/two-factor/verify-totp",
      { code },
    );
    if (!result.ok) {
      setPending(false);
      setError(codeMessage(result, recovery));
      if (result.code === EXPIRED_CHALLENGE) {
        setStep("password");
      }
      return;
    }
    enter("/admin");
  }

  if (step === "password") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submitPassword(new FormData(event.currentTarget));
        }}
      >
        <h1 className="font-medium text-2xl tracking-tight">Sign in</h1>
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
        <Field label="Password">
          <TextInput
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <PillButton type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Continue"}
        </PillButton>
        <a
          href="/admin/reset-password"
          className="text-center text-fg-muted text-sm hover:text-fg"
        >
          Forgot your password?
        </a>
      </form>
    );
  }

  return (
    <form
      key={recovery ? "recovery" : "totp"}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submitCode(new FormData(event.currentTarget));
      }}
    >
      <h1 className="font-medium text-2xl tracking-tight">
        {recovery ? "Use a recovery code" : "Two-factor code"}
      </h1>
      <p className="text-fg-muted text-sm">
        {recovery
          ? "Each recovery code works once."
          : "Enter the 6-digit code from your authenticator app."}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label={recovery ? "Recovery code" : "Code"}>
        <TextInput
          name="code"
          required
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          pattern={recovery ? undefined : "[0-9 ]{6,7}"}
          maxLength={recovery ? 40 : 7}
          spellCheck={false}
          autoFocus
          className="font-mono tracking-widest"
        />
      </Field>
      <PillButton type="submit" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </PillButton>
      <button
        type="button"
        onClick={() => {
          setRecovery(!recovery);
          setError(null);
        }}
        className="text-fg-muted text-sm hover:text-fg"
      >
        {recovery
          ? "Use your authenticator app instead"
          : "Use a recovery code"}
      </button>
    </form>
  );
}
