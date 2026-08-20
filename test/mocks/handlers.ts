import { http, HttpResponse } from "msw";
import clearCache from "../fixtures/clear-cache.json";
import cdnClear from "../fixtures/cdn-clear.json";
import edgeClear from "../fixtures/edge-clear.json";
import error401 from "../fixtures/error-401.json";
import logsClean from "../fixtures/logs-clean.json";
import logsJetPopup from "../fixtures/logs-jet-popup.json";
import logsWpRocket from "../fixtures/logs-wp-rocket.json";
import restartPhp from "../fixtures/restart-php.json";
import sites from "../fixtures/sites.json";
import sshConfig from "../fixtures/ssh-config.json";
import sshPassword from "../fixtures/ssh-password.json";

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
