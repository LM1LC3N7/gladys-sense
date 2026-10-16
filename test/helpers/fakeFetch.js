// -----------------------------------------------------------------------------
// Fake `fetch` for the Sense API: routes by URL path, records every call,
// fails loudly on an unexpected one. No test touches the network. The fake
// answers at once and never waits on the request signal.
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** The name of a call: authenticate | mfa | renew | overview | devices | usage | solar. */
export function routeName(pathname) {
  const path = pathname.replace(/^\/apiservice\/api\/v1\//, '');
  if (path === 'authenticate') return 'authenticate';
  if (path === 'authenticate/mfa') return 'mfa';
  if (path === 'renew') return 'renew';
  if (/^app\/monitors\/[^/]+\/overview$/.test(path)) return 'overview';
  if (/^app\/monitors\/[^/]+\/devices\/overview$/.test(path)) return 'devices';
  if (/^app\/monitors\/[^/]+\/history\/usage\/solar$/.test(path)) return 'solar';
  if (/^app\/monitors\/[^/]+\/history\/usage$/.test(path)) return 'usage';
  return 'unknown';
}

/** `routes` maps a call name to handler(call) -> Response. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      url,
      name: routeName(parsed.pathname),
      method: init.method ?? 'GET',
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: init.headers ?? {},
      form: init.body ? Object.fromEntries(new URLSearchParams(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[call.name];
    if (!handler) {
      throw new Error(`Unexpected Sense call in a test: ${call.name} ${parsed.pathname}`);
    }
    return handler(call);
  });
  return {
    calls,
    named: (name) => calls.filter((c) => c.name === name),
    restore: () => setFetch(previous),
  };
}
