# Homebridge Withings Environment Data

This Homebridge plugin has been 100% vibe coded by Claude.

Exposes ambient CO2 (air quality) and room temperature readings from a
Withings WS-50 scale as HomeKit sensors:

- **CarbonDioxideSensor** — precise CO2 level in ppm, plus a normal/abnormal
  detected alert based on a configurable threshold.
- **AirQualitySensor** — the same CO2 reading mapped to HomeKit's
  Excellent/Good/Fair/Inferior/Poor category.
- **TemperatureSensor** — room temperature in °C.

This data isn't available through the official Withings API — a `getmeas`
call against the documented endpoint drops CO2/temperature even when
explicitly requested. Instead this plugin authenticates the same way the
Health Mate web app does (session cookies, not OAuth) and calls the same
internal endpoint the web app uses. That means it depends on undocumented
behavior of `account.withings.com` / `scalews.withings.com` and could break
if Withings changes them.

## Installation

For now (not yet published to npm), install from this repo directly into
your Homebridge instance, e.g.:

```bash
cd /path/to/homebridge/node_modules
git clone https://github.com/LuudJacobs/homebridge-withings-environment-data.git
cd homebridge-withings-environment-data
npm install
```

Then restart Homebridge and add the platform via the Config UI (search for
"Withings Environment Data" under Plugins), or add it manually to
`config.json`.

## Configuration

All settings are entered through the Homebridge Config UI (Plugins tab ->
Withings Environment Data -> Settings). Fields:

- **Withings Email / Password** — your account credentials. Used only
  against `account.withings.com`'s own login form.
- **Device UUID (w_uuid cookie)** and **Trust Cookie Name / Value** — capture
  these once via DevTools:
  1. Log into [account.withings.com](https://account.withings.com) in a
     browser, making sure to check **"trust this device"** when prompted for
     a 2FA code.
  2. Open DevTools -> **Application** tab -> **Cookies** ->
     `account.withings.com`.
  3. Copy the value of the `w_uuid` cookie into **Device UUID**.
  4. Find the cookie named `2fa_token_<a long hex hash>` -> copy its full
     name into **Trust Cookie Name** and its value into **Trust Cookie
     Value**. This one, not `w_uuid`, is what actually signals "this device
     already passed 2FA" — its name stays stable across logins even though
     its value doesn't.

  As long as these are reused, the plugin's automated logins skip the 2FA
  prompt.
- **Device ID / User ID** — your account/scale's static identifiers. Get
  them via DevTools: open the Health Mate air quality view, find the
  request to `scalews.withings.com/cgi-bin/v2/measure` in the Network tab,
  and read `deviceid`/`userid` out of its request body.
- **App Build ID (appliver)** — the `appliver` value from that same request
  body. If the plugin starts failing across the board, this is one of the
  first things to recheck against a fresh capture.
- **Poll Interval (minutes)** — how often to fetch new readings (default 30,
  matching the scale's own upload cadence).
- **CO2 Detected Threshold (ppm)** — ppm above which the CarbonDioxideSensor
  reports "abnormal" (default 1000).

## When it stops working

If the Homebridge log shows a "session not trusted (landed on confirm_totp)"
error, the device-trust cookie has been invalidated (e.g. after a password
change, or Withings revoking trusted devices). The Home app will keep
showing the last known good reading — it won't go blank — but a fault
indicator appears on the sensors until this is fixed. Fix:

1. Log into `account.withings.com` manually in a browser, checking "trust
   this device" during the 2FA step.
2. Grab the fresh `w_uuid` and `2fa_token_<hash>` values the same way as in
   Configuration.
3. Update the **Device UUID** and **Trust Cookie Value** fields in the
   plugin's Config UI settings (the **Trust Cookie Name** itself should stay
   the same).

Any other poll failure (network error, unexpected response) is logged the
same way — an error in the Homebridge log, a fault indicator on the
sensors, and the previous readings left in place until the next successful
poll.
