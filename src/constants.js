// -----------------------------------------------------------------------------
// Constants of the Sense integration.
// -----------------------------------------------------------------------------

/** The Sense cloud API, unofficial, as used by sense-energy (scottbonline/sense). */
export const API_URL = 'https://api.sense.com/apiservice/api/v1/';
/** The real-time feed of a monitor. The access token travels in the query: never log the URL. */
export const WS_URL = (monitorId, token) =>
  `wss://clientrt.sense.com/monitors/${encodeURIComponent(monitorId)}/realtimefeed?access_token=${encodeURIComponent(token)}`;
export const USER_AGENT = 'gladys-sense/0.1 (+https://github.com/LM1LC3N7/gladys-sense)';
export const HTTP_TIMEOUT = 20_000;

/** Today's trends (and yesterday's once a day) are read every 15 minutes. */
export const TRENDS_INTERVAL = 15 * 60_000;
/** The list of the devices Sense detected is read again every 6 hours (option). */
export const DEVICES_INTERVAL = 6 * 60 * 60_000;

/** The live states of the monitor are published at most every 10 s. */
export const LIVE_THROTTLE = 10_000;
/** The power of the detected devices at most every minute (their on/off with the monitor). */
export const APPLIANCE_POWER_THROTTLE = 60_000;
/** Gladys accepts 300 states per minute: the optional states stop at this budget. */
export const STATES_PER_MINUTE = 240;

/** Real-time reconnection: exponential backoff with jitter, one connection only. */
export const LIVE_RECONNECT = { base: 5_000, max: 5 * 60_000 };
/** No message for this long: the feed is considered dead and reopened. */
export const LIVE_SILENCE = 90_000;
/** Sockets closed before their first message in a row before the token is suspected. */
export const LIVE_HANDSHAKE_FAILURES = 2;

/** A failed sign-in (network, 5xx) is retried after 5, 15, then every 60 minutes. */
export const LOGIN_RETRY = [5 * 60_000, 15 * 60_000, 60 * 60_000];
/** Refused credentials are tried again only every 6 hours (never in a loop). */
export const BAD_CREDENTIALS_RETRY = 6 * 60 * 60_000;
/** The access token is renewed at most once every 5 minutes. */
export const RENEW_MIN_GAP = 5 * 60_000;
/** A 429 without Retry-After pauses every call for 15 minutes. */
export const RATE_LIMIT_PAUSE = 15 * 60_000;
/** Any 429 pause is kept between 1 minute and 6 hours, whatever Retry-After says. */
export const RATE_LIMIT_MIN = 60_000;
export const RATE_LIMIT_MAX = 6 * 60 * 60_000;
/** Yesterday is read again at every refresh during the first hours of a day (late data). */
export const YESTERDAY_REREAD = 3 * 60 * 60_000;
/** Token renewals asked by the real-time feed: their own backoff, 5 min to 6 h. */
export const LIVE_RENEW_BACKOFF = { base: 5 * 60_000, max: 6 * 60 * 60_000 };
/** A MessagePack frame (with the bytes left from the previous ones) is refused above 1 MiB. */
export const MSGPACK_MAX_BYTES = 1024 * 1024;

/** Manifest keys (forever: stored by Gladys). */
export const ACTIONS = { TEST: 'test_connection', MFA: 'verify_mfa' };
/** Config key, outside the config_schema, holding the Sense session (never shown). */
export const SESSION_KEY = 'sense_session';
