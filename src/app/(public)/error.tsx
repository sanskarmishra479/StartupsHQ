"use client";

import { EmptyState } from "@/components/data/EmptyState";
import { PillButton } from "@/components/ui/PillButton";

// Any unexpected failure while rendering a public page. The message stays generic: details go to
// the server logs, never to visitors (SEC-12).

export default function PublicError({
  retry,
}: Readonly<{ error: Error & { digest?: string }; retry: () => void }>) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[60dvh] max-w-screen-md items-center px-4 py-16"
    >
      <EmptyState
        className="w-full"
        title="Something went wrong"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <PillButton onClick={retry}>Try again</PillButton>
            <PillButton variant="outline" href="/">
              Go to the start
            </PillButton>
          </div>
        }
      >
        This page could not be shown. Trying again usually helps.
      </EmptyState>
    </main>
  );
}
