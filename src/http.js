// -----------------------------------------------------------------------------
// The only place that talks HTTP: one request to the Sense API with a timeout,
// an identifiable User-Agent and the client id header Sense expects, errors
// sorted into codes. The tests replace `fetch` with `setFetch()`.
//
// Never put a URL, a body or a header in an error message: the e-mail, the
// password and the tokens travel there.
// -----------------------------------------------------------------------------

import { API_URL, HTTP_TIMEOUT, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/**
 * Codes: network | timeout | unauthorized (401, or 403 with Sense's JSON
 * error) | blocked (403 without it: passing) | mfa_required |
 * rate_limited (429) | not_found | http (others) | bad_credentials | bad_mfa |
 * renew_refused | no_credentials | no_monitor.
 */
export class SenseError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'SenseError';
    this.code = code;
    this.status = status;
  }
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** The `error_reason` Sense puts in an error body, short and on one line. */
function reasonOf(body) {
  const reason = body && typeof body.error_reason === 'string' ? body.error_reason : '';
  return reason.replace(/\s+/g, ' ').slice(0, 120);
}

/**
 * Call `path` (relative to API_URL). `form` makes a POST with a
 * form-encoded body (what Sense's authentication endpoints take); otherwise a
 * GET. Resolves the parsed JSON body; throws a SenseError.
 */
export async function request(path, { form, token, deviceId } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (deviceId) {
    headers['x-sense-device-id'] = deviceId;
  }
  if (token) {
    headers.Authorization = `bearer ${token}`;
  }
  const init = { method: form ? 'POST' : 'GET', headers };
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
  }
  let response;
  try {
    response = await fetchImpl(`${API_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new SenseError(timeout ? 'timeout' : 'network', timeout ? 'timeout' : 'network error');
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = undefined;
  }
  const status = response.status;
  if (status === 401 || status === 403) {
    if (body && typeof body.mfa_token === 'string') {
      const error = new SenseError('mfa_required', 'Sense asks for a two-factor code', status);
      error.mfaToken = body.mfa_token;
      throw error;
    }
    const reason = reasonOf(body);
    // A 403 without Sense's JSON error (a proxy or firewall page) refuses
    // nothing: a passing error, retried like a 5xx.
    if (status === 403 && !reason) {
      throw new SenseError('blocked', 'Sense is not answering (403)', status);
    }
    throw new SenseError(
      'unauthorized',
      `Sense refused the request (${status}${reason ? `: ${reason}` : ''})`,
      status,
    );
  }
  if (status === 429) {
    const error = new SenseError('rate_limited', 'Sense asked to slow down (429)', 429);
    error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'));
    throw error;
  }
  if (status === 404) {
    throw new SenseError('not_found', 'Sense answered 404 (not found)', 404);
  }
  if (!response.ok) {
    throw new SenseError('http', `Sense answered ${status}`, status);
  }
  if (body === undefined) {
    throw new SenseError('http', 'Sense answered something that is not JSON', status);
  }
  return body;
}
