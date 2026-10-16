# gladys-sense

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Sense energy monitor** (United States and Canada): power consumed and
produced, voltage and frequency in real time, today's energy (consumed,
produced, imported, exported) for the energy monitoring, and, as an option, the
devices Sense detected. **Unofficial, not affiliated with Sense Labs**: it uses
the undocumented cloud API of the Sense app, as Home Assistant does. **Never
tested with a real Sense monitor or account** (see TODO.md).

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (SenseApp)
                 ├─ src/sense/api.js      sign-in, two-factor code, token renewal, GETs
                 ├─ src/sense/live.js     the real-time WebSocket (backoff + jitter)
                 ├─ src/sense/msgpack.js  MessagePack frames of the feed (no dependency)
                 ├─ src/sense/model.js    answers -> plain values (pure)
                 └─ src/devices.js        the devices and their states (pure)
```

- **Sign-in**: `POST authenticate` (e-mail + password, form-encoded). An account
  with two-factor authentication answers 401 with an `mfa_token`: the status
  asks for the code, the `verify_mfa` action posts it to `authenticate/mfa`.
  The session (client id, user id, monitor id, tokens) is stored with
  `setConfig` under a key outside the schema, so a restart needs no new code.
- **Token**: a 401 renews it once (`POST renew` with the refresh token) and
  retries once; at most one renewal every 5 minutes; a refused renewal falls
  back to ONE sign-in with the password; refused credentials are tried again
  every 6 hours only. A 429 pauses every call for its Retry-After (15 min
  otherwise).
- **Real time**: one WebSocket
  (`wss://clientrt.sense.com/monitors/<id>/realtimefeed`), JSON or MessagePack
  frames, reconnected with an exponential backoff and jitter (5 s to 5 min),
  reopened after 90 s of silence. States published at most every 10 s (the
  power of the detected devices every minute), under a budget of 240 states a
  minute (Gladys takes 300).
- **Trends**: `history/usage?scale=DAY` (and `/solar`) every 15 minutes:
  today's totals as states, and the finished hours of today and yesterday as
  dated 30-minute consumption (`publishEnergyConsumption`).
- **Detected devices** (option): `devices/overview` at start and every 6 hours.

## Credits

The API logic is ported from
[scottbonline/sense](https://github.com/scottbonline/sense) (sense-energy, the
library of the Home Assistant Sense integration), MIT License, Copyright 2018
Scott Belisle. Modelled on the sibling integration
[gladys-tibber](https://github.com/LM1LC3N7/gladys-tibber).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: the Sense answers are synthetic, shaped after
what sense-energy reads (`test/fixtures/sense.js`); Gladys is the SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The logic ported from scottbonline/sense remains under
its MIT license, reproduced in full in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker image).
