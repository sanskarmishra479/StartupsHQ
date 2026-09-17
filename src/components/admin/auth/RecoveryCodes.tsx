"use client";

import { useState } from "react";
import { PillButton } from "../../ui/PillButton";

/** Ten single-use codes, copyable in one go. */
export function RecoveryCodes({
  codes,
}: Readonly<{ codes: readonly string[] }>) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-2 rounded-md border border-border-strong bg-surface p-3 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="select-all text-center">
            {code}
          </li>
        ))}
      </ul>
      <PillButton
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy all"}
      </PillButton>
      <output aria-live="polite" className="sr-only">
        {copied ? "Recovery codes copied." : ""}
      </output>
    </div>
  );
}
