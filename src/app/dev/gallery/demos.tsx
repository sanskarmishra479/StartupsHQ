"use client";

import { useState } from "react";
import { LoadMore } from "@/components/data/LoadMore";
import { IconToggle } from "@/components/ui/IconToggle";
import { GridIcon, ListIcon } from "@/components/ui/icons";

// Stateful wrappers so the gallery can show interactive primitives working.

export function ViewToggleDemo() {
  const [view, setView] = useState<"grid" | "list">("grid");
  return (
    <IconToggle
      label="View"
      value={view}
      onChange={setView}
      options={[
        { value: "grid", label: "Curved grid", icon: <GridIcon /> },
        { value: "list", label: "List", icon: <ListIcon /> },
      ]}
    />
  );
}

export function LoadMoreDemo({
  depthLimited = false,
}: Readonly<{ depthLimited?: boolean }>) {
  const [shown, setShown] = useState(24);
  const [pending, setPending] = useState(false);
  return (
    <LoadMore
      shown={shown}
      pending={pending}
      hasMore={shown < 72}
      depthLimited={depthLimited}
      onLoadMore={() => {
        setPending(true);
        setTimeout(() => {
          setShown((n) => n + 24);
          setPending(false);
        }, 600);
      }}
    />
  );
}
