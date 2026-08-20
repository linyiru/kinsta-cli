export interface Domain {
  id: string;
  name: string;
  type: string;
}

export interface SshConnection {
  ssh_port: string;
  ssh_ip: { external_ip: string };
}

export interface ContainerInfo {
  id: string;
  php_engine_version: string;
}

export interface Environment {
  id: string;
  name: string;
  display_name: string;
  is_premium?: boolean;
  is_blocked?: boolean;
  id_edge_cache?: string;
  cdn_cache_id?: string;
  web_root?: string;
  wordpress_version?: string;
  domains?: Domain[];
  primaryDomain?: Domain | null;
  ssh_connection?: SshConnection;
  container_info?: ContainerInfo;
}

export interface Site {
  id: string;
  name: string;
  display_name: string;
  status?: string;
  environments: Environment[];
}

/** Response of GET /sites/{site_id}/environments/{env_id}/ssh/config */
export interface SshConfig {
  name: string;
  host: string;
  port: string;
  user: string;
  ssh_command: string;
}

/** A site paired with the environment we operate on (usually the live env). */
export interface ResolvedSite {
  site: Site;
  env: Environment;
}

/** Generic wrapper returned by the `analytics/*` endpoints. */
export interface AnalyticsResponse<T> {
  key: string;
  data: T[];
}

export interface AnalyticsPoint {
  key: string;
  value: string;
}

/** visits / bandwidth / cdn-bandwidth / diskspace shape. */
export interface AnalyticsSeries {
  name: string;
  total: number;
  dataset: AnalyticsPoint[];
}

/** top-countries / cities / referrers / browsers / uas / asns / hosts shape. */
export interface AnalyticsTopEntry {
  name: string;
  views: string;
}

/** top-client-ips shape (ip/value rather than name/views). */
export interface AnalyticsTopIpEntry {
  ip: string;
  value: string;
}

/** response-codes shape. */
export interface AnalyticsResponseCodeEntry {
  response_code: string;
  data: AnalyticsPoint[];
}

/** visits-dispersion shape (device split over time). */
export interface AnalyticsDispersionEntry {
  name: string;
  dataset: { date: string; percent: string }[];
}

/** This-month plan usage across the three metered dimensions. */
export interface UsageSummary {
  visits: number;
  bandwidth: number;
  cdnBandwidth: number;
}

/** Response of GET /operations/{operation_id} (status 202 = still running). */
export interface OperationStatus {
  status: number;
  message: string;
}
