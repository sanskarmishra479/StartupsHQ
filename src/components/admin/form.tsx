import {
  type ComponentProps,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { cx } from "@/lib/cx";

// Form building blocks for the admin panel: a label, a control, a hint and an error, wired together
// for assistive technology (NFR-04). Dense and plain — this is a work tool, not the showroom.

export const controlClasses = cx(
  "w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle",
  "aria-invalid:border-danger disabled:opacity-60",
);

export const inputClasses = cx(controlClasses, "h-9");

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * A labelled control. The single child element receives the id, `aria-describedby` for the hint
 * and error, and `aria-invalid` when there is an error.
 */
export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: Readonly<{
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  children: ReactElement<ControlProps>;
}>) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : children;
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="font-medium text-sm">
        {label}
        {required && (
          <span className="text-fg-subtle">
            {" "}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(required)</span>
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-fg-subtle text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClasses, props.className)} />;
}

export function TextArea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      rows={4}
      {...props}
      className={cx(controlClasses, "py-2 leading-relaxed", props.className)}
    />
  );
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cx(inputClasses, props.className)} />;
}

/** A checkbox with its label beside it. */
export function Checkbox({
  label,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={cx("inline-flex items-center gap-2 text-sm", className)}>
      <input type="checkbox" {...props} className="size-4 accent-fg" />
      {label}
    </label>
  );
}

/** A message about the whole form or page. Errors interrupt assistive technology; notes do not. */
export function Notice({
  tone = "info",
  title,
  children,
  className,
}: Readonly<{
  tone?: "info" | "error" | "success";
  title?: string;
  children?: ReactNode;
  className?: string;
}>) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border px-3 py-2.5 text-sm",
        tone === "error"
          ? "border-danger text-fg"
          : "border-border-strong bg-surface text-fg",
        className,
      )}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && (
        <div className={cx(title && "mt-0.5", "text-fg-muted")}>{children}</div>
      )}
    </div>
  );
}
