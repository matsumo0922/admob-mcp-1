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
        // AdMob MetricValue uses a different field per value type:
        //   - microsValue: currency amounts, eCPM, RPM (in account-currency micros) -> divide by 1,000,000
        //   - integerValue: counts such as impressions and requests
        //   - doubleValue: ratios such as match rate and CTR (0..1)
        // Treating every metric as micros rounds ratios down to 0 and corrupts magnitudes.
        if (v.microsValue != null) {
          parsed[key] = String(Number(v.microsValue) / 1_000_000);
        } else if (v.integerValue != null) {
          parsed[key] = String(v.integerValue);
        } else if (v.doubleValue != null) {
          parsed[key] = String(v.doubleValue);
        } else {
          parsed[key] = String(v.value ?? "");
        }
      }
    }

    rows.push(parsed);
  }

  return rows;
}

/** Display symbol per currency code. Unknown codes fall back to using the code itself as a prefix. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  AUD: "A$",
  CAD: "C$",
  BRL: "R$",
  KRW: "₩",
  MXN: "$",
  SEK: "kr ",
  PLN: "zł ",
};

/** Currency codes whose smallest unit is an integer (no decimal places). */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

/**
 * Format a numeric value as a currency string.
 * Falls back to `$` when currencyCode is omitted, for backward compatibility.
 */
export function formatCurrency(value: string | number, currencyCode?: string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  const code = currencyCode?.toUpperCase();
  const symbol = (code && CURRENCY_SYMBOLS[code]) || (code ? `${code} ` : "$");
  if (isNaN(num)) return `${symbol}0`;
  const fractionDigits = code && ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2;
  return `${symbol}${num.toFixed(fractionDigits)}`;
}

/** Extract the account currency code from an AdMob report response header. */
export function extractCurrencyCode(response: unknown): string | undefined {
  const items = Array.isArray(response) ? response : [response];
  for (const item of items) {
    const code = (item as any)?.header?.localizationSettings?.currencyCode;
    if (code) return String(code);
  }
  return undefined;
}

/** Format a parsed report as a readable table string. */
export function formatReportTable(
  rows: Array<Record<string, string>>,
  options?: {
    earningsKeys?: string[];
    title?: string;
    currency?: string;
  }
): string {
  if (rows.length === 0) return options?.title ? `${options.title}\n\nNo data found.` : "No data found.";

  const earningsKeys = options?.earningsKeys || ["ESTIMATED_EARNINGS", "OBSERVED_ECPM", "IMPRESSION_RPM"];

  // Format currency / eCPM / RPM columns in the account currency (rows are already real numbers from parseReportRows)
  const formatted = rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = earningsKeys.includes(k) ? formatCurrency(v, options?.currency) : v;
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
