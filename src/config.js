// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { SESSION_KEY } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  appliances: false,
};

const bool = (value, fallback) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true';

/** The stored Sense session (JSON string written by the integration), or undefined. */
export function parseSession(raw) {
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  try {
    const session = JSON.parse(raw);
    return session && typeof session === 'object' && typeof session.refresh_token === 'string'
      ? session
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeConfig(raw = {}) {
  return {
    email: typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    appliances: bool(raw.appliances, DEFAULTS.appliances),
    session: parseSession(raw[SESSION_KEY]),
  };
}

/** True when two configurations ask for the same thing (the session aside). */
export function sameSettings(a, b) {
  return a.email === b.email && a.password === b.password && a.appliances === b.appliances;
}
