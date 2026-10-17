# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to a Sense account (United States and Canada) with its e-mail and
  password; a "Enter the two-factor code" button completes the sign-in of an
  account protected by two-factor authentication. The session is kept and
  renewed by itself, also across restarts.
- One device per Sense monitor: power consumed, voltage of both legs and
  frequency from the real-time feed (one WebSocket, published at most every
  10 seconds), and, with solar, the power produced.
- With solar, the grid power (signed: import positive, export negative).
- The hourly consumption of today and yesterday fed,
  dated, to the Gladys energy monitoring as 30-minute consumption.
- Option "Devices detected by Sense": one device per detected appliance, with
  its on/off and its power (read only), within the Gladys state budget.
- Resilience: the real-time feed reconnects with an exponential backoff and
  jitter (5 s to 5 min) and is reopened when silent; a failed sign-in is
  retried after 5, 15, then every 60 minutes; refused credentials only every
  6 hours; a 429 pauses every call for its Retry-After (between 1 minute and
  6 hours); a bare 403 is a passing error; a refused token is
  renewed at most once every 5 minutes.
- "Test the connection" button.
- `THIRD_PARTY_NOTICES.md` with the MIT license of sense-energy
  (scottbonline/sense), shipped in the image with `LICENSE`.

[Unreleased]: https://github.com/LM1LC3N7/gladys-sense/commits/main
