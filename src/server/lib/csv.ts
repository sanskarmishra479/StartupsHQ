import "server-only";

import Papa from "papaparse";

// CSV parsing and writing for the bulk importer (FR-402, SEC-07).
//
// Values are stored exactly as they arrive. Neutralisation of formula prefixes happens **only on
// export**: a cell like `=HYPERLINK(...)` is data we must keep faithfully, and it becomes
// dangerous only when a spreadsheet opens our CSV and evaluates it.

export type CsvRow = Readonly<Record<string, string>>;

export type ParsedCsv = Readonly<{
  rows: CsvRow[];
  /** Header or shape problems, in the order the parser found them. */
  problems: string[];
}>;

/** Header names are matched case-insensitively and without spaces or underscores. */
const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

export function parseCsv(text: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    // Every value stays a string; the row schema decides what each one means.
    dynamicTyping: false,
  });

  const problems = parsed.errors
    .slice(0, 20)
    .map((error) =>
      error.row === undefined
        ? error.message
        : `Row ${error.row + 1}: ${error.message}`,
    );

  const rows = parsed.data.map((row) => {
    const trimmed: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "string") trimmed[key] = value.trim();
    }
    return trimmed;
  });

  return { rows, problems };
}

/**
 * A leading `=`, `+`, `-`, `@`, tab or carriage return makes a spreadsheet treat a cell as a
 * formula, so exports prefix those with an apostrophe (SEC-07). Nothing else is altered.
 */
export function neutralizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** Writes a CSV whose cells are safe to open in a spreadsheet. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const lines = [headers.map(quote).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => quote(neutralizeCell(cell))).join(","));
  }
  // CRLF: what spreadsheets expect, and what RFC 4180 specifies.
  return `${lines.join("\r\n")}\r\n`;
}
