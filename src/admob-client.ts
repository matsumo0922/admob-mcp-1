import { OAuth2Client } from "google-auth-library";
import { wrapAuthError } from "./auth.js";

const BASE_URL = "https://admob.googleapis.com/v1";

interface DateObj {
  year: number;
  month: number;
  day: number;
}

interface ReportSpec {
  dateRange: { startDate: DateObj; endDate?: DateObj };
  dimensions?: string[];
  metrics?: string[];
  dimensionFilters?: Array<{
    dimension: string;
    matchesAny: { values: string[] };
  }>;
  sortConditions?: Array<{
    order?: string;
    dimension?: string;
    metric?: string;
  }>;
  localizationSettings?: { currencyCode?: string; languageCode?: string };
  maxReportRows?: number;
  timeZone?: string;
}

export class AdMobClient {
  constructor(private auth: OAuth2Client) {}

  private async request(method: string, path: string, body?: unknown) {
    let token;
    try {
      token = await this.auth.getAccessToken();
    } catch (err) {
      throw wrapAuthError(err);
    }
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401) {
        throw wrapAuthError(new Error(`invalid_grant: ${text}`));
      }
      throw new Error(`AdMob API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  async listAccounts(): Promise<unknown> {
    return this.request("GET", "/accounts");
  }

  async getAccount(accountId: string): Promise<unknown> {
    return this.request("GET", `/accounts/${accountId}`);
  }

  async listAdUnits(accountId: string, pageSize?: number, pageToken?: string): Promise<unknown> {
    const params = new URLSearchParams();
    if (pageSize) params.set("pageSize", String(pageSize));
    if (pageToken) params.set("pageToken", pageToken);
    const qs = params.toString();
    return this.request("GET", `/accounts/${accountId}/adUnits${qs ? `?${qs}` : ""}`);
  }

  async listApps(accountId: string, pageSize?: number, pageToken?: string): Promise<unknown> {
    const params = new URLSearchParams();
    if (pageSize) params.set("pageSize", String(pageSize));
    if (pageToken) params.set("pageToken", pageToken);
    const qs = params.toString();
    return this.request("GET", `/accounts/${accountId}/apps${qs ? `?${qs}` : ""}`);
  }

  async generateNetworkReport(accountId: string, reportSpec: ReportSpec): Promise<unknown> {
    return this.request("POST", `/accounts/${accountId}/networkReport:generate`, {
      reportSpec,
    });
  }

  async generateMediationReport(accountId: string, reportSpec: ReportSpec): Promise<unknown> {
    return this.request("POST", `/accounts/${accountId}/mediationReport:generate`, {
      reportSpec,
    });
  }
}
