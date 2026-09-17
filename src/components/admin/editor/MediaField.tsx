"use client";

import { useRef, useState } from "react";
import { messageFor } from "@/lib/admin-api";
import { cx } from "@/lib/cx";
import type { UploadedAsset } from "@/types/admin";
import type { Image } from "@/types/public";
import { ResponsiveImage } from "../../media/ResponsiveImage";
import { PillButton } from "../../ui/PillButton";

const ACCEPT = "image/png,image/jpeg,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

type Upload =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "uploading"; percent: number }>
  | Readonly<{ kind: "error"; message: string }>;

/** POST /media with progress, which fetch cannot report. */
function upload(
  file: File,
  purpose: string,
  onProgress: (percent: number) => void,
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    form.set("purpose", purpose);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/media");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error(messageFor("NETWORK")));
    xhr.onload = () => {
      let body: {
        data?: UploadedAsset;
        error?: { code?: string; message?: string };
      } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Handled below.
      }
      if (xhr.status === 201 && body.data) resolve(body.data);
      else {
        reject(
          new Error(
            messageFor(body.error?.code ?? "INTERNAL", body.error?.message),
          ),
        );
      }
    };
    xhr.send(form);
  });
}

/**
 * An image field (SEC-06, FR-408): drop or choose a PNG, JPEG or WebP up to 5 MB. The server
 * re-encodes it and holds it as a staging asset until the record is saved.
 */
export function MediaField({
  id,
  purpose,
  value,
  preview,
  onChange,
  describedBy,
}: Readonly<{
  id?: string;
  purpose: "logo" | "cover" | "photo";
  value: string;
  preview: Image | null;
  onChange: (assetId: string, image: Image | null) => void;
  describedBy?: string;
}>) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Upload>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  async function take(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT.split(",").includes(file.type)) {
      setState({
        kind: "error",
        message: "Use a PNG, JPEG or WebP image. SVG is not accepted.",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      setState({ kind: "error", message: "The image is over 5 MB." });
      return;
    }
    setState({ kind: "uploading", percent: 0 });
    try {
      const asset = await upload(file, purpose, (percent) =>
        setState({ kind: "uploading", percent }),
      );
      onChange(asset.assetId, asset.image);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "error", message: (error as Error).message });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping a file is a mouse shortcut; the Upload button is the keyboard path. */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void take(event.dataTransfer.files[0]);
        }}
        className={cx(
          "flex items-center gap-3 rounded-md border border-dashed p-3",
          dragging ? "border-fg bg-surface-hover" : "border-border-strong",
        )}
      >
        <div
          className={cx(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-placeholder",
            purpose === "cover" ? "aspect-(--aspect-cover) w-28" : "size-14",
          )}
        >
          {value && preview ? (
            <ResponsiveImage
              image={preview}
              alt=""
              sizes="112px"
              fit={purpose === "logo" ? "contain" : "cover"}
              className="size-full"
            />
          ) : (
            <span className="meta text-fg-subtle">
              {value ? "Saved" : "None"}
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <PillButton
              size="sm"
              variant="outline"
              onClick={() => input.current?.click()}
              disabled={state.kind === "uploading"}
              aria-describedby={describedBy}
            >
              {value ? "Replace" : "Upload"}
            </PillButton>
            {value && (
              <PillButton
                size="sm"
                variant="outline"
                onClick={() => onChange("", null)}
                disabled={state.kind === "uploading"}
              >
                Remove
              </PillButton>
            )}
          </div>
          <p className="text-fg-subtle text-xs">
            or drop an image here · PNG, JPEG, WebP · 5 MB
          </p>
        </div>
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            void take(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {state.kind === "uploading" && (
        <div className="flex items-center gap-2">
          <progress
            max={100}
            value={state.percent}
            aria-label="Upload progress"
            className="h-1.5 flex-1 accent-fg"
          />
          <span className="meta text-fg-subtle tabular-nums">
            {state.percent}%
          </span>
        </div>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-danger text-xs">
          {state.message}
        </p>
      )}
    </div>
  );
}
