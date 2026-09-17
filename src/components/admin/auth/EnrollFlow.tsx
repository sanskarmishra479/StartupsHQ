"use client";

import { useState } from "react";
import { authApi } from "@/lib/admin-api";
import { PillButton } from "../../ui/PillButton";
import { Field, Notice, TextInput } from "../form";
import { RecoveryCodes } from "./RecoveryCodes";

type Enabled = Readonly<{ totpURI: string; backupCodes: string[] }>;

type Step =
  | Readonly<{ kind: "password" }>
  | Readonly<{ kind: "scan"; enabled: Enabled }>
  | Readonly<{ kind: "codes"; backupCodes: string[] }>;

/** The secret in groups of four, as authenticator apps expect it typed. */
const grouped = (secret: string) =>
  secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/**
 * Mandatory two-factor enrolment on first sign-in (FR-201): confirm the password, add the key to
 * an authenticator app, prove it with a code, then keep the 10 recovery codes. Nothing in the
 * panel opens until the code is verified.
 */
export function EnrollFlow({ email }: Readonly<{ email: string }>) {
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enable(form: FormData) {
    setPending(true);
    setError(null);
    const result = await authApi<Enabled>("/two-factor/enable", {
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(
        result.status === 429
          ? "Too many attempts. Try again later."
          : "The password is incorrect.",
      );
      return;
    }
    setStep({ kind: "scan", enabled: result.data });
  }

  async function verify(form: FormData, enabled: Enabled) {
    setPending(true);
    setError(null);
    const result = await authApi("/two-factor/verify-totp", {
      code: String(form.get("code") ?? "").replace(/\s+/g, ""),
    });
    setPending(false);
    if (!result.ok) {
      setError(
        "That code is not valid. Check the time on your device and enter the current code.",
      );
      return;
    }
    setStep({ kind: "codes", backupCodes: enabled.backupCodes });
  }

  if (step.kind === "password") {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void enable(new FormData(event.currentTarget));
        }}
      >
        <h1 className="font-medium text-2xl tracking-tight">
          Set up two-factor authentication
        </h1>
        <p className="text-fg-muted text-sm">
          Every account needs an authenticator app, such as 1Password, Google
          Authenticator or Aegis. Confirm your password to begin.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
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
            autoFocus
          />
        </Field>
        <PillButton type="submit" disabled={pending}>
          {pending ? "Checking…" : "Continue"}
        </PillButton>
        <SignOutLink />
      </form>
    );
  }

  if (step.kind === "scan") {
    const { enabled } = step;
    const secret = new URL(enabled.totpURI).searchParams.get("secret") ?? "";
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void verify(new FormData(event.currentTarget), enabled);
        }}
      >
        <h1 className="font-medium text-2xl tracking-tight">
          Add StartupsHQ to your app
        </h1>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-fg-muted text-sm">
          <li>
            On this device,{" "}
            <a
              href={enabled.totpURI}
              className="text-fg underline underline-offset-2"
            >
              open it in your authenticator app
            </a>
            . Or add an account by hand with this key (time-based, 6 digits):
          </li>
        </ol>
        <output
          aria-label="Setup key"
          className="select-all break-all rounded-md border border-border-strong bg-surface px-3 py-2 text-center font-mono text-sm tracking-wider"
        >
          {grouped(secret)}
        </output>
        <p className="text-fg-muted text-sm">
          Then enter the code the app shows.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Code">
          <TextInput
            name="code"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            className="font-mono tracking-widest"
          />
        </Field>
        <PillButton type="submit" disabled={pending}>
          {pending ? "Checking…" : "Verify"}
        </PillButton>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-medium text-2xl tracking-tight">
        Save your recovery codes
      </h1>
      <p className="text-fg-muted text-sm">
        If you lose your authenticator, each of these signs you in once. They
        are shown only now. Store them in your password manager.
      </p>
      <RecoveryCodes codes={step.backupCodes} />
      <PillButton onClick={() => window.location.assign("/admin")}>
        I have saved them — open the admin
      </PillButton>
    </div>
  );
}

export function SignOutLink({ className }: Readonly<{ className?: string }>) {
  return (
    <button
      type="button"
      onClick={async () => {
        await authApi("/sign-out", {});
        window.location.assign("/admin/login");
      }}
      className={className ?? "text-fg-muted text-sm hover:text-fg"}
    >
      Sign out
    </button>
  );
}
