# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
