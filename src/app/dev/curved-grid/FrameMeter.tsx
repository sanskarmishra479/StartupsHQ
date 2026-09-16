"use client";

import { useEffect, useRef, useState } from "react";
import { CurvedGrid } from "@/components/landing/CurvedGrid";
import type { StartupCard } from "@/types/public";

/** The spike with a live readout of frame rate and draw time, for measuring on real devices. */
export function MeasuredGrid({
  cards,
}: Readonly<{ cards: readonly StartupCard[] }>) {
  const samples = useRef<{ at: number; draw: number }[]>([]);
  const [stats, setStats] = useState({ fps: 0, draw: 0, p95: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now();
      const recent = samples.current.filter((s) => now - s.at < 1000);
      samples.current = recent;
      const draws = recent.map((s) => s.draw).sort((a, b) => a - b);
      setStats({
        fps: recent.length,
        draw: draws.length
          ? draws.reduce((a, b) => a + b, 0) / draws.length
          : 0,
        p95: draws[Math.floor(draws.length * 0.95)] ?? 0,
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <CurvedGrid
        cards={cards}
        onFrame={(draw) =>
          samples.current.push({ at: performance.now(), draw })
        }
      />
      <output
        data-testid="frame-meter"
        className="meta glass fixed top-3 left-3 z-10 rounded-md px-2 py-1 text-fg"
      >
        {stats.fps} fps · draw {stats.draw.toFixed(1)} ms · p95{" "}
        {stats.p95.toFixed(1)} ms
      </output>
    </>
  );
}
