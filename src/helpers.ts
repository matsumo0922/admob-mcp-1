export interface DateObj {
  year: number;
  month: number;
  day: number;
}

export function daysAgo(n: number): DateObj {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

export function today(): DateObj {
  return daysAgo(0);
}

export function yesterday(): DateObj {
  return daysAgo(1);
}

/** Parse rows from AdMob API streaming response (array of header/row/footer objects). */
export function parseReportRows(response: unknown): Array<Record<string, string>> {
  const items = Array.isArray(response) ? response : [response];
  const rows: Array<Record<string, string>> = [];

  for (const item of items) {
    const row = (item as any)?.row;
    if (!row) continue;

    const parsed: Record<string, string> = {};

    if (row.dimensionValues) {
      for (const [key, val] of Object.entries(row.dimensionValues)) {
        const v = val as any;
        parsed[key] = v.displayLabel || v.value || "";
      }
    }

    if (row.metricValues) {
      for (const [key, val] of Object.entries(row.metricValues)) {
        const v = val as any;
        const raw = v.integerValue ?? v.doubleValue ?? v.microsValue ?? v.value ?? "";
        parsed[key] = String(raw);
      }
    }

    rows.push(parsed);
  }

  return rows;
}

/** Convert micros string to dollar amount. */
export function microsToDollars(micros: string | number): string {
  const num = typeof micros === "string" ? parseInt(micros, 10) : micros;
  if (isNaN(num)) return "$0.00";
  return `$${(num / 1_000_000).toFixed(2)}`;
}

/** Format a parsed report as a readable table string. */
export function formatReportTable(
  rows: Array<Record<string, string>>,
  options?: {
    earningsKeys?: string[];
    title?: string;
  }
): string {
  if (rows.length === 0) return options?.title ? `${options.title}\n\nNo data found.` : "No data found.";

  const earningsKeys = options?.earningsKeys || ["ESTIMATED_EARNINGS", "OBSERVED_ECPM", "IMPRESSION_RPM"];

  // Format earnings columns as dollars
  const formatted = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = earningsKeys.includes(k) ? microsToDollars(v) : v;
    }
    return out;
  });

  const keys = Object.keys(formatted[0]);

  // Calculate column widths
  const widths: Record<string, number> = {};
  for (const k of keys) {
    widths[k] = Math.max(k.length, ...formatted.map((r) => (r[k] || "").length));
  }

  const header = keys.map((k) => k.padEnd(widths[k])).join(" | ");
  const separator = keys.map((k) => "-".repeat(widths[k])).join("-+-");
  const body = formatted
    .map((row) => keys.map((k) => (row[k] || "").padEnd(widths[k])).join(" | "))
    .join("\n");

  const table = `${header}\n${separator}\n${body}`;
  return options?.title ? `${options.title}\n\n${table}` : table;
}

/** Compute % change between two numeric strings. */
export function pctChange(prev: string | number, curr: string | number): string {
  const p = typeof prev === "string" ? parseFloat(prev) : prev;
  const c = typeof curr === "string" ? parseFloat(curr) : curr;
  if (isNaN(p) || isNaN(c) || p === 0) return "N/A";
  const pct = ((c - p) / Math.abs(p)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Add period-over-period change columns to time-series rows. */
export function addPeriodChanges(
  rows: Array<Record<string, string>>,
  metricKeys: string[]
): void {
  for (let i = rows.length - 1; i >= 1; i--) {
    for (const key of metricKeys) {
      rows[i][`${key}_CHANGE`] = pctChange(rows[i - 1][key], rows[i][key]);
    }
  }
  if (rows.length > 0) {
    for (const key of metricKeys) {
      rows[0][`${key}_CHANGE`] = "-";
    }
  }
}
