import type { Metadata } from "next";
import {
  RequestReset,
  SetPassword,
} from "@/components/admin/auth/ResetPassword";
import { Notice } from "@/components/admin/form";

export const metadata: Metadata = { title: "Reset password" };

// Better Auth checks the emailed link and lands here with `?token=` or, for an expired or used
// link, `?error=INVALID_TOKEN`. Invites use the same link with `invite=1` (FR-208).

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function ResetPasswordPage({
  searchParams,
}: PageProps<"/admin/reset-password">) {
  const params = await searchParams;
  const token = first(params.token);
  const invite = first(params.invite) === "1";
  if (first(params.error)) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error" title="This link has expired or was already used">
          {invite
            ? "Ask an administrator to send the invite again."
            : "Ask for a new link below."}
        </Notice>
        {!invite && <RequestReset />}
      </div>
    );
  }
  return token ? (
    <SetPassword token={token} invite={invite} />
  ) : (
    <RequestReset />
  );
}
