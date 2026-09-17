"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ApiFailure, fieldErrors } from "@/lib/admin-api";
import type { AdminEntity, AdminRecord } from "@/types/admin";
import {
  changedFields,
  FIELD_SPECS,
  type FormValue,
  type FormValues,
  fromFormValues,
  toFormValues,
} from "./fields";

/**
 * Form state for one record: the values as typed, per-field errors from either the form or the
 * server, and whether anything differs from what was loaded.
 */
export function useEntityForm(
  kind: AdminEntity,
  record: AdminRecord | null,
  initialValues: Readonly<Record<string, unknown>> = {},
) {
  const specs = FIELD_SPECS[kind];
  // A new form is seeded once from `initialValues`; after that the record identity is the reset point.
  const seed = useRef(initialValues);
  // Reset only when a different record loads: a refresh after a link or status change must not
  // throw away fields still being typed.
  const recordRef = useRef(record);
  recordRef.current = record;
  const recordId = record?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the record id alone, see above.
  const loaded = useMemo(
    () => toFormValues(specs, recordRef.current?.values ?? seed.current),
    [specs, recordId],
  );
  const [values, setValues] = useState<FormValues>(loaded);
  const [baseline, setBaseline] = useState<FormValues>(loaded);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setValues(loaded);
    setBaseline(loaded);
    setErrors({});
  }, [loaded]);

  const setField = useCallback((key: string, value: FormValue) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }, []);

  const dirty = JSON.stringify(values) !== JSON.stringify(baseline);

  /** The body to send: everything for a create, only changes for an update. */
  const prepare = useCallback(():
    | { ok: true; body: Record<string, unknown> }
    | { ok: false } => {
    const parsed = fromFormValues(specs, values);
    if (Object.keys(parsed.errors).length > 0) {
      setErrors(parsed.errors);
      return { ok: false };
    }
    if (!record) {
      // A create omits empty optional fields rather than sending nulls.
      const body = Object.fromEntries(
        Object.entries(parsed.body).filter(([, value]) => value !== null),
      );
      return { ok: true, body };
    }
    const before = fromFormValues(specs, baseline).body;
    return { ok: true, body: changedFields(before, parsed.body) };
  }, [specs, values, baseline, record]);

  /** Server field errors land on their fields; returns whether any did. */
  const applyFailure = useCallback((failure: ApiFailure) => {
    const byField = fieldErrors(failure.details);
    setErrors(byField);
    return Object.keys(byField).length > 0;
  }, []);

  const markSaved = useCallback(() => setBaseline(values), [values]);

  return {
    specs,
    values,
    setValues,
    setField,
    errors,
    setErrors,
    dirty,
    prepare,
    applyFailure,
    markSaved,
  };
}

/** Asks before leaving with unsaved changes: closing the tab, reloading, or following a link. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const message = "You have unsaved changes. Leave without saving?";
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank")
        return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
