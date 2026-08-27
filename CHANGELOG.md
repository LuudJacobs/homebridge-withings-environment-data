# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased
- CI: both workflows replaced with the shared templates. Test builds now
  prune superseded tarballs and print a full download-and-install one-liner;
  publishing checks the tag against package.json and signs the package with
  provenance

## [1.6.4] - 2026-08-27

### Changed
- CI: no test build is produced when `main` is merged back into `test`
  after a release

## [1.6.3] - 2026-08-27

### Changed
- CI: pushes to `test` now build and attach a prebuilt tarball to a
  `test-build` prerelease, so test builds install without compiling on the
  target device

## [1.6.2] - 2026-08-21

### Changed
- Config UI: Authentication fieldset now starts collapsed
- Config UI: "Expose sensors as HomeKit Accessories" moved below the Air
  Quality fieldset
- Host field's description now notes it defaults to port 1883 when the
  port is omitted

## [1.6.1] - 2026-08-21

### Fixed
- Publish workflow's CI Node version bumped to 22 — the first real run
  failed at `npm install -g npm@latest`, since the latest npm now
  requires Node `^22.22.2 || ^24.15.0 || >=26.0.0` and the workflow had
  pinned Node 20

## [1.6.0] - 2026-08-21

### Added
- "Requires authentication" checkbox in the MQTT fieldset; Username and
  Password only appear (and are only sent to the broker) when it's checked

### Changed
- MQTT Host and Port merged into a single "Host" field including the port,
  e.g. `localhost:1883` (the new default)
- Publishing to npm now happens automatically via GitHub Actions on tagged
  releases, using npm's OIDC trusted publishing (no npm tokens in CI)

## [1.5.0] - 2026-08-19

### Added
- "Send Stale Data Notification" checkbox (default on): lets the ntfy
  notification for stale data be turned off independently of the log
  warning and "No Response" in the Home app, which still happen either way
- Log line confirming a successful MQTT broker connection, and one per poll
  reporting how many readings were published and over what time range
  (previously only connection *errors* were logged, so a client that never
  connected looked the same in the log as a working one)

### Fixed
- MQTT backfill no longer gets stuck once the newest known reading is
  itself still stale by the time it's fetched (e.g. the scale recovers
  from an outage, but the newest synced point is still older than the
  Stale Data Warning Threshold). Publishing is now gated purely on
  whether a reading has already been sent, not on wall-clock staleness
- MQTT backfill no longer strands readings on the first run after
  upgrading: the "last published" marker was seeded from the newest
  reading the *poller* had seen rather than the newest actually
  *published*, silently skipping everything in between

## [1.4.0] - 2026-08-19

### Added
- `last_seen` field in the MQTT payload, reflecting the actual Withings
  measurement time (not poll/publish time). Format configurable via a new
  "Last Seen" dropdown: `ISO_8601` (default, UTC), `ISO_8601 local`,
  `epoch` (milliseconds), or `disabled` to omit the field
- MQTT publishing now backfills every reading the scale buffered since the
  last publish, not just the single newest one, published oldest first

### Changed
- MQTT Retain is now on by default (previously off by default)

## [1.3.3] - 2026-08-04

### Fixed
- Stale data now correctly shows a fault on the sensors' `StatusFault`
  characteristic too, not just "No Response" in the Home app. A
  successful poll always cleared the fault, even when the reading itself
  was stale, so anything reading `StatusFault` directly instead of
  calling the characteristic's get handler (e.g. Homebridge's own
  accessory list) kept showing the sensors as fine

## [1.3.2] - 2026-08-04

### Added
- "Retain" checkbox in the MQTT fieldset (default off) to control whether
  published MQTT messages set the retain flag

### Changed
- "Publish to MQTT" checkbox moved into the collapsed "MQTT" fieldset,
  as its first item
- MQTT publishing now pauses once the newest reading is past the Stale
  Data Warning Threshold, resuming once a fresher reading comes in —
  previously it kept republishing the same stale reading on every poll

### Fixed
- MQTT messages are no longer published with the retain flag set by
  default (previously always retained)
- "Publish to MQTT" and "Retain" checkboxes now actually default to
  unchecked in Config UI (an explicit `"default": false` wasn't being
  applied by the schema form and rendered checked instead)
- When Retain is off, the plugin now clears any stale retained message
  left on the broker from before (publishing with `retain:false` doesn't
  remove an existing retained message on its own)

## [1.3.1] - 2026-08-03

### Fixed
- MQTT Host now defaults to `localhost` instead of being blank, so
  "Publish to MQTT" actually connects when a broker runs on the same
  machine as Homebridge and the field was left unset

## [1.3.0] - 2026-08-03

### Added
- Optional MQTT publishing: when "Publish to MQTT" is enabled and a broker
  Host is configured, every successful poll publishes a retained message
  to topic `withingsenv/ws-50` shaped like
  `{"temperature": 25.2, "co2_levels": 674}`
- "Expose sensors as HomeKit Accessories" toggle (default on): when off,
  the plugin still polls (and still publishes to MQTT, if enabled) but
  doesn't create or update a HomeKit accessory

### Changed
- Config UI reorganized: Name, then an expanded "Authentication" fieldset,
  the Expose/Publish checkboxes, a collapsed "MQTT" fieldset, a collapsed
  "Air Quality" fieldset (shorter field titles, fewer descriptions), Poll
  Interval, No Response After Missed Polls, Stale Data Warning Threshold,
  ntfy.sh Notification Topic (renamed from "ntfy Topic (optional)")
- `displayName` set in `package.json` so Homebridge Config UI shows
  "Withings Environment Data" in the Plugins list instead of the raw npm
  package name
- Shortened a few config field descriptions (No Response After Missed
  Polls, Stale Data Warning Threshold, ntfy.sh Notification Topic)

## [1.2.1] - 2026-08-02

### Changed
- The stale-data log warning now logs on every poll while data remains
  stale (matching how missed poll cycles are already logged), instead of
  only once per stale streak.

### Fixed
- The stale-data ntfy notification no longer re-fires every time
  Homebridge restarts while the same stale reading is still the newest one
  on record. The "already notified about this" state, and the last-known
  reading date it applies to, are now both persisted to disk instead of
  living only in memory (a first fix persisted only the former, which
  still misfired if the first poll after a restart happened to fail), and
  still reset correctly once a fresher reading comes in.

## [1.2.0] - 2026-07-31

### Added
- Stale data detection: if the newest reading from the scale itself is
  older than the new `staleDataWarningThresholdHours` config field
  (default 4 hours), a warning is logged with the last-recorded date and
  time, the sensors report "No Response" in the Home app, and (if `ntfy
  Topic` is set) a notification is sent — all once per stale streak, with
  a log line and reset once a fresher reading comes in. Separate from
  poll failures, which were already covered.

## [1.1.2] - 2026-07-28

### Added
- A log entry after every successful full login stating whether a new
  session token was cached, was unchanged, or wasn't issued at all

### Fixed
- `login()`'s fallback full login now requires actually landing on
  `/new_workflow/exit` to be considered successful (matching
  `resumeSession()`'s existing check), instead of only checking for the
  `confirm_totp` 2FA-trust failure case. Previously, any other silent
  login failure (e.g. rate limiting) was treated as success, only
  surfacing later as a confusing "Invalid Session" error from the
  measure endpoint instead of a clear, correctly-classified
  authentication failure

## [1.1.1] - 2026-07-27

### Fixed
- Fixed a crash on every poll ("Cannot read properties of undefined
  (reading 'excellentMaxPpm')"): `applyReading()`'s AirQualitySensor
  update was missed when the Air Quality thresholds became configurable
  in v1.1.0 and still called `mapCo2ToAirQuality()` without them

## [1.1.0] - 2026-07-27

### Added
- Air Quality threshold config fields (`airQualityExcellentMaxPpm`,
  `airQualityGoodMaxPpm`, `airQualityFairMaxPpm`,
  `airQualityInferiorMaxPpm`) to make the AirQualitySensor's ppm
  boundaries configurable instead of hardcoded

### Changed
- ntfy notifications for an authentication failure now use a fixed,
  generic message instead of the raw internal error text; other poll
  failures still send the raw error message. The Homebridge log still
  always shows the detailed error either way.

## [1.0.0] - 2026-07-26

### Changed
- README's license/changelog links now point to full GitHub URLs instead
  of relative paths
- package.json now sets `author`, `homepage`, `bugs`, and `repository`, and
  includes README/LICENSE/CHANGELOG in `files`

## [0.3.3] - 2026-07-26

### Added
- CHANGELOG.md (this file)

### Changed
- README restructured to match project conventions (versioned title,
  Requirements/Usage sections, license/changelog links, Configuration/How
  authentication works/When it stops working/Getting the trust cookie
  nested under Usage)

### Fixed
- LICENSE copyright name typo

## [0.3.2] - 2026-07-26

### Fixed
- Removed an inaccurate claim from the ntfy notification body about the
  Home app continuing to show the last known reading

## [0.3.1] - 2026-07-25

### Added
- Optional `ntfyTopic` config field: sends a push notification via
  ntfy.sh the first time a poll fails, not repeated on every failure in
  the same streak

### Changed
- Broadened package.json keywords for discoverability
- Simplified the README's authentication section wording

## [0.2.0] - 2026-07-25

### Added
- CO2/AirQuality/Temperature characteristics now use `onGet` handlers
  backed by a cached last-known reading; the Home app shows "No Response"
  once consecutive failures exceed a configurable threshold
  (`noResponseAfterMissedPolls`, default 2, minimum 0), instead of relying
  on `StatusFault`, which isn't reliably surfaced by the stock Home app

### Changed
- Replaced per-poll email/password login with a long-lived `session_key`
  reused across polls and persisted across Homebridge restarts, falling
  back to a full login only when that session actually expires (fixes an
  account lockout caused by logging in fresh every 30 minutes)

## [0.1.5] - 2026-07-23

### Changed
- Replaced `.npmignore` with an explicit `"files"` whitelist in
  package.json

## [0.1.4] - 2026-07-23

### Added
- `.npmignore` to keep editor/session folders and repo-only files out of
  the published npm package

## [0.1.3] - 2026-07-23

### Added
- Homebridge platform plugin exposing CO2 (CarbonDioxideSensor +
  AirQualitySensor) and room temperature (TemperatureSensor) as HomeKit
  sensors, replacing the standalone scraper script
- Config UI based configuration instead of a `.env` file

### Changed
- Simplified required config: dropped `w_uuid`, `deviceId`, `userId`, and
  `appliver`; device/user IDs are now auto-discovered after login
- README cleaned up: deduplicated trust-cookie capture instructions,
  added a plain-text credential storage warning, updated install
  instructions for npm

### Fixed
- Corrected the real "trusted device" marker to the `2fa_token_<hash>`
  cookie instead of `w_uuid`
