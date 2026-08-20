# Withings Environment Data v1.6.2

**This Homebridge plugin has been 100% vibe coded with Claude.**

Exposes ambient CO2 (air quality) and room temperature readings from a
Withings WS-50 scale as HomeKit sensors.

This data isn't available through the official Withings API: a `getmeas`
call against the documented endpoint drops CO2/temperature even when
explicitly requested. Instead this plugin authenticates the same way the
Health Mate web app does (session cookies, not OAuth) and calls the same
internal endpoint the web app uses. That means it depends on undocumented
behavior of `account.withings.com` / `scalews.withings.com` and could break
if Withings changes them.

## Requirements

- Homebridge >=1.6.0
- Node >=18
- A Withings account with a WS-50 scale already set up in Health Mate

## Installation

Install via the Homebridge Config UI: open the **Plugins** tab, search for
"Withings Environment Data", and click **Install**.

Or from the command line:

```bash
npm install -g homebridge-withings-environment-data
```

Then restart Homebridge and add the platform via the Config UI, or add it
manually to `config.json`.

## Usage

Once configured (see below), the plugin exposes three sensors on one
accessory:

- **CarbonDioxideSensor**: precise CO2 level in ppm, plus a normal/abnormal
  detected alert based on a configurable threshold.
- **AirQualitySensor**: the same CO2 reading mapped to HomeKit's
  Excellent/Good/Fair/Inferior/Poor category, based on configurable ppm
  thresholds.
- **TemperatureSensor**: room temperature in °C.

These appear automatically in the Home app after Homebridge restarts, no
further setup needed. Readings update on the poll interval set below.

HomeKit exposure and MQTT publishing are independent and can each be
turned on or off in Configuration:

- **Expose sensors as HomeKit Accessories** (default on): when off, the
  plugin still polls Withings (and still publishes to MQTT, if enabled),
  but doesn't create or update any HomeKit accessory.
- **Publish to MQTT** (default off): when on, publishes a message to topic
  `withingsenv/ws-50` on the configured broker, shaped like
  `{"temperature": 25.2, "co2_levels": 674, "last_seen":
  "2026-08-18T20:30:00.000Z"}`, for every reading buffered by the scale
  since the last publish, not just the newest — the WS-50 can take several
  readings internally before it syncs, and this backfills that gap instead
  of collapsing it into one message. Each is published in the order it was
  actually recorded, oldest first. Messages are retained by default.
  Publishing only ever sends readings not already sent before (tracked
  independently of HomeKit's staleness check below), so it keeps working
  even if the newest available reading is itself still old by the time it
  arrives.

### Configuration

All settings are entered through the Homebridge Config UI (Plugins tab,
Withings Environment Data, Settings).

> **Note:** Homebridge stores your password and trust cookie value in plain
> text in its `config.json` file on disk. Anyone with access to that file,
> or to the Homebridge host itself, can read them. Treat that file with the
> same care as any other credentials store.

Fields:

- **Withings Email / Password**: your account credentials. Used only
  against `account.withings.com`'s own login form.
- **Trust Cookie Name / Value**: see [Getting the trust
  cookie](#getting-the-trust-cookie) below. As long as this is reused, the
  plugin's automated logins skip the 2FA prompt.
- **Poll Interval (minutes)**: how often to fetch new readings (default 30,
  matching the scale's own upload cadence).
- **CO2 Detected Threshold (ppm)**: ppm above which the CarbonDioxideSensor
  reports "abnormal" (default 1000).
- **Excellent/Good/Fair/Inferior below (ppm)**: the four ppm boundaries the
  AirQualitySensor category is based on (defaults 800, 1000, 1500, 2000).
  Anything above the Inferior boundary is reported as Poor.
- **Expose sensors as HomeKit Accessories**: see [Usage](#usage) above.
  Default on.
- **Publish to MQTT / Host / Requires authentication / Username / Password /
  Last Seen / Retain**: see [Usage](#usage) above. Publishing is off by
  default. **Host** includes the port, e.g. `localhost:1883` (the
  default); if the port is omitted it defaults to 1883. Username/Password
  only apply, and only appear, when **Requires authentication** is
  checked. **Last Seen** controls the
  format of the `last_seen` field, which always reflects the time the
  scale actually took the measurement (not when the plugin polled or
  published it): `ISO_8601` (default, UTC), `ISO_8601 local` (with UTC
  offset), `epoch` (milliseconds), or `disabled` to omit the field
  entirely. Retain is on by default.
- **Stale Data Warning Threshold (hours)**: if the newest reading from the
  scale itself (not the plugin's poll) is older than this many hours — e.g.
  nobody's stood on the scale in a while — a warning is logged on every
  poll for as long as it stays stale, and the sensors show "No Response" in
  the Home app. Default 4. This is separate from poll failures.
- **Send Stale Data Notification** (default on): whether a stale reading
  additionally sends a single ntfy notification (requires ntfy.sh
  Notification Topic below). The log warning and "No Response" in the Home
  app happen either way, so turn this off if the unresponsive sensor is
  signal enough on its own.
- **ntfy.sh Notification Topic** (optional): if set, sends a push notification via
  [ntfy.sh](https://ntfy.sh) to this topic the first time a poll fails
  (not repeated on every subsequent failure in the same streak; only once
  a poll succeeds again does the next failure trigger a fresh
  notification), and separately, once when the data becomes stale (see
  above). Leave blank to disable.

### How authentication works

The plugin reuses a long-lived (~1 week) `session_key`, the same
mechanism Withings' own web app relies on to stay logged in without
re-entering credentials each time.

That session is cached in a small file in Homebridge's own storage
directory, `withings-environment-data-session.json`, and reused across
polls and restarts. Email/password only get used as a fallback, the rare
times that cached session actually expires, and the fresh session that
fallback produces is automatically written back to the same file for next
time. In normal operation the plugin should hit the password endpoint very
infrequently, roughly weekly at most.

### When it stops working

Most of the time this is self-healing: if the cached session has expired,
the plugin automatically falls back to a full login and caches the new
session it gets back, no action needed. A fault indicator appears on the
sensors during a failed poll, but the Home app keeps showing the last known
good reading rather than going blank.

If the Homebridge log instead shows a "session not trusted (landed on
confirm_totp)" error, the *trust cookie* itself has been invalidated (e.g.
after a password change, or Withings revoking trusted devices). This is
what the fallback login relies on, so it can't self-heal on its own. Fix:

1. Recapture the trust cookie: see [Getting the trust
   cookie](#getting-the-trust-cookie) below.
2. Update the **Trust Cookie Value** field in the plugin's Config UI
   settings (the **Trust Cookie Name** itself should stay the same).

Any other poll failure (network error, unexpected response) is logged the
same way: an error in the Homebridge log, a fault indicator on the sensors,
and the previous readings left in place until the next successful poll.

### Getting the trust cookie

Both initial setup and recovering from an expired session need this. Capture
it once via DevTools:

1. Log into [account.withings.com](https://account.withings.com) in a
   browser, making sure to check **"trust this device"** when prompted for
   a 2FA code.
2. Open DevTools, Application tab, Cookies, `account.withings.com`.
3. Find the cookie named `2fa_token_<a long hex hash>`, then copy its full
   name and its value. This is what actually signals "this device already
   passed 2FA". Its name stays stable across logins even though its value
   doesn't.

## License and changelog

- [LICENSE](https://github.com/LuudJacobs/homebridge-withings-environment-data/blob/main/LICENSE)
- [CHANGELOG](https://github.com/LuudJacobs/homebridge-withings-environment-data/blob/main/CHANGELOG.md)
