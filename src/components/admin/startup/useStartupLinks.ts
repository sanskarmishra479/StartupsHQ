"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type ApiResult, adminApi } from "@/lib/admin-api";
import type { AdminRecord } from "@/types/admin";
import {
  type BatchLink,
  EMPTY_LINKS,
  type FounderLink,
  type IndustryLink,
  type InvestorLink,
  linksFromRecord,
  type RoundDraft,
  type StartupLinks,
  withPrimary,
} from "./links";

let temporary = 0;
const tempId = () => `new-${++temporary}`;

/**
 * A startup's links. Before the first save they live in the form and go out nested in
 * POST /startups, one transaction. Once the startup exists each change is its own call to the
 * §8.3 sub-resources, applied at once and audited, and the page reloads its record.
 */
export function useStartupLinks(record: AdminRecord | null) {
  const router = useRouter();
  const [local, setLocal] = useState<StartupLinks>(EMPTY_LINKS);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const saved = record !== null;
  const links = saved ? linksFromRecord(record.links) : local;
  const base = saved ? `/api/v1/startups/${record.id}` : "";

  async function call(
    run: () => Promise<ApiResult<unknown>>,
  ): Promise<boolean> {
    setPending(true);
    setError(null);
    const result = await run();
    setPending(false);
    if (!result.ok) {
      const detail = result.details.map((issue) => issue.message).join(" ");
      setError(
        result.status === 409
          ? "That link already exists."
          : detail || result.message,
      );
      return false;
    }
    router.refresh();
    return true;
  }

  return {
    links,
    error,
    pending,
    clearError: () => setError(null),

    setIndustries: async (next: readonly IndustryLink[]) => {
      const industries = withPrimary(next);
      if (!saved) {
        setLocal((current) => ({ ...current, industries }));
        return true;
      }
      return call(() =>
        adminApi("PUT", `${base}/industries`, {
          industries: industries.map(({ id, isPrimary }) => ({
            id,
            isPrimary,
          })),
        }),
      );
    },

    addFounder: async (founder: Omit<FounderLink, "linkId">) => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          founders: [...current.founders, { ...founder, linkId: tempId() }],
        }));
        return true;
      }
      return call(() =>
        adminApi("POST", `${base}/founders`, {
          founderId: founder.founderId,
          role: founder.role,
          isCurrent: founder.isCurrent,
          ...(founder.joinedYear !== null
            ? { joinedYear: founder.joinedYear }
            : {}),
          ...(founder.leftYear !== null ? { leftYear: founder.leftYear } : {}),
          ...(founder.sourceUrl ? { sourceUrl: founder.sourceUrl } : {}),
          sortOrder: links.founders.length,
        }),
      );
    },

    removeFounder: async (linkId: string) => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          founders: current.founders.filter(
            (founder) => founder.linkId !== linkId,
          ),
        }));
        return true;
      }
      return call(() => adminApi("DELETE", `${base}/founders/${linkId}`));
    },

    addInvestor: async (investor: Omit<InvestorLink, "linkId" | "roundId">) => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          investors: [
            ...current.investors,
            { ...investor, roundId: null, linkId: tempId() },
          ],
        }));
        return true;
      }
      return call(() =>
        adminApi("POST", `${base}/investors`, {
          investorId: investor.investorId,
          isLead: investor.isLead,
        }),
      );
    },

    removeInvestor: async (linkId: string) => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          investors: current.investors.filter(
            (investor) => investor.linkId !== linkId,
          ),
        }));
        return true;
      }
      return call(() => adminApi("DELETE", `${base}/investors/${linkId}`));
    },

    addBatch: async (batch: BatchLink) => {
      if (!saved) {
        setLocal((current) =>
          current.batches.some((existing) => existing.batchId === batch.batchId)
            ? current
            : { ...current, batches: [...current.batches, batch] },
        );
        return true;
      }
      return call(() =>
        adminApi("POST", `${base}/batches`, { batchId: batch.batchId }),
      );
    },

    removeBatch: async (batchId: string) => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          batches: current.batches.filter((batch) => batch.batchId !== batchId),
        }));
        return true;
      }
      return call(() => adminApi("DELETE", `${base}/batches/${batchId}`));
    },

    /**
     * Adds a round. Unsaved startups keep it for their create; saved ones POST /rounds at once, and
     * the result is returned so the dialog can ask an admin for a manual rate when needed.
     */
    addRound: async (
      round: Omit<RoundDraft, "id" | "saved">,
    ): Promise<ApiResult<unknown>> => {
      if (!saved) {
        setLocal((current) => ({
          ...current,
          rounds: [...current.rounds, { ...round, id: tempId(), saved: false }],
        }));
        return { ok: true, status: 200, data: null };
      }
      setPending(true);
      const result = await adminApi("POST", "/api/v1/rounds", {
        ...round.body,
        startupId: record.id,
        ...(round.participants.length > 0
          ? {
              investors: round.participants.map(({ investorId, isLead }) => ({
                investorId,
                isLead,
              })),
            }
          : {}),
      });
      setPending(false);
      if (result.ok) router.refresh();
      return result;
    },

    removeUnsavedRound: (id: string) =>
      setLocal((current) => ({
        ...current,
        rounds: current.rounds.filter((round) => round.id !== id),
      })),
  };
}

export type StartupLinksApi = ReturnType<typeof useStartupLinks>;
