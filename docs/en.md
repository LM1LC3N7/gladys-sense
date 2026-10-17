# Sense Energy Monitor

**Unofficial connector, not affiliated with Sense Labs.** It brings your
**Sense** energy monitor (United States and Canada) into Gladys: the power your
home consumes (and produces, with solar) in real time, the voltage and the
frequency, the hourly consumption for the Gladys energy monitoring, and, as an option,
the devices Sense detected. It uses the same cloud API as the Sense app, which
Sense does not document and may change at any time.

> **Never tested with a real Sense monitor or account.** It was built from the
> sense-energy library used by Home Assistant and tested against sample
> answers only. Please report what works and what does not.

## What you get

| Surface                              | Content                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| One device per **Sense monitor**     | power consumed (W), voltage L1 and L2 (V), frequency (Hz), the 30-minute consumption for the energy monitoring |
| With **solar**                       | power produced (W), grid power (W, signed: positive when importing, negative when exporting)                   |
| Option **Devices detected by Sense** | one device per appliance Sense detected: on/off and power (W), read only                                       |
| Buttons                              | **Test the connection**, **Enter the two-factor code**                                                         |

## Installation

1. Install the integration, enter the **e-mail** and **password** of your Sense
   account, and save.
2. **If your account uses two-factor authentication**, the status asks for a
   code: click **Enter the two-factor code** and type the current 6-digit code
   of your authenticator app. Done once: the session is then kept and renewed
   by itself, also after a restart.
3. Click **Test the connection**: the monitor and the real-time state show.
4. Open **Discovery** and add the Sense monitor (and the detected devices, if
   you turned the option on).

## Energy monitoring

The real-time feed gives power, not energy. The integration therefore reads
Sense's hourly consumption every 15 minutes and publishes each finished hour of
today and yesterday as two **dated** half hours on the "Consumption (30 min)"
feature: the energy monitoring gets the right energy in the right half hour,
and can price it with your contract; the energy of a day is the sum of its half
hours. Yesterday is read again at every refresh during the first 3 hours of the
day (monitor time), for its last hours. Only today and yesterday are read: no
older history is filled in, so a Gladys stopped for more than a day keeps a
gap. The production, the import and the export have no daily total yet (the
grid power shows the exchange in real time).

## Detected devices

With the option on, every appliance Sense lists in its app (hidden and merged
ones left out) becomes a device with its on/off and its power. Sense needs time
to detect appliances, and its detection can be wrong; the devices are read
again every 6 hours. These states are optional: when the Gladys state budget is
reached, they wait for the next minute, never the monitor's.

## Limits

- Sense accounts of the United States and Canada; the first monitor of the
  account only.
- Calls: one real-time WebSocket; today's hourly consumption every 15 minutes,
  yesterday's once a day (at every refresh during the first 3 hours of the
  day), the detected devices every 6 hours.
  Published states: the monitor at most every 10 seconds, the power of the
  detected devices at most every minute.
- Reconnection of the real-time feed: from 5 seconds up to 5 minutes, with a
  random part. After a failed sign-in: 5, 15, then every 60 minutes. Refused
  e-mail or password: every 6 hours. When Sense asks to slow down (429), every
  call waits the time asked (15 minutes otherwise), between 1 minute and 6
  hours.
- Gladys has no frequency unit: the frequency is a plain number.
- The half hours are those of the monitor's clock hours: a time zone offset by
  45 minutes (Gladys or monitor) does not fit the 30-minute grid of Gladys, and
  the energy monitoring then refuses them.

## Troubleshooting

- **"Sense refused the e-mail or the password"**: check them in the Sense app,
  correct them and save.
- **"Your Sense account asks for a two-factor code"**: use **Enter the
  two-factor code**. A refused code: type the current one (it changes every 30
  seconds).
- **Real time "connecting…" for long**: the monitor may be offline; the feed
  reconnects by itself.
- **No energy in the energy monitoring**: check that the Sense monitor device
  is created; the hours appear once finished.
- Logs: set the integration's `LOG_LEVEL` variable.

## Privacy

The password is kept by Gladys in its database, never shown again, and only
sent to `api.sense.com` to sign in. The session tokens (access and refresh) are
kept in the same place, in the integration's configuration, outside the form.
Nothing is logged with the e-mail, the password or a token.

## Credits

The API logic is ported from [sense-energy](https://github.com/scottbonline/sense)
(MIT, © 2018 Scott Belisle), the library of the Home Assistant Sense
integration.
