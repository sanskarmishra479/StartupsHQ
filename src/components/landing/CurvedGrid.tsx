"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import type { StartupCard } from "@/types/public";
import { StartupCardCell } from "../cards/StartupCardCell";
import type { GridRenderer } from "./grid-renderer";

type CurvedGridProps = Readonly<{
  cards: readonly StartupCard[];
  /** "flat" keeps the plain grid even where the canvas could run: the viewer's list view. */
  view?: "curved" | "flat";
  /** Reports whether the canvas is showing, so controls that need it can hide. */
  onModeChange?: (mode: Mode) => void;
  /** Extra classes for the flat grid, e.g. room for floating chrome. */
  listClassName?: string;
  /** Development only: receives the time each frame took to draw, in milliseconds. */
  onFrame?: (milliseconds: number) => void;
  className?: string;
}>;

export type Mode = "flat" | "canvas";

/**
 * The landing's grid (ADR-023). The cards are always real links in the HTML, for search engines,
 * screen readers and keyboards, and they are what renders first. When motion is allowed and WebGL
 * works, the curved canvas loads afterwards and takes over the view; the links stay in the page,
 * visually hidden, and focusing one glides the canvas to its card. With reduced motion, without
 * WebGL, or if the context is lost, the links are simply shown as a flat grid.
 */
export function CurvedGrid({
  cards,
  view = "curved",
  onModeChange,
  listClassName,
  onFrame,
  className,
}: CurvedGridProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GridRenderer | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const [mode, setMode] = useState<Mode>("flat");
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;

  useEffect(() => {
    onModeChangeRef.current?.(mode);
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || view === "flat") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;

    const stop = () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setMode("flat");
    };

    const start = () => {
      if (reducedMotion.matches || rendererRef.current) return;
      import("./grid-renderer")
        .then(({ createGridRenderer }) => {
          if (disposed || reducedMotion.matches) return;
          rendererRef.current = createGridRenderer({
            canvas,
            cards,
            onReady: () => {
              if (!disposed) setMode("canvas");
            },
            onFail: () => {
              if (!disposed) stop();
            },
            onNavigate: (card) => router.push(`/companies/${card.slug}`),
            onHover: (card) => {
              canvas.style.cursor = card ? "pointer" : "";
              if (card) router.prefetch(`/companies/${card.slug}`);
            },
            onFrame: (ms) => onFrameRef.current?.(ms),
          });
        })
        .catch(stop);
    };

    const onMotionChange = () => (reducedMotion.matches ? stop() : start());
    reducedMotion.addEventListener("change", onMotionChange);
    start();

    return () => {
      disposed = true;
      reducedMotion.removeEventListener("change", onMotionChange);
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setMode("flat");
    };
  }, [cards, router, view]);

  const canvasMode = mode === "canvas";

  return (
    <div
      className={cx(
        "relative",
        canvasMode && "h-dvh overflow-hidden",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        // Pointer-only: keyboard and assistive technology use the links below.
        className={cx(
          // Fixed to the viewport, so it never sizes itself to the long flat list beneath.
          "fixed inset-0 block h-dvh w-full touch-none select-none",
          canvasMode ? "opacity-100" : "pointer-events-none opacity-0",
          "transition-opacity duration-(--duration-slow) ease-(--ease-out)",
        )}
      />
      <ul
        aria-label="Startups"
        className={cx(
          canvasMode
            ? "sr-only"
            : cx(
                "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
                listClassName,
              ),
        )}
        onFocus={(event) => {
          const item = (event.target as HTMLElement).closest("[data-index]");
          const index = item ? Number(item.getAttribute("data-index")) : null;
          rendererRef.current?.focusCard(index);
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            rendererRef.current?.focusCard(null);
          }
        }}
      >
        {cards.map((card, index) => (
          <li key={card.slug} data-index={index} className="-mr-px -mb-px flex">
            <StartupCardCell
              card={card}
              sizes="(min-width: 1536px) 17vw, (min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              priority={index < 4}
              headingLevel={2}
              className="w-full"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
