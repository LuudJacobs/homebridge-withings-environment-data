# Homebridge Withings Environment Data

**This Homebridge plugin has been 100% vibe coded with Claude.**

Exposes ambient CO2 (air quality) and room temperature readings from a
Withings WS-50 scale as HomeKit sensors:

- **CarbonDioxideSensor**: precise CO2 level in ppm, plus a normal/abnormal
  detected alert based on a configurable threshold.
- **AirQualitySensor**: the same CO2 reading mapped to HomeKit's
  Excellent/Good/Fair/Inferior/Poor category.
- **TemperatureSensor**: room temperature in °C.

This data isn't available through the official Withings API: a `getmeas`
call against the documented endpoint drops CO2/temperature even when
explicitly requested. Instead this plugin authenticates the same way the
Health Mate web app does (session cookies, not OAuth) and calls the same
internal endpoint the web app uses. That means it depends on undocumented
behavior of `account.withings.com` / `scalews.withings.com` and could break
if Withings changes them.

## Installation

Install via the Homebridge Config UI: open the **Plugins** tab, search for
"Withings Environment Data", and click **Install**.

Or from the command line:

```bash
npm install -g homebridge-withings-environment-data
```

Then restart Homebridge and add the platform via the Config UI, or add it
manually to `config.json`.

## Configuration

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

## When it stops working

If the Homebridge log shows a "session not trusted (landed on confirm_totp)"
error, the device-trust cookie has been invalidated (e.g. after a password
change, or Withings revoking trusted devices). The Home app will keep
showing the last known good reading, it won't go blank, but a fault
indicator appears on the sensors until this is fixed. Fix:

1. Recapture the trust cookie: see [Getting the trust
   cookie](#getting-the-trust-cookie) below.
2. Update the **Trust Cookie Value** field in the plugin's Config UI
   settings (the **Trust Cookie Name** itself should stay the same).

Any other poll failure (network error, unexpected response) is logged the
same way: an error in the Homebridge log, a fault indicator on the sensors,
and the previous readings left in place until the next successful poll.

## Getting the trust cookie

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
