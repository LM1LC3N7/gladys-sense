# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Sense account (with and without
      solar, with and without two-factor authentication): sign-in, the code
      button, a restart without a new code, the real-time states, today's
      totals, the 30-minute consumption in the energy monitoring, the detected
      devices.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real instance (built without a Sense account)

- [ ] The real-time feed answers JSON when the client does not ask for
      `application/x-msgpack` (what older sense-energy versions read); the
      MessagePack frames are decoded anyway.
- [ ] How the feed refuses an expired token: an `error` message with
      `authorized: false`, or a refused handshake (both renew the token).
- [ ] The lifetime of the access token, and whether `renew` returns a new
      refresh token (both cases handled).
- [ ] `history/usage?scale=DAY` answers the monitor's local day containing
      `start` (read as UTC), with one `usage_breakdown_kwh` value per clock
      hour from `start`, as sense-energy assumes.
- [ ] The `solar` answer's `total.from_grid_kwh` / `to_grid_kwh` /
      `production_kwh` for today.
- [ ] `setConfig` of a key outside the schema does not fire
      `onConfigUpdated` (a restart would be harmless: same settings are
      ignored), and saving the form keeps that key.
- [ ] The realtime `devices[].id` match the `devices/overview` ids.

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag), as for the sibling integrations; the
  Release workflow owns them from now on (the first patch release gives
  0.1.1).
- **Reused project**: no maintained JavaScript Sense client exists; the logic
  of scottbonline/sense (sense-energy, MIT, used by Home Assistant) is ported
  and credited (`THIRD_PARTY_NOTICES.md`, README, docs). MessagePack is
  decoded by a small in-house decoder rather than a dependency (the SDK stays
  the only runtime dependency).
- **Two-factor code through an action** (`verify_mfa`, a 6-digit `code`
  field): the config form cannot hold a code valid 30 seconds. The `mfa_token`
  stays in memory; a refused code forgets it, the next try signs in again.
- **Session outside the schema** (`sense_session`, through `setConfig`, as the
  SDK advises for OAuth tokens): client id, user id, monitor id, access and
  refresh tokens, and the e-mail it belongs to (another e-mail ignores it).
  Written only when it changes. Saving the form with the same settings does
  not restart.
- **No loop, no burst**: one renewal per 5 minutes at most (also right after a
  sign-in), shared by concurrent callers; a refused renewal falls back to ONE
  password sign-in; refused credentials are retried every 6 hours only (never
  dead: a timer stays); MFA required waits for the user (a retry would only
  ask again). A 429 pauses every call of the client.
- **One real-time connection** (the first monitor of the account, as
  sense-energy), reconnected with backoff 5 s → 5 min and jitter (half to all
  of the step), reopened after 90 s of silence; two closures before the first
  message in a row are taken for a refused token.
- **Energy monitoring**: the realtime feed has power only and Sense has no
  cumulative index, so the dated 30-minute consumption
  (`publishEnergyConsumption`, from the hourly breakdown, finished hours only)
  is the meter of the energy monitoring; Gladys 5.2 is required for it.
- **Today's totals** (running, reset at midnight by Sense): consumption as
  `energy-sensor` / `daily-consumption` (as gladys-tibber's "today"),
  production as `energy-production-sensor` / `daily-production`; import and
  export have no daily type in the core: `energy-sensor` / `energy` (kWh),
  not an index (an index must never go back). Units only from
  `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- **Frequency**: the core has neither a frequency type nor a hertz unit:
  `unknown` / `decimal` without unit, "(Hz)" in the name.
- **Detected devices**: `energy-sensor` / `binary` (on when power > 0, as
  sense-energy) and `energy-sensor` / `power`, read only; the list follows
  sense-energy's filter (hidden and merged left out, a smart plug once).
  External id `appliance:<monitor>_<Sense device id>`; the monitor is
  `monitor:<Sense monitor id>`.
- **State budget**: the monitor every 10 s at most (changes only, heartbeat 5
  min), the appliances' on/off with it, their power every minute (heartbeat 30
  min); past 240 states a minute the appliance states wait (Gladys takes 300).
- **The token travels in the WebSocket URL** (Sense's design): the URL is
  never logged and socket error texts are scrubbed.

## Ideas

- Several monitors per account (one feed each, still within the budget).
- Scene triggers (an appliance turns on/off, a power threshold), a widget.
- The weekly, monthly and billing-cycle trends.
- The Sense-connected smart plugs (on/off), behind a safe default.
