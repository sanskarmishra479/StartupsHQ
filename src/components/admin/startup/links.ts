import type { RecordStatus } from "@/types/admin";

// A startup's links as AdminRecord.links carries them (docs/API.md §7.10), and as a new startup's
// form holds them before the first save. Client-safe.

export type IndustryLink = Readonly<{
  id: string;
  name: string;
  isPrimary: boolean;
}>;

export type FounderLink = Readonly<{
  /** The stint's id once saved; a temporary key before. */
  linkId: string;
  founderId: string;
  fullName: string;
  status: RecordStatus;
  role: string;
  isCurrent: boolean;
  joinedYear: number | null;
  leftYear: number | null;
  sourceUrl: string | null;
}>;

export type InvestorLink = Readonly<{
  linkId: string;
  investorId: string;
  name: string;
  status: RecordStatus;
  roundId: string | null;
  isLead: boolean;
}>;

export type BatchLink = Readonly<{
  batchId: string;
  name: string;
  status: RecordStatus;
}>;

export type RoundParticipant = Readonly<{
  investorId: string;
  name: string;
  isLead: boolean;
}>;

export type RoundDraft = Readonly<{
  /** Saved rounds carry their id; unsaved ones a temporary key. */
  id: string;
  saved: boolean;
  status: RecordStatus;
  roundType: string;
  announcedOn: string;
  isUndisclosed: boolean;
  currency: string;
  amountOriginal: string | null;
  amountUsd: number | null;
  sourceUrl: string;
  /** Unsaved rounds only: the body POST /startups nests. */
  body?: Record<string, unknown>;
  participants: readonly RoundParticipant[];
}>;

export type StartupLinks = Readonly<{
  industries: readonly IndustryLink[];
  founders: readonly FounderLink[];
  investors: readonly InvestorLink[];
  batches: readonly BatchLink[];
  rounds: readonly RoundDraft[];
}>;

export const EMPTY_LINKS: StartupLinks = {
  industries: [],
  founders: [],
  investors: [],
  batches: [],
  rounds: [],
};

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] =>
  Array.isArray(value) ? (value as Row[]) : [];
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : null);
const status = (value: unknown): RecordStatus =>
  value === "published" || value === "archived" ? value : "draft";

/** Reads AdminRecord.links into the form's shapes. */
export function linksFromRecord(
  links: Readonly<Record<string, readonly unknown[]>> | undefined,
): StartupLinks {
  if (!links) return EMPTY_LINKS;
  const investorRows = rows(links.investors);
  return {
    industries: rows(links.industries).map((row) => ({
      id: str(row.id),
      name: str(row.name),
      isPrimary: row.isPrimary === true,
    })),
    founders: rows(links.founders).map((row) => ({
      linkId: str(row.linkId),
      founderId: str(row.founderId),
      fullName: str(row.fullName),
      status: status(row.status),
      role: str(row.role),
      isCurrent: row.isCurrent === true,
      joinedYear: num(row.joinedYear),
      leftYear: num(row.leftYear),
      sourceUrl: typeof row.sourceUrl === "string" ? row.sourceUrl : null,
    })),
    investors: investorRows.map((row) => ({
      linkId: str(row.linkId),
      investorId: str(row.investorId),
      name: str(row.name),
      status: status(row.status),
      roundId: typeof row.roundId === "string" ? row.roundId : null,
      isLead: row.isLead === true,
    })),
    batches: rows(links.batches).map((row) => ({
      batchId: str(row.batchId),
      name: `${str(row.programName)} ${str(row.label)}`.trim(),
      status: status(row.status),
    })),
    rounds: rows(links.rounds).map((row) => ({
      id: str(row.id),
      saved: true,
      status: status(row.status),
      roundType: str(row.roundType),
      announcedOn: str(row.announcedOn),
      isUndisclosed: row.isUndisclosed === true,
      currency: str(row.currency) || "USD",
      amountOriginal: null,
      amountUsd: num(row.amountUsd),
      sourceUrl: "",
      participants: investorRows
        .filter((investor) => investor.roundId === row.id)
        .map((investor) => ({
          investorId: str(investor.investorId),
          name: str(investor.name),
          isLead: investor.isLead === true,
        })),
    })),
  };
}

/** The nested relations POST /startups accepts (docs/API.md §8.1), from an unsaved form. */
export function createBodyFromLinks(
  links: StartupLinks,
): Record<string, unknown> {
  return {
    ...(links.industries.length > 0
      ? {
          industries: links.industries.map((industry) => ({
            id: industry.id,
            isPrimary: industry.isPrimary,
          })),
        }
      : {}),
    ...(links.founders.length > 0
      ? {
          founders: links.founders.map((founder, index) => ({
            founderId: founder.founderId,
            role: founder.role,
            isCurrent: founder.isCurrent,
            ...(founder.joinedYear !== null
              ? { joinedYear: founder.joinedYear }
              : {}),
            ...(founder.leftYear !== null
              ? { leftYear: founder.leftYear }
              : {}),
            ...(founder.sourceUrl ? { sourceUrl: founder.sourceUrl } : {}),
            sortOrder: index,
          })),
        }
      : {}),
    ...(links.investors.length > 0
      ? {
          investors: links.investors.map((investor) => ({
            investorId: investor.investorId,
            isLead: investor.isLead,
          })),
        }
      : {}),
    ...(links.batches.length > 0
      ? { batchIds: links.batches.map((batch) => batch.batchId) }
      : {}),
    ...(links.rounds.length > 0
      ? {
          rounds: links.rounds.map((round) => ({
            ...round.body,
            ...(round.participants.length > 0
              ? {
                  investors: round.participants.map((participant) => ({
                    investorId: participant.investorId,
                    isLead: participant.isLead,
                  })),
                }
              : {}),
          })),
        }
      : {}),
  };
}

/** Exactly one primary industry whenever there are any: the first chosen, unless one is marked. */
export function withPrimary(
  industries: readonly IndustryLink[],
): IndustryLink[] {
  if (industries.length === 0) return [];
  const primary = industries.findIndex((industry) => industry.isPrimary);
  const chosen = primary === -1 ? 0 : primary;
  return industries.map((industry, index) => ({
    ...industry,
    isPrimary: index === chosen,
  }));
}

/** Linked records still in draft, which a published startup page would not show. */
export function linkedDrafts(links: StartupLinks): {
  entity: "founder" | "investor" | "batch" | "round";
  id: string;
}[] {
  const seen = new Set<string>();
  const drafts: {
    entity: "founder" | "investor" | "batch" | "round";
    id: string;
  }[] = [];
  const add = (
    entity: "founder" | "investor" | "batch" | "round",
    id: string,
  ) => {
    if (seen.has(`${entity}:${id}`)) return;
    seen.add(`${entity}:${id}`);
    drafts.push({ entity, id });
  };
  for (const founder of links.founders) {
    if (founder.status === "draft") add("founder", founder.founderId);
  }
  for (const investor of links.investors) {
    if (investor.status === "draft") add("investor", investor.investorId);
  }
  for (const batch of links.batches) {
    if (batch.status === "draft") add("batch", batch.batchId);
  }
  for (const round of links.rounds) {
    if (round.saved && round.status === "draft") add("round", round.id);
  }
  return drafts;
}
