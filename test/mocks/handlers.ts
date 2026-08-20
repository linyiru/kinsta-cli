import { http, HttpResponse } from "msw";
import analyticsBandwidth from "../fixtures/analytics-bandwidth.json";
import analyticsCdnBandwidth from "../fixtures/analytics-cdn-bandwidth.json";
import analyticsDiskspace from "../fixtures/analytics-diskspace.json";
import analyticsResponseCodes from "../fixtures/analytics-response-codes.json";
import analyticsTopAsns from "../fixtures/analytics-top-asns.json";
import analyticsTopBrowsers from "../fixtures/analytics-top-browsers.json";
import analyticsTopCities from "../fixtures/analytics-top-cities.json";
import analyticsTopClientIps from "../fixtures/analytics-top-client-ips.json";
import analyticsTopCountries from "../fixtures/analytics-top-countries.json";
import analyticsTopHosts from "../fixtures/analytics-top-hosts.json";
import analyticsTopReferrers from "../fixtures/analytics-top-referrers.json";
import analyticsTopUas from "../fixtures/analytics-top-uas.json";
import analyticsVisits from "../fixtures/analytics-visits.json";
import analyticsVisitsDispersion from "../fixtures/analytics-visits-dispersion.json";
import clearCache from "../fixtures/clear-cache.json";
import cdnClear from "../fixtures/cdn-clear.json";
import edgeClear from "../fixtures/edge-clear.json";
import error401 from "../fixtures/error-401.json";
import error404 from "../fixtures/error-404.json";
import logsClean from "../fixtures/logs-clean.json";
import logsJetPopup from "../fixtures/logs-jet-popup.json";
import logsWpRocket from "../fixtures/logs-wp-rocket.json";
import restartPhp from "../fixtures/restart-php.json";
import sites from "../fixtures/sites.json";
import sshConfig from "../fixtures/ssh-config.json";
import sshPassword from "../fixtures/ssh-password.json";
import usageBandwidth from "../fixtures/usage-bandwidth.json";
import usageCdnBandwidth from "../fixtures/usage-cdn-bandwidth.json";
import usageVisits from "../fixtures/usage-visits.json";

export const BASE = "https://api.kinsta.com/v2";

function requireAuth(request: Request): Response | null {
  const auth = request.headers.get("authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return HttpResponse.json(error401, { status: 401 });
  }
  return null;
}

const LOGS_BY_ENV: Record<string, unknown> = {
  "a2222222-2222-4222-8222-222222222222": logsWpRocket,
  "a3333333-3333-4333-8333-333333333333": logsJetPopup,
  "a1111111-1111-4111-8111-111111111111": logsClean,
};

const ANALYTICS_BY_METRIC: Record<string, unknown> = {
  visits: analyticsVisits,
  bandwidth: analyticsBandwidth,
  "cdn-bandwidth": analyticsCdnBandwidth,
  diskspace: analyticsDiskspace,
  "response-codes": analyticsResponseCodes,
  "top-countries": analyticsTopCountries,
  "top-cities": analyticsTopCities,
  "top-client-ips": analyticsTopClientIps,
  "top-referrers": analyticsTopReferrers,
  "top-browsers": analyticsTopBrowsers,
  "top-uas": analyticsTopUas,
  "top-asns": analyticsTopAsns,
  "top-hosts": analyticsTopHosts,
  "visits-dispersion": analyticsVisitsDispersion,
};

const USAGE_BY_KIND: Record<string, unknown> = {
  visits: usageVisits,
  bandwidth: usageBandwidth,
  "cdn-bandwidth": usageCdnBandwidth,
};

export const handlers = [
  http.get(`${BASE}/sites`, ({ request }) => requireAuth(request) ?? HttpResponse.json(sites)),

  http.get(
    `${BASE}/sites/:siteId/environments/:envId/ssh/config`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(sshConfig),
  ),

  http.get(
    `${BASE}/sites/environments/:envId/ssh/password`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(sshPassword),
  ),

  http.get(`${BASE}/sites/environments/:envId/logs`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const envId = String(params.envId);
    return HttpResponse.json(LOGS_BY_ENV[envId] ?? logsClean);
  }),

  http.get(`${BASE}/sites/environments/:envId/analytics/:metric`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const fixture = ANALYTICS_BY_METRIC[String(params.metric)];
    if (!fixture) return HttpResponse.json(error404, { status: 404 });
    return HttpResponse.json(fixture, { status: 202 });
  }),

  http.get(`${BASE}/sites/:siteId/usage/:kind/this-month`, ({ request, params }) => {
    const unauth = requireAuth(request);
    if (unauth) return unauth;
    const fixture = USAGE_BY_KIND[String(params.kind)];
    if (!fixture) return HttpResponse.json(error404, { status: 404 });
    return HttpResponse.json(fixture);
  }),

  http.post(
    `${BASE}/sites/tools/clear-cache`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(clearCache, { status: 202 }),
  ),

  http.post(
    `${BASE}/sites/tools/restart-php`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(restartPhp, { status: 202 }),
  ),

  http.post(
    `${BASE}/sites/cdn/clear-cache`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(cdnClear, { status: 202 }),
  ),

  http.post(
    `${BASE}/sites/edge-caching/clear`,
    ({ request }) => requireAuth(request) ?? HttpResponse.json(edgeClear, { status: 202 }),
  ),
];
