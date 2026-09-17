"use client";

import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { cx } from "@/lib/cx";
import {
  normalizeSearchText,
  readRecentSearches,
  rememberSearch,
  SEARCH_MAX,
  SEARCH_MIN,
  SUGGEST_DEBOUNCE_MS,
  SUGGESTION_TYPE_LABELS,
  searchHref,
  suggestApiUrl,
  suggestionHref,
} from "@/lib/search";
import type { Suggestion } from "@/types/public";
import { EntityLogo } from "../entity/EntityLogo";
import { ArrowRightIcon, ClockIcon, SearchIcon } from "../ui/icons";

type Option =
  | Readonly<{ kind: "suggestion"; key: string; suggestion: Suggestion }>
  | Readonly<{ kind: "recent"; key: string; q: string }>
  | Readonly<{ kind: "search"; key: string; q: string }>;

type Fetched = Readonly<{
  q: string;
  status: "loading" | "ready" | "error";
  suggestions: readonly Suggestion[];
}>;

/** Recently typed prefixes answer instantly on backspace; bounded so a long session stays small. */
const CACHE_SIZE = 30;

/**
 * The ⌘K palette (FR-109): suggestions as you type from GET /api/v1/suggest, following the ARIA
 * combobox pattern — focus stays in the input while the arrow keys move through the list. An
 * empty input offers recent searches; Enter with nothing highlighted opens the full results page.
 */
export type SearchPaletteHandle = Readonly<{ open: () => void }>;

export function SearchPalette({
  ref,
}: Readonly<{ ref: Ref<SearchPaletteHandle> }>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const titleId = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const [fetched, setFetched] = useState<Fetched>({
    q: "",
    status: "ready",
    suggestions: [],
  });
  const cache = useRef(new Map<string, readonly Suggestion[]>());

  // The dialog element itself is the open state, so a shortcut pressed straight after Escape
  // never races a queued close event.
  useImperativeHandle(
    ref,
    () => ({
      open() {
        const dialog = dialogRef.current;
        if (!dialog || dialog.open) return;
        setText("");
        setActive(-1);
        setRecent(readRecentSearches());
        dialog.showModal();
        inputRef.current?.focus();
      },
    }),
    [],
  );

  const close = useCallback(() => dialogRef.current?.close(), []);

  const q = normalizeSearchText(text);

  useEffect(() => {
    setActive(-1);
    if (!q) return;
    const cached = cache.current.get(q.toLowerCase());
    if (cached) {
      setFetched({ q, status: "ready", suggestions: cached });
      return;
    }
    setFetched((current) => ({ ...current, q, status: "loading" }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(suggestApiUrl(q), {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(String(response.status));
        const { data } = (await response.json()) as { data: Suggestion[] };
        const store = cache.current;
        store.set(q.toLowerCase(), data);
        if (store.size > CACHE_SIZE) {
          store.delete(store.keys().next().value as string);
        }
        setFetched({ q, status: "ready", suggestions: data });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        setFetched({ q, status: "error", suggestions: [] });
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q]);

  // Only results for the text in the box are ever shown.
  const suggestions = fetched.q === q ? fetched.suggestions : [];
  const status = fetched.q === q ? fetched.status : "loading";

  const options: Option[] = !q
    ? recent.map((item) => ({ kind: "recent", key: `recent:${item}`, q: item }))
    : [
        ...suggestions.map((suggestion) => ({
          kind: "suggestion" as const,
          key: `${suggestion.type}:${suggestion.slug}`,
          suggestion,
        })),
        ...(q.length >= SEARCH_MIN
          ? [{ kind: "search" as const, key: "search", q }]
          : []),
      ];

  const optionId = (index: number) => `${listId}-${index}`;

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const choose = (option: Option) => {
    if (option.kind === "suggestion") {
      go(suggestionHref(option.suggestion));
      return;
    }
    rememberSearch(option.q);
    go(searchHref(option.q));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        index === -1 && step === -1
          ? options.length - 1
          : (index + step + options.length) % options.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option);
      else if (q.length >= SEARCH_MIN) choose({ kind: "search", key: "", q });
    }
  };

  // Keep the highlighted option in view as the arrow keys move past the edge of the list.
  useEffect(() => {
    if (active < 0) return;
    document
      .getElementById(`${listId}-${active}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);

  const announcement = !q
    ? recent.length > 0
      ? `${recent.length} recent ${recent.length === 1 ? "search" : "searches"}.`
      : ""
    : status === "loading"
      ? ""
      : status === "error"
        ? "Suggestions are unavailable. Press Enter to search."
        : suggestions.length === 0
          ? `No suggestions for ${q}.${q.length >= SEARCH_MIN ? " Press Enter to search." : ""}`
          : `${suggestions.length} ${suggestions.length === 1 ? "suggestion" : "suggestions"}.`;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a backdrop click is a mouse shortcut; keyboards close with Escape, which the dialog handles natively.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === dialogRef.current) close();
      }}
      className="m-0 mx-auto mt-3 w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-xl border border-border-strong bg-bg p-0 text-fg shadow-2xl backdrop:bg-[rgb(0_0_0/0.6)] sm:mt-[12dvh]"
    >
      <h2 id={titleId} className="sr-only">
        Search StartupsHQ
      </h2>
      <div className="flex items-center gap-3 border-border border-b px-4">
        <SearchIcon className="size-4 shrink-0 text-fg-subtle" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search companies, founders, investors and batches"
          aria-autocomplete="list"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={SEARCH_MAX}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search companies, founders, investors…"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-fg-subtle"
        />
        <kbd className="meta hidden rounded-sm border border-border px-1.5 text-fg-subtle sm:inline">
          Esc
        </kbd>
      </div>

      {!q && recent.length > 0 && (
        <p className="meta px-4 pt-3 text-fg-subtle" aria-hidden="true">
          Recent searches
        </p>
      )}

      <div
        id={listId}
        role="listbox"
        aria-label={q ? "Suggestions" : "Recent searches"}
        className={cx(
          "max-h-[min(24rem,60dvh)] overflow-y-auto p-2",
          options.length === 0 && "hidden",
        )}
      >
        {options.map((option, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: options are chosen from the keyboard in the combobox input, per the ARIA combobox pattern.
          <div
            key={option.key}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            onMouseMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
            className={cx(
              "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2",
              index === active && "bg-surface-hover",
            )}
          >
            <OptionBody option={option} />
          </div>
        ))}
      </div>

      {q && status === "ready" && suggestions.length === 0 && (
        <p className="px-4 pb-4 text-fg-muted text-sm">
          {q.length >= SEARCH_MIN
            ? "No quick matches — the full search also looks through descriptions."
            : "Keep typing…"}
        </p>
      )}
      {q && status === "error" && (
        <p className="px-4 pb-4 text-fg-muted text-sm">
          Suggestions are unavailable right now.
        </p>
      )}
      {!q && recent.length === 0 && (
        <p className="px-4 py-4 text-fg-muted text-sm">
          Find a company, founder, investor or batch by name. Misspellings are
          fine.
        </p>
      )}

      <output aria-live="polite" className="sr-only">
        {announcement}
      </output>
    </dialog>
  );
}

function OptionBody({ option }: Readonly<{ option: Option }>) {
  if (option.kind === "recent") {
    return (
      <>
        <ClockIcon className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-sm">{option.q}</span>
      </>
    );
  }
  if (option.kind === "search") {
    return (
      <>
        <SearchIcon className="size-4 shrink-0 text-fg-subtle" />
        <span className="min-w-0 flex-1 truncate text-sm">
          Search for “{option.q}”
        </span>
        <ArrowRightIcon className="size-4 shrink-0 text-fg-subtle" />
      </>
    );
  }
  const { suggestion } = option;
  return (
    <>
      <EntityLogo
        name={suggestion.name}
        image={suggestion.logo}
        size={32}
        shape={suggestion.type === "founder" ? "circle" : "square"}
        className="size-8 text-xs"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{suggestion.name}</span>
        {suggestion.subtitle && (
          <span className="truncate text-fg-muted text-xs">
            {suggestion.subtitle}
          </span>
        )}
      </span>
      <span className="meta shrink-0 text-fg-subtle">
        {SUGGESTION_TYPE_LABELS[suggestion.type]}
      </span>
    </>
  );
}
