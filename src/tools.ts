import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { AdMobClient } from "./admob-client.js";
import {
  daysAgo,
  yesterday,
  parseReportRows,
  formatReportTable,
  pctChange,
  addPeriodChanges,
} from "./helpers.js";

function formatResult(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

// Date schema reusable across tools
const DateSchema = z.object({
  year: z.coerce.number().describe("Year (e.g. 2024)"),
  month: z.coerce.number().min(1).max(12).describe("Month (1-12)"),
  day: z.coerce.number().min(1).max(31).describe("Day (1-31)"),
});

const DimensionFilterSchema = z.object({
  dimension: z.string().describe("Dimension to filter on"),
  values: z.array(z.string()).describe("Values to match"),
});

const SortConditionSchema = z.object({
  order: z.enum(["ASCENDING", "DESCENDING"]).optional().describe("Sort order"),
  dimension: z.string().optional().describe("Dimension to sort by"),
  metric: z.string().optional().describe("Metric to sort by"),
});

export function registerTools(
  server: McpServer,
  getClient: () => Promise<AdMobClient>,
): void {
  // --- Tools ---

  server.tool(
    "list_accounts",
    "List AdMob publisher accounts",
    {},
    async () => {
      const client = await getClient();
      const result = await client.listAccounts();
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "get_account",
    "Get details for a specific AdMob account",
    {
      account_id: z
        .string()
        .describe('AdMob account ID (e.g. "pub-1234567890123456")'),
    },
    async ({ account_id }) => {
      const client = await getClient();
      const result = await client.getAccount(account_id);
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "list_ad_units",
    "List ad units for an AdMob account",
    {
      account_id: z.string().describe("AdMob account ID"),
      page_size: z
        .number()
        .optional()
        .describe("Max number of ad units to return (max 10000)"),
      page_token: z.string().optional().describe("Page token for pagination"),
    },
    async ({ account_id, page_size, page_token }) => {
      const client = await getClient();
      const result = await client.listAdUnits(account_id, page_size, page_token);
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "list_apps",
    "List apps for an AdMob account",
    {
      account_id: z.string().describe("AdMob account ID"),
      page_size: z
        .number()
        .optional()
        .describe("Max number of apps to return (max 10000)"),
      page_token: z.string().optional().describe("Page token for pagination"),
    },
    async ({ account_id, page_size, page_token }) => {
      const client = await getClient();
      const result = await client.listApps(account_id, page_size, page_token);
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "generate_network_report",
    `Generate a network report for an AdMob account.

Available dimensions: DATE, MONTH, WEEK, AD_UNIT, APP, AD_TYPE, COUNTRY, FORMAT, PLATFORM, MOBILE_OS_VERSION, GMA_SDK_VERSION, APP_VERSION_NAME, SERVING_RESTRICTION
Note: Only one time dimension (DATE, MONTH, or WEEK) per request. AD_TYPE is incompatible with AD_REQUESTS, MATCH_RATE, IMPRESSION_RPM metrics.

Available metrics: AD_REQUESTS, CLICKS, ESTIMATED_EARNINGS, IMPRESSIONS, IMPRESSION_CTR, IMPRESSION_RPM, MATCHED_REQUESTS, MATCH_RATE, SHOW_RATE
Note: ESTIMATED_EARNINGS is in micros (divide by 1,000,000 for actual currency).`,
    {
      account_id: z.string().describe("AdMob account ID"),
      start_date: DateSchema.describe("Report start date"),
      end_date: DateSchema.optional().describe(
        "Report end date (defaults to start_date if omitted)"
      ),
      dimensions: z
        .array(z.string())
        .optional()
        .describe("Dimensions to group by"),
      metrics: z
        .array(z.string())
        .optional()
        .describe(
          "Metrics to include (defaults to IMPRESSIONS, CLICKS, ESTIMATED_EARNINGS)"
        ),
      dimension_filters: z
        .array(DimensionFilterSchema)
        .optional()
        .describe("Filters to apply"),
      sort_conditions: z
        .array(SortConditionSchema)
        .optional()
        .describe("Sort conditions"),
      max_report_rows: z.coerce.number().optional().describe("Max rows (1-100000)"),
      time_zone: z.string().optional().describe("IANA timezone"),
      currency_code: z
        .string()
        .optional()
        .describe("ISO 4217 currency code (e.g. USD)"),
    },
    async ({
      account_id,
      start_date,
      end_date,
      dimensions,
      metrics,
      dimension_filters,
      sort_conditions,
      max_report_rows,
      time_zone,
      currency_code,
    }) => {
      const client = await getClient();

      const reportSpec: Record<string, unknown> = {
        dateRange: {
          startDate: start_date,
          endDate: end_date || start_date,
        },
        metrics: metrics || ["IMPRESSIONS", "CLICKS", "ESTIMATED_EARNINGS"],
      };

      if (dimensions) reportSpec.dimensions = dimensions;
      if (dimension_filters) {
        reportSpec.dimensionFilters = dimension_filters.map((f) => ({
          dimension: f.dimension,
          matchesAny: { values: f.values },
        }));
      }
      if (sort_conditions) reportSpec.sortConditions = sort_conditions;
      if (max_report_rows) reportSpec.maxReportRows = max_report_rows;
      if (time_zone) reportSpec.timeZone = time_zone;
      if (currency_code) {
        reportSpec.localizationSettings = { currencyCode: currency_code };
      }

      const result = await client.generateNetworkReport(
        account_id,
        reportSpec as any
      );
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  server.tool(
    "generate_mediation_report",
    `Generate a mediation report for an AdMob account.

Available dimensions: DATE, MONTH, WEEK, AD_SOURCE, AD_SOURCE_INSTANCE, AD_UNIT, APP, MEDIATION_GROUP, COUNTRY, FORMAT, PLATFORM, MOBILE_OS_VERSION, GMA_SDK_VERSION, APP_VERSION_NAME, SERVING_RESTRICTION
Note: Only one time dimension (DATE, MONTH, or WEEK) per request.

Available metrics: AD_REQUESTS, CLICKS, ESTIMATED_EARNINGS, IMPRESSIONS, IMPRESSION_CTR, MATCHED_REQUESTS, MATCH_RATE, OBSERVED_ECPM
Note: ESTIMATED_EARNINGS and OBSERVED_ECPM are in micros (divide by 1,000,000).`,
    {
      account_id: z.string().describe("AdMob account ID"),
      start_date: DateSchema.describe("Report start date"),
      end_date: DateSchema.optional().describe(
        "Report end date (defaults to start_date if omitted)"
      ),
      dimensions: z
        .array(z.string())
        .optional()
        .describe("Dimensions to group by"),
      metrics: z
        .array(z.string())
        .optional()
        .describe(
          "Metrics to include (defaults to IMPRESSIONS, CLICKS, ESTIMATED_EARNINGS)"
        ),
      dimension_filters: z
        .array(DimensionFilterSchema)
        .optional()
        .describe("Filters to apply"),
      sort_conditions: z
        .array(SortConditionSchema)
        .optional()
        .describe("Sort conditions"),
      max_report_rows: z.coerce.number().optional().describe("Max rows (1-100000)"),
      time_zone: z.string().optional().describe("IANA timezone"),
      currency_code: z
        .string()
        .optional()
        .describe("ISO 4217 currency code (e.g. USD)"),
    },
    async ({
      account_id,
      start_date,
      end_date,
      dimensions,
      metrics,
      dimension_filters,
      sort_conditions,
      max_report_rows,
      time_zone,
      currency_code,
    }) => {
      const client = await getClient();

      const reportSpec: Record<string, unknown> = {
        dateRange: {
          startDate: start_date,
          endDate: end_date || start_date,
        },
        metrics: metrics || ["IMPRESSIONS", "CLICKS", "ESTIMATED_EARNINGS"],
      };

      if (dimensions) reportSpec.dimensions = dimensions;
      if (dimension_filters) {
        reportSpec.dimensionFilters = dimension_filters.map((f) => ({
          dimension: f.dimension,
          matchesAny: { values: f.values },
        }));
      }
      if (sort_conditions) reportSpec.sortConditions = sort_conditions;
      if (max_report_rows) reportSpec.maxReportRows = max_report_rows;
      if (time_zone) reportSpec.timeZone = time_zone;
      if (currency_code) {
        reportSpec.localizationSettings = { currencyCode: currency_code };
      }

      const result = await client.generateMediationReport(
        account_id,
        reportSpec as any
      );
      return { content: [{ type: "text", text: formatResult(result) }] };
    }
  );

  // --- High-Level Optimizer Tools ---

  server.tool(
    "revenue_trend",
    "Show daily revenue trend over a recent period. Use for: 'Show my revenue trend for the last 30 days'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Number of days to look back (default 30)"),
    },
    async ({ account_id, days }) => {
      const n = days || 30;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["DATE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Revenue Trend (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "ad_unit_performance",
    "Compare all ad units by key metrics to find underperformers. Use for: 'Which ad units are underperforming?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["AD_UNIT"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_CTR", "IMPRESSION_RPM", "SHOW_RATE", "MATCH_RATE"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Ad Unit Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "country_breakdown",
    "Break down earnings by country. Use for: 'Break down my earnings by country'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
      top_n: z.coerce.number().optional().describe("Number of top countries to return (default 20)"),
    },
    async ({ account_id, days, top_n }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["COUNTRY"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        maxReportRows: top_n || 20,
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Top Countries by Revenue (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "format_comparison",
    "Compare performance across ad formats (banner, interstitial, rewarded, native). Use for: 'Compare performance across ad formats'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["FORMAT"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_CTR", "CLICKS", "SHOW_RATE"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Ad Format Comparison (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "platform_comparison",
    "Compare iOS vs Android performance. Use for: 'How is iOS vs Android performing?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["PLATFORM"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR", "MATCH_RATE"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Platform Comparison (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "fill_rate_analysis",
    "Analyze fill rate and match rate by ad unit to find where you're losing impressions. Use for: 'What's my fill rate and where am I losing money?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["AD_UNIT"],
        metrics: ["AD_REQUESTS", "MATCHED_REQUESTS", "MATCH_RATE", "IMPRESSIONS", "SHOW_RATE", "ESTIMATED_EARNINGS"],
        sortConditions: [{ metric: "MATCH_RATE", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Fill Rate Analysis by Ad Unit (last ${n} days) — sorted worst first` }) }],
      };
    }
  );

  server.tool(
    "mediation_ad_source_performance",
    "Compare mediation ad source performance (AdMob Network, Meta, Unity, etc). Use for: 'Which mediation ad sources perform best?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateMediationReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["AD_SOURCE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_CTR", "MATCHED_REQUESTS", "MATCH_RATE", "OBSERVED_ECPM"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Mediation Ad Source Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "wow_revenue",
    "Show week-over-week revenue comparison. Use for: 'Show week-over-week revenue changes'",
    {
      account_id: z.string().describe("AdMob account ID"),
      weeks: z.coerce.number().optional().describe("Number of weeks to show (default 8)"),
    },
    async ({ account_id, weeks }) => {
      const n = weeks || 8;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n * 7), endDate: yesterday() },
        dimensions: ["WEEK"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "AD_REQUESTS"],
        sortConditions: [{ dimension: "WEEK", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      // Add WoW change column for earnings
      for (let i = 1; i < rows.length; i++) {
        const prev = parseInt(rows[i - 1].ESTIMATED_EARNINGS || "0", 10);
        const curr = parseInt(rows[i].ESTIMATED_EARNINGS || "0", 10);
        if (prev > 0) {
          const pct = ((curr - prev) / prev) * 100;
          rows[i]["EARNINGS_WOW_CHANGE"] = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
        } else {
          rows[i]["EARNINGS_WOW_CHANGE"] = "N/A";
        }
      }
      if (rows.length > 0) rows[0]["EARNINGS_WOW_CHANGE"] = "-";

      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Week-over-Week Revenue (last ${n} weeks)` }) }],
      };
    }
  );

  server.tool(
    "top_apps",
    "Rank apps by revenue. Use for: 'Which apps are my top earners?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
      top_n: z.coerce.number().optional().describe("Number of top apps (default 10)"),
    },
    async ({ account_id, days, top_n }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["APP"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        maxReportRows: top_n || 10,
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Top Apps by Revenue (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "ecpm_trend",
    "Show eCPM trends over time, optionally broken down by ad unit. Use for: 'Show my eCPM trends by ad unit over time'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 14)"),
      by_ad_unit: z.boolean().optional().describe("Break down by ad unit (default false)"),
    },
    async ({ account_id, days, by_ad_unit }) => {
      const n = days || 14;
      const dimensions = by_ad_unit ? ["DATE", "AD_UNIT"] : ["DATE"];
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions,
        metrics: ["IMPRESSION_RPM", "ESTIMATED_EARNINGS", "IMPRESSIONS"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `eCPM Trend (last ${n} days)${by_ad_unit ? " by Ad Unit" : ""}` }) }],
      };
    }
  );

  // --- Advanced Revenue Optimization Tools ---

  server.tool(
    "revenue_drop_diagnosis",
    "Diagnose a revenue drop by comparing two periods across multiple dimensions. Use for: 'My revenue dropped this week, what happened?', 'Why did my earnings go down?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Length of each period in days (default 7). Compares the last N days vs the N days before that."),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();

      // Fetch two periods: recent and previous
      const [recentByFormat, prevByFormat, recentByCountry, prevByCountry, recentByPlatform, prevByPlatform] =
        await Promise.all([
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n), endDate: yesterday() },
            dimensions: ["FORMAT"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "MATCH_RATE"],
            sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
          } as any),
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n * 2), endDate: daysAgo(n + 1) },
            dimensions: ["FORMAT"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "MATCH_RATE"],
            sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
          } as any),
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n), endDate: yesterday() },
            dimensions: ["COUNTRY"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM"],
            sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
            maxReportRows: 10,
          } as any),
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n * 2), endDate: daysAgo(n + 1) },
            dimensions: ["COUNTRY"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM"],
            sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
            maxReportRows: 10,
          } as any),
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n), endDate: yesterday() },
            dimensions: ["PLATFORM"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "MATCH_RATE"],
          } as any),
          client.generateNetworkReport(account_id, {
            dateRange: { startDate: daysAgo(n * 2), endDate: daysAgo(n + 1) },
            dimensions: ["PLATFORM"],
            metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "MATCH_RATE"],
          } as any),
        ]);

      function comparePeriods(recentData: unknown, prevData: unknown, dimKey: string): Array<Record<string, string>> {
        const recent = parseReportRows(recentData);
        const prev = parseReportRows(prevData);
        const prevMap = new Map(prev.map((r) => [r[dimKey], r]));
        return recent.map((r) => {
          const p = prevMap.get(r[dimKey]);
          const out: Record<string, string> = { [dimKey]: r[dimKey] };
          for (const [k, v] of Object.entries(r)) {
            if (k === dimKey) continue;
            out[`${k}_NOW`] = v;
            out[`${k}_PREV`] = p?.[k] || "0";
            out[`${k}_CHG`] = pctChange(p?.[k] || "0", v);
          }
          return out;
        });
      }

      const sections = [
        formatReportTable(comparePeriods(recentByFormat, prevByFormat, "FORMAT"), {
          title: `By Format (last ${n}d vs prior ${n}d)`,
        }),
        formatReportTable(comparePeriods(recentByCountry, prevByCountry, "COUNTRY"), {
          title: `By Country — Top 10 (last ${n}d vs prior ${n}d)`,
        }),
        formatReportTable(comparePeriods(recentByPlatform, prevByPlatform, "PLATFORM"), {
          title: `By Platform (last ${n}d vs prior ${n}d)`,
        }),
      ];

      return {
        content: [{
          type: "text",
          text: `Revenue Drop Diagnosis\n${"=".repeat(60)}\n\n${sections.join("\n\n")}`,
        }],
      };
    }
  );

  server.tool(
    "serving_restriction_impact",
    "Measure revenue impact of ad serving restrictions (non-personalized ads due to privacy regulations like GDPR/CCPA). Use for: 'How much revenue am I losing to privacy restrictions?', 'What is the GDPR impact on my ads?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["SERVING_RESTRICTION"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR", "AD_REQUESTS"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      // Calculate share of total for each restriction type
      const totalEarnings = rows.reduce((s, r) => s + parseInt(r.ESTIMATED_EARNINGS || "0", 10), 0);
      const totalImpressions = rows.reduce((s, r) => s + parseInt(r.IMPRESSIONS || "0", 10), 0);
      for (const row of rows) {
        const e = parseInt(row.ESTIMATED_EARNINGS || "0", 10);
        const i = parseInt(row.IMPRESSIONS || "0", 10);
        row["REVENUE_%"] = totalEarnings > 0 ? `${((e / totalEarnings) * 100).toFixed(1)}%` : "0%";
        row["IMPRESSION_%"] = totalImpressions > 0 ? `${((i / totalImpressions) * 100).toFixed(1)}%` : "0%";
      }

      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Serving Restriction Impact (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "app_version_impact",
    "Compare ad performance across app versions to see if a release helped or hurt revenue. Use for: 'Did my latest app update affect ad revenue?', 'Compare ad revenue across app versions'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 14)"),
      app_id: z.string().optional().describe("Filter to a specific app ID"),
    },
    async ({ account_id, days, app_id }) => {
      const n = days || 14;
      const client = await getClient();
      const spec: any = {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["APP_VERSION_NAME"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR", "SHOW_RATE"],
        sortConditions: [{ metric: "IMPRESSIONS", order: "DESCENDING" }],
        maxReportRows: 20,
      };
      if (app_id) {
        spec.dimensionFilters = [{ dimension: "APP", matchesAny: { values: [app_id] } }];
      }
      const result = await client.generateNetworkReport(account_id, spec);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `App Version Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "sdk_version_check",
    "Check if older GMA SDK versions are hurting ad performance. Use for: 'Are users on old SDK versions seeing lower eCPM?', 'Check SDK version performance'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["GMA_SDK_VERSION"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "MATCH_RATE", "SHOW_RATE"],
        sortConditions: [{ metric: "IMPRESSIONS", order: "DESCENDING" }],
        maxReportRows: 15,
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `GMA SDK Version Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "month_over_month",
    "Compare this month's performance to last month. Use for: 'How is this month comparing to last month?', 'Month-over-month revenue comparison'",
    {
      account_id: z.string().describe("AdMob account ID"),
      months: z.coerce.number().optional().describe("Number of months to show (default 6)"),
    },
    async ({ account_id, months }) => {
      const n = months || 6;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n * 31), endDate: yesterday() },
        dimensions: ["MONTH"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
        sortConditions: [{ dimension: "MONTH", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      addPeriodChanges(rows, ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM"]);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Month-over-Month Performance (last ${n} months)` }) }],
      };
    }
  );

  server.tool(
    "high_impression_low_ctr",
    "Find ad units with high impressions but low CTR — potential optimization targets. Use for: 'Which ad units have wasted impressions?', 'Find ad placements I should optimize'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["AD_UNIT"],
        metrics: ["IMPRESSIONS", "CLICKS", "IMPRESSION_CTR", "ESTIMATED_EARNINGS", "IMPRESSION_RPM"],
        sortConditions: [{ metric: "IMPRESSIONS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      // Sort by CTR ascending so worst CTR (with significant impressions) come first
      rows.sort((a, b) => {
        const ctrA = parseFloat(a.IMPRESSION_CTR || "0");
        const ctrB = parseFloat(b.IMPRESSION_CTR || "0");
        return ctrA - ctrB;
      });

      return {
        content: [{
          type: "text",
          text: formatReportTable(rows, {
            title: `Ad Units Sorted by CTR — Lowest First (last ${n} days)\nThese high-impression, low-CTR units may benefit from placement or format changes.`,
          }),
        }],
      };
    }
  );

  server.tool(
    "os_version_performance",
    "Check ad performance by mobile OS version to find problem versions. Use for: 'Are certain OS versions hurting my ad revenue?', 'Check performance by iOS/Android version'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
      platform: z.enum(["ANDROID", "IOS"]).optional().describe("Filter to a specific platform"),
    },
    async ({ account_id, days, platform }) => {
      const n = days || 7;
      const client = await getClient();
      const spec: any = {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["MOBILE_OS_VERSION"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "MATCH_RATE", "SHOW_RATE"],
        sortConditions: [{ metric: "IMPRESSIONS", order: "DESCENDING" }],
        maxReportRows: 20,
      };
      if (platform) {
        spec.dimensionFilters = [{ dimension: "PLATFORM", matchesAny: { values: [platform] } }];
      }
      const result = await client.generateNetworkReport(account_id, spec);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `OS Version Performance (last ${n} days)${platform ? ` — ${platform} only` : ""}` }) }],
      };
    }
  );

  server.tool(
    "mediation_group_analysis",
    "Analyze performance by mediation group to find which waterfall/bidding groups need tuning. Use for: 'Which mediation groups need optimization?', 'Show mediation waterfall performance'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateMediationReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["MEDIATION_GROUP"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "MATCHED_REQUESTS", "MATCH_RATE", "OBSERVED_ECPM"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Mediation Group Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "country_ecpm_opportunity",
    "Find countries with high impression volume but low eCPM — potential for geo-targeted optimization. Use for: 'Where can I improve eCPM by country?', 'Find countries where I'm leaving money on the table'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["COUNTRY"],
        metrics: ["IMPRESSIONS", "IMPRESSION_RPM", "ESTIMATED_EARNINGS", "MATCH_RATE", "SHOW_RATE"],
        sortConditions: [{ metric: "IMPRESSIONS", order: "DESCENDING" }],
        maxReportRows: 30,
      } as any);
      const rows = parseReportRows(result);

      // Compute average eCPM across all rows
      const totalEarnings = rows.reduce((s, r) => s + parseInt(r.ESTIMATED_EARNINGS || "0", 10), 0);
      const totalImpressions = rows.reduce((s, r) => s + parseInt(r.IMPRESSIONS || "0", 10), 0);
      const avgEcpm = totalImpressions > 0 ? totalEarnings / totalImpressions * 1000 : 0;

      // Mark countries below average eCPM
      for (const row of rows) {
        const ecpm = parseInt(row.IMPRESSION_RPM || "0", 10) / 1_000_000;
        row["VS_AVG_ECPM"] = avgEcpm > 0
          ? `${((ecpm / avgEcpm - 1) * 100).toFixed(0)}%`
          : "N/A";
      }

      // Sort by impressions descending, but flag below-average eCPM
      rows.sort((a, b) => {
        const impA = parseInt(a.IMPRESSIONS || "0", 10);
        const impB = parseInt(b.IMPRESSIONS || "0", 10);
        const ecpmA = parseInt(a.IMPRESSION_RPM || "0", 10);
        const ecpmB = parseInt(b.IMPRESSION_RPM || "0", 10);
        // Prioritize: high impressions + low eCPM = biggest opportunity
        return (impB / (ecpmB || 1)) - (impA / (ecpmA || 1));
      });

      return {
        content: [{
          type: "text",
          text: formatReportTable(rows, {
            title: `Country eCPM Opportunity Analysis (last ${n} days)\nSorted by optimization opportunity (high volume + below-avg eCPM first)\nAvg eCPM: $${(avgEcpm / 1_000_000).toFixed(2)}`,
          }),
        }],
      };
    }
  );

  server.tool(
    "format_by_country",
    "Cross-reference ad format performance by country to find geo-specific format opportunities. Use for: 'Which ad formats work best in which countries?', 'Should I use different formats for different regions?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
      countries: z.array(z.string()).optional().describe("Filter to specific country codes (e.g. ['US','DE','JP']). Default: top 5 by revenue."),
    },
    async ({ account_id, days, countries }) => {
      const n = days || 7;
      const client = await getClient();
      const spec: any = {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["FORMAT", "COUNTRY"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        maxReportRows: 100,
      };
      if (countries && countries.length > 0) {
        spec.dimensionFilters = [{
          dimension: "COUNTRY",
          matchesAny: { values: countries },
        }];
      }
      const result = await client.generateNetworkReport(account_id, spec);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Format x Country Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "revenue_pacing",
    "Project end-of-month revenue based on current daily run rate vs last month. Use for: 'Am I on track to hit last month's revenue?', 'What's my projected revenue this month?'",
    {
      account_id: z.string().describe("AdMob account ID"),
    },
    async ({ account_id }) => {
      const client = await getClient();
      const now = new Date();
      const dayOfMonth = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const daysElapsed = dayOfMonth - 1; // completed days (yesterday is the last full day)

      // Current month so far
      const currentMonthStart = { year: now.getFullYear(), month: now.getMonth() + 1, day: 1 };
      const [currentResult, lastMonthResult] = await Promise.all([
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: currentMonthStart, endDate: yesterday() },
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM"],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: {
            startDate: { year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), month: now.getMonth() === 0 ? 12 : now.getMonth(), day: 1 },
            endDate: { year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(), month: now.getMonth() === 0 ? 12 : now.getMonth(), day: new Date(now.getFullYear(), now.getMonth(), 0).getDate() },
          },
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM"],
        } as any),
      ]);

      const currentRows = parseReportRows(currentResult);
      const lastMonthRows = parseReportRows(lastMonthResult);

      const currentEarnings = currentRows.reduce((s, r) => s + parseInt(r.ESTIMATED_EARNINGS || "0", 10), 0);
      const lastMonthEarnings = lastMonthRows.reduce((s, r) => s + parseInt(r.ESTIMATED_EARNINGS || "0", 10), 0);
      const currentImpressions = currentRows.reduce((s, r) => s + parseInt(r.IMPRESSIONS || "0", 10), 0);
      const lastMonthImpressions = lastMonthRows.reduce((s, r) => s + parseInt(r.IMPRESSIONS || "0", 10), 0);

      const dailyAvgEarnings = daysElapsed > 0 ? currentEarnings / daysElapsed : 0;
      const projectedEarnings = dailyAvgEarnings * daysInMonth;
      const dailyAvgImpressions = daysElapsed > 0 ? currentImpressions / daysElapsed : 0;
      const projectedImpressions = Math.round(dailyAvgImpressions * daysInMonth);

      const earningsPct = lastMonthEarnings > 0 ? ((projectedEarnings / lastMonthEarnings - 1) * 100).toFixed(1) : "N/A";
      const impressionsPct = lastMonthImpressions > 0 ? ((projectedImpressions / lastMonthImpressions - 1) * 100).toFixed(1) : "N/A";

      const micro = (v: number) => `$${(v / 1_000_000).toFixed(2)}`;

      const lines = [
        `Revenue Pacing Report`,
        `${"=".repeat(50)}`,
        ``,
        `Current month: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
        `Days elapsed: ${daysElapsed} / ${daysInMonth}`,
        ``,
        `              This Month (so far)  Projected       Last Month      vs Last Month`,
        `Earnings      ${micro(currentEarnings).padEnd(20)} ${micro(projectedEarnings).padEnd(16)} ${micro(lastMonthEarnings).padEnd(16)} ${earningsPct}%`,
        `Impressions   ${String(currentImpressions).padEnd(20)} ${String(projectedImpressions).padEnd(16)} ${String(lastMonthImpressions).padEnd(16)} ${impressionsPct}%`,
        ``,
        `Daily avg earnings: ${micro(dailyAvgEarnings)}`,
        `Daily avg impressions: ${Math.round(dailyAvgImpressions).toLocaleString()}`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "best_worst_days",
    "Find the best and worst performing days in a period. Use for: 'What were my best and worst days this month?', 'Show my peak revenue days'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 30)"),
      top_n: z.coerce.number().optional().describe("Number of best/worst days to show (default 5)"),
    },
    async ({ account_id, days, top_n }) => {
      const n = days || 30;
      const count = top_n || 5;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["DATE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      const best = rows.slice(0, count);
      const worst = [...rows].reverse().slice(0, count);

      const sections = [
        formatReportTable(best, { title: `Top ${count} Revenue Days (last ${n} days)` }),
        formatReportTable(worst, { title: `Bottom ${count} Revenue Days (last ${n} days)` }),
      ];

      return { content: [{ type: "text", text: sections.join("\n\n") }] };
    }
  );

  server.tool(
    "weekday_vs_weekend",
    "Compare weekday vs weekend ad performance. Use for: 'Do I earn more on weekdays or weekends?', 'Weekday vs weekend revenue comparison'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 28, uses multiples of 7 for fairness)"),
    },
    async ({ account_id, days }) => {
      const n = days || 28;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["DATE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      const weekday: Array<Record<string, string>> = [];
      const weekend: Array<Record<string, string>> = [];

      for (const row of rows) {
        const dateStr = row.DATE || "";
        // DATE format is YYYYMMDD
        const y = parseInt(dateStr.slice(0, 4), 10);
        const m = parseInt(dateStr.slice(4, 6), 10) - 1;
        const d = parseInt(dateStr.slice(6, 8), 10);
        const dayOfWeek = new Date(y, m, d).getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekend.push(row);
        } else {
          weekday.push(row);
        }
      }

      function avg(arr: Array<Record<string, string>>, key: string): number {
        if (arr.length === 0) return 0;
        return arr.reduce((s, r) => s + parseFloat(r[key] || "0"), 0) / arr.length;
      }

      const metrics = ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"];
      const summary = [
        { PERIOD: "Weekday avg", DAYS: String(weekday.length) },
        { PERIOD: "Weekend avg", DAYS: String(weekend.length) },
      ];
      for (const m of metrics) {
        (summary[0] as any)[m] = String(Math.round(avg(weekday, m)));
        (summary[1] as any)[m] = String(Math.round(avg(weekend, m)));
      }

      const diff: Record<string, string> = { PERIOD: "Weekend vs Weekday", DAYS: "-" };
      for (const m of metrics) {
        diff[m] = pctChange((summary[0] as any)[m], (summary[1] as any)[m]);
      }
      summary.push(diff as any);

      return {
        content: [{ type: "text", text: formatReportTable(summary, { title: `Weekday vs Weekend Performance (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "platform_format_matrix",
    "Cross-reference platform and ad format to see which formats perform best on each platform. Use for: 'Which formats perform best on each platform?', 'Compare rewarded ads on iOS vs Android'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["PLATFORM", "FORMAT"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR", "SHOW_RATE"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      } as any);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Platform x Format Matrix (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "revenue_concentration",
    "Pareto analysis of revenue concentration across apps, countries, and ad units. Use for: 'How diversified is my revenue?', 'Am I too dependent on one country or app?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, days }) => {
      const n = days || 7;
      const client = await getClient();

      const [byApp, byCountry, byAdUnit] = await Promise.all([
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["APP"],
          metrics: ["ESTIMATED_EARNINGS"],
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["COUNTRY"],
          metrics: ["ESTIMATED_EARNINGS"],
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["AD_UNIT"],
          metrics: ["ESTIMATED_EARNINGS"],
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
      ]);

      function pareto(data: unknown, dimKey: string): string {
        const rows = parseReportRows(data);
        const total = rows.reduce((s, r) => s + parseInt(r.ESTIMATED_EARNINGS || "0", 10), 0);
        if (total === 0) return `No earnings data for ${dimKey}.`;

        let cumulative = 0;
        const table = rows.map((r, i) => {
          const e = parseInt(r.ESTIMATED_EARNINGS || "0", 10);
          cumulative += e;
          return {
            RANK: String(i + 1),
            [dimKey]: r[dimKey],
            ESTIMATED_EARNINGS: String(e),
            "SHARE_%": `${((e / total) * 100).toFixed(1)}%`,
            "CUMULATIVE_%": `${((cumulative / total) * 100).toFixed(1)}%`,
          };
        });

        // Find where 80% of revenue is reached
        const idx80 = table.findIndex((r) => parseFloat(r["CUMULATIVE_%"]) >= 80);
        const top = table.slice(0, Math.max((idx80 ?? 0) + 1, 5));
        const summary = `Top ${idx80 + 1} of ${rows.length} ${dimKey.toLowerCase()}s account for 80%+ of revenue.`;
        return formatReportTable(top, { title: `${dimKey} Concentration` }) + `\n${summary}`;
      }

      const sections = [
        pareto(byApp, "APP"),
        pareto(byCountry, "COUNTRY"),
        pareto(byAdUnit, "AD_UNIT"),
      ];

      return {
        content: [{
          type: "text",
          text: `Revenue Concentration Analysis (last ${n} days)\n${"=".repeat(50)}\n\n${sections.join("\n\n")}`,
        }],
      };
    }
  );

  server.tool(
    "ad_source_trend",
    "Show mediation ad source performance over time to catch declining demand partners. Use for: 'How are my mediation sources trending?', 'Is Meta/Unity ad revenue declining?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 14)"),
      ad_source: z.string().optional().describe("Filter to a specific ad source name"),
    },
    async ({ account_id, days, ad_source }) => {
      const n = days || 14;
      const client = await getClient();
      const spec: any = {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["DATE", "AD_SOURCE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "OBSERVED_ECPM", "MATCH_RATE"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
      };
      if (ad_source) {
        spec.dimensionFilters = [{ dimension: "AD_SOURCE", matchesAny: { values: [ad_source] } }];
      }
      const result = await client.generateMediationReport(account_id, spec);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Mediation Ad Source Trend (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "app_deep_dive",
    "Full breakdown of a single app: ad units, formats, and platforms. Use for: 'Give me a full breakdown for my top app', 'Deep dive into app performance'",
    {
      account_id: z.string().describe("AdMob account ID"),
      app_id: z.string().describe("App ID to analyze (e.g. ca-app-pub-1234~5678)"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
    },
    async ({ account_id, app_id, days }) => {
      const n = days || 7;
      const client = await getClient();
      const filter = [{ dimension: "APP", matchesAny: { values: [app_id] } }];

      const [byAdUnit, byFormat, byPlatform] = await Promise.all([
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["AD_UNIT"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR", "MATCH_RATE", "SHOW_RATE"],
          dimension_filters: filter,
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["FORMAT"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
          dimension_filters: filter,
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: daysAgo(n), endDate: yesterday() },
          dimensions: ["PLATFORM"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "MATCH_RATE"],
          dimension_filters: filter,
          sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
        } as any),
      ]);

      const sections = [
        formatReportTable(parseReportRows(byAdUnit), { title: "By Ad Unit" }),
        formatReportTable(parseReportRows(byFormat), { title: "By Format" }),
        formatReportTable(parseReportRows(byPlatform), { title: "By Platform" }),
      ];

      return {
        content: [{
          type: "text",
          text: `App Deep Dive: ${app_id} (last ${n} days)\n${"=".repeat(50)}\n\n${sections.join("\n\n")}`,
        }],
      };
    }
  );

  server.tool(
    "anomaly_detection",
    "Flag days with unusual revenue or impression changes vs rolling average. Use for: 'Flag any unusual days in the last 30 days', 'Were there any anomalies in my revenue?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 30)"),
      threshold: z.coerce.number().optional().describe("% deviation from rolling average to flag (default 30)"),
    },
    async ({ account_id, days, threshold }) => {
      const n = days || 30;
      const thresh = threshold || 30;
      const client = await getClient();
      const result = await client.generateNetworkReport(account_id, {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["DATE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS"],
        sortConditions: [{ dimension: "DATE", order: "ASCENDING" }],
      } as any);
      const rows = parseReportRows(result);

      const windowSize = 7;
      const anomalies: Array<Record<string, string>> = [];

      for (let i = windowSize; i < rows.length; i++) {
        // Calculate rolling average of previous `windowSize` days
        let avgEarnings = 0;
        let avgImpressions = 0;
        for (let j = i - windowSize; j < i; j++) {
          avgEarnings += parseInt(rows[j].ESTIMATED_EARNINGS || "0", 10);
          avgImpressions += parseInt(rows[j].IMPRESSIONS || "0", 10);
        }
        avgEarnings /= windowSize;
        avgImpressions /= windowSize;

        const earnings = parseInt(rows[i].ESTIMATED_EARNINGS || "0", 10);
        const impressions = parseInt(rows[i].IMPRESSIONS || "0", 10);

        const earningsDeviation = avgEarnings > 0 ? ((earnings - avgEarnings) / avgEarnings) * 100 : 0;
        const impressionsDeviation = avgImpressions > 0 ? ((impressions - avgImpressions) / avgImpressions) * 100 : 0;

        if (Math.abs(earningsDeviation) >= thresh || Math.abs(impressionsDeviation) >= thresh) {
          anomalies.push({
            DATE: rows[i].DATE,
            ESTIMATED_EARNINGS: rows[i].ESTIMATED_EARNINGS,
            EARNINGS_VS_AVG: `${earningsDeviation >= 0 ? "+" : ""}${earningsDeviation.toFixed(1)}%`,
            IMPRESSIONS: rows[i].IMPRESSIONS,
            IMPRESSIONS_VS_AVG: `${impressionsDeviation >= 0 ? "+" : ""}${impressionsDeviation.toFixed(1)}%`,
            TYPE: earningsDeviation < -thresh ? "DROP" : earningsDeviation > thresh ? "SPIKE" : impressionsDeviation < -thresh ? "IMP_DROP" : "IMP_SPIKE",
          });
        }
      }

      if (anomalies.length === 0) {
        return {
          content: [{ type: "text", text: `Anomaly Detection (last ${n} days, threshold: ${thresh}%)\n\nNo anomalies detected. All days were within ${thresh}% of the 7-day rolling average.` }],
        };
      }

      return {
        content: [{ type: "text", text: formatReportTable(anomalies, { title: `Anomalies Detected (last ${n} days, threshold: ${thresh}% deviation from 7-day rolling avg)` }) }],
      };
    }
  );

  server.tool(
    "ad_source_instance_comparison",
    "Compare individual ad source instances within mediation waterfalls. Use for: 'Compare ad instances within each mediation source', 'Which waterfall instances perform best?'",
    {
      account_id: z.string().describe("AdMob account ID"),
      days: z.coerce.number().optional().describe("Lookback period in days (default 7)"),
      ad_source: z.string().optional().describe("Filter to a specific ad source"),
    },
    async ({ account_id, days, ad_source }) => {
      const n = days || 7;
      const client = await getClient();
      const spec: any = {
        dateRange: { startDate: daysAgo(n), endDate: yesterday() },
        dimensions: ["AD_SOURCE", "AD_SOURCE_INSTANCE"],
        metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "MATCHED_REQUESTS", "MATCH_RATE", "OBSERVED_ECPM"],
        sortConditions: [{ metric: "ESTIMATED_EARNINGS", order: "DESCENDING" }],
      };
      if (ad_source) {
        spec.dimensionFilters = [{ dimension: "AD_SOURCE", matchesAny: { values: [ad_source] } }];
      }
      const result = await client.generateMediationReport(account_id, spec);
      const rows = parseReportRows(result);
      return {
        content: [{ type: "text", text: formatReportTable(rows, { title: `Ad Source Instance Comparison (last ${n} days)` }) }],
      };
    }
  );

  server.tool(
    "yoy_comparison",
    "Compare this month (or a recent period) to the same period last year. Use for: 'How does this month compare to the same month last year?', 'Year-over-year revenue comparison'",
    {
      account_id: z.string().describe("AdMob account ID"),
      months: z.coerce.number().optional().describe("Number of recent months to compare (default 1)"),
    },
    async ({ account_id, months }) => {
      const n = months || 1;
      const client = await getClient();
      const now = new Date();

      // Current period: last N months up to yesterday
      const currentStart = new Date(now.getFullYear(), now.getMonth() - n + 1, 1);
      // Same period last year
      const lastYearStart = new Date(currentStart.getFullYear() - 1, currentStart.getMonth(), 1);
      const lastYearEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 1);

      const toDateObj = (d: Date) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });

      const [currentResult, lastYearResult] = await Promise.all([
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: toDateObj(currentStart), endDate: yesterday() },
          dimensions: ["MONTH"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
          sortConditions: [{ dimension: "MONTH", order: "ASCENDING" }],
        } as any),
        client.generateNetworkReport(account_id, {
          dateRange: { startDate: toDateObj(lastYearStart), endDate: toDateObj(lastYearEnd) },
          dimensions: ["MONTH"],
          metrics: ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"],
          sortConditions: [{ dimension: "MONTH", order: "ASCENDING" }],
        } as any),
      ]);

      const currentRows = parseReportRows(currentResult);
      const lastYearRows = parseReportRows(lastYearResult);

      // Build comparison rows
      const comparison: Array<Record<string, string>> = [];
      for (let i = 0; i < currentRows.length; i++) {
        const curr = currentRows[i];
        const prev = lastYearRows[i];
        const row: Record<string, string> = { MONTH_THIS_YEAR: curr.MONTH || "" };
        if (prev) {
          row["MONTH_LAST_YEAR"] = prev.MONTH || "";
        }
        for (const key of ["ESTIMATED_EARNINGS", "IMPRESSIONS", "AD_REQUESTS", "IMPRESSION_RPM", "IMPRESSION_CTR"]) {
          row[`${key}_NOW`] = curr[key] || "0";
          row[`${key}_LAST_YR`] = prev?.[key] || "0";
          row[`${key}_YOY`] = pctChange(prev?.[key] || "0", curr[key] || "0");
        }
        comparison.push(row);
      }

      return {
        content: [{ type: "text", text: formatReportTable(comparison, { title: `Year-over-Year Comparison (${n} month${n > 1 ? "s" : ""})` }) }],
      };
    }
  );
}
