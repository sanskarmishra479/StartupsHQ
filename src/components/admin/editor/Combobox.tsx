"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cx } from "@/lib/cx";
import { inputClasses } from "../form";

export type ComboOption = Readonly<{
  id: string;
  label: string;
  detail?: string | null;
}>;

type Loaded = Readonly<{ query: string; options: readonly ComboOption[] }>;

/**
 * A searchable picker following the ARIA combobox pattern: typing filters, arrows move, Enter
 * chooses, Escape closes. Options come from `load`, local or remote. With `onCreate`, a final
 * option offers to create what was typed — how the startup form adds a founder or investor that
 * does not exist yet without leaving the page (FR-204).
 */
export function Combobox({
  id,
  label,
  load,
  onSelect,
  onCreate,
  createLabel = (text) => `Create “${text}”`,
  placeholder,
  disabled,
  describedBy,
  invalid,
  debounceMs = 0,
}: Readonly<{
  id?: string;
  /** The accessible name when no visible label points at `id`. */
  label?: string;
  load: (
    query: string,
  ) => Promise<readonly ComboOption[]> | readonly ComboOption[];
  onSelect: (option: ComboOption) => void;
  onCreate?: (text: string) => void;
  createLabel?: (text: string) => ReactNode;
  placeholder?: string;
  disabled?: boolean;
  describedBy?: string;
  invalid?: boolean;
  debounceMs?: number;
}>) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loaded, setLoaded] = useState<Loaded>({ query: "", options: [] });
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const query = text.trim();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const options = await loadRef.current(query);
        if (!cancelled) setLoaded({ query, options });
      } catch {
        if (!cancelled) setLoaded({ query, options: [] });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, debounceMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, debounceMs]);

  const options = loaded.query === query ? loaded.options : [];
  const exact = options.some(
    (option) => option.label.toLowerCase() === query.toLowerCase(),
  );
  const offerCreate =
    Boolean(onCreate) && query.length > 0 && !exact && !loading;
  const count = options.length + (offerCreate ? 1 : 0);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onSelect(option);
    else if (offerCreate && onCreate) onCreate(query);
    else return;
    setText("");
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (count === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) =>
        index === -1 && step === -1
          ? count - 1
          : (index + step + count) % count,
      );
    } else if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      choose(active >= 0 ? active : options.length === 1 ? 0 : -1);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={open && count > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && active >= 0 ? optionId(active) : undefined
        }
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={inputClasses}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={label ?? "Options"}
        className={cx(
          "absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border-strong bg-bg p-1 shadow-xl",
          !(open && (count > 0 || loading || query)) && "hidden",
        )}
      >
        {options.map((option, index) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: chosen from the keyboard in the input, per the combobox pattern.
          <div
            key={option.id}
            id={optionId(index)}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(index)}
            className={cx(
              "flex cursor-pointer flex-col rounded-sm px-2 py-1.5 text-sm",
              index === active && "bg-surface-hover",
            )}
          >
            <span className="truncate">{option.label}</span>
            {option.detail && (
              <span className="truncate text-fg-subtle text-xs">
                {option.detail}
              </span>
            )}
          </div>
        ))}
        {offerCreate && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: chosen from the keyboard in the input, per the combobox pattern.
          <div
            id={optionId(options.length)}
            role="option"
            tabIndex={-1}
            aria-selected={active === options.length}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(options.length)}
            onClick={() => choose(options.length)}
            className={cx(
              "cursor-pointer rounded-sm px-2 py-1.5 text-sm",
              active === options.length && "bg-surface-hover",
            )}
          >
            {createLabel(query)}
          </div>
        )}
        {count === 0 && (
          <p className="px-2 py-1.5 text-fg-subtle text-sm">
            {loading ? "Searching…" : "No matches."}
          </p>
        )}
      </div>
    </div>
  );
}
