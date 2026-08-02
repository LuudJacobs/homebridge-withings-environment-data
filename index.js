const fs = require('fs');
const path = require('path');
const { login, resumeSession } = require('./lib/login');
const { discoverDevice } = require('./lib/discover');

const SESSION_STATE_FILENAME = 'withings-environment-data-session.json';

const MEASURE_URL = 'https://scalews.withings.com/cgi-bin/v2/measure';
// Reverse-engineered/unofficial: not part of the documented Withings API.
const MEASTYPE_CO2 = 35;
const MEASTYPE_TEMPERATURE = 12;
const APPNAME = 'hmw';
const APPPFM = 'web';
// Wide enough to reliably find at least one recent point even after a longer
// gap in scale uploads — only the single newest point per series is used.
const WINDOW_HOURS = 48;

const PLATFORM_NAME = 'WithingsEnvironmentData';

async function fetchLatest({ cookieHeader, sessionToken, deviceId, userId }) {
  const enddate = Math.floor(Date.now() / 1000);
  const startdate = enddate - WINDOW_HOURS * 3600;

  const body = new URLSearchParams({
    action: 'getmeashf',
    deviceid: deviceId,
    userid: userId,
    meastype: `${MEASTYPE_CO2},${MEASTYPE_TEMPERATURE}`,
    startdate: String(startdate),
    enddate: String(enddate),
    appname: APPNAME,
    apppfm: APPPFM,
    session_token: sessionToken,
  }).toString();

  const response = await fetch(MEASURE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Origin: 'https://app.withings.com',
      Referer: 'https://app.withings.com/',
      Cookie: cookieHeader,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Measure request failed with HTTP status ${response.status}`);
  }

  const json = await response.json();
  if (json.status !== 0) {
    throw new Error(`Measure request returned Withings status ${json.status}: ${JSON.stringify(json.error ?? json)}`);
  }

  const co2Series = json.body.series?.find((s) => s.type === MEASTYPE_CO2)?.data ?? [];
  const tempSeries = json.body.series?.find((s) => s.type === MEASTYPE_TEMPERATURE)?.data ?? [];
  // Both series are newest-first, so the first entry is the latest reading.
  const co2Point = co2Series.length > 0 ? co2Series[0] : null;
  const tempPoint = tempSeries.length > 0 ? tempSeries[0] : null;

  return {
    co2: co2Point ? co2Point.value : null,
    temperature: tempPoint ? tempPoint.value : null,
    // Unix seconds the reading was actually taken, not when we fetched it —
    // used to detect the scale itself going quiet (e.g. nobody's stood on
    // it in a while), as opposed to the plugin failing to reach Withings.
    readingDate: co2Point?.date ?? tempPoint?.date ?? null,
  };
}

function mapCo2ToAirQuality(ppm, AirQuality, thresholds) {
  if (ppm < thresholds.excellentMaxPpm) return AirQuality.EXCELLENT;
  if (ppm < thresholds.goodMaxPpm) return AirQuality.GOOD;
  if (ppm < thresholds.fairMaxPpm) return AirQuality.FAIR;
  if (ppm < thresholds.inferiorMaxPpm) return AirQuality.INFERIOR;
  return AirQuality.POOR;
}

class WithingsEnvironmentDataPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.accessories = [];
    // Discovered automatically from the Withings association endpoint on first
    // successful login, rather than requiring the user to hunt for these in
    // DevTools — see lib/discover.js.
    this.deviceId = null;
    this.userId = null;

    // Cached last-known reading, served by the onGet handlers below so the
    // Home app keeps showing real data through transient poll failures.
    // Only once missedCycles exceeds the configured threshold do those
    // handlers throw, which is what actually makes the Home app show
    // "No Response" (StatusFault alone isn't reliably surfaced there).
    this.hasEverSucceeded = false;
    this.missedCycles = 0;
    this.lastReading = { co2: null, temperature: null };
    // Only send one ntfy notification per failure streak, not on every
    // missed poll — reset once a poll succeeds again.
    this.hasNotifiedFailure = false;

    this.warnedMissingReadingDate = false;

    // The long-lived (~1 week) session_key that lets us skip email/password/2FA
    // entirely on most polls — see lib/login.js's resumeSession(). Persisted to
    // disk so it survives Homebridge restarts, and only a full login() refreshes
    // it, since repeatedly hitting the password endpoint appears to be heavily
    // throttled by Withings.
    this.sessionStatePath = path.join(this.api.user.storagePath(), SESSION_STATE_FILENAME);
    const state = this.loadPersistedState();
    this.sessionKey = state.sessionKey ?? null;
    // Unix seconds of the newest reading actually seen so far (from the Withings
    // measurement itself, not from a successful poll) — used to detect the scale
    // going quiet rather than the plugin failing to poll. Persisted and restored
    // immediately on boot (rather than waiting on the first poll to repopulate
    // it) so a restart can't be mistaken for "no reading yet" and wrongly clear
    // an active stale-warning below.
    this.lastReadingDate = state.lastReadingDate ?? null;
    // The readingDate (unix seconds) we last sent a stale-data *notification* for,
    // or null if not currently in a notified state. The log warning itself repeats
    // every poll while data stays stale (like missed-poll-cycle failures do), but
    // this gates the ntfy notification to once per distinct stale reading, and is
    // persisted so a Homebridge restart doesn't re-notify about a reading we've
    // already notified about — it only resets once a fresher reading comes in.
    this.staleNotifiedForReadingDate = state.staleNotifiedForReadingDate ?? null;

    this.api.on('didFinishLaunching', () => this.discoverDevices());
  }

  loadPersistedState() {
    try {
      const raw = fs.readFileSync(this.sessionStatePath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.log.warn(`Could not read session state file: ${err.message}`);
      }
      return {};
    }
  }

  persistState() {
    try {
      fs.writeFileSync(
        this.sessionStatePath,
        JSON.stringify({
          sessionKey: this.sessionKey,
          lastReadingDate: this.lastReadingDate,
          staleNotifiedForReadingDate: this.staleNotifiedForReadingDate,
        })
      );
    } catch (err) {
      this.log.warn(`Could not persist session state file: ${err.message}`);
    }
  }

  async authenticate() {
    if (this.sessionKey) {
      try {
        return await resumeSession(this.sessionKey, this.config.trustCookieName, this.config.trustCookieValue);
      } catch (err) {
        this.log.warn(`Withings session resume failed, falling back to full login: ${err.message}`);
      }
    }

    const result = await login(
      this.config.email,
      this.config.password,
      this.config.trustCookieName,
      this.config.trustCookieValue
    );

    if (result.sessionKey) {
      if (result.sessionKey !== this.sessionKey) {
        this.sessionKey = result.sessionKey;
        this.persistState();
        this.log.info('Withings full login succeeded; cached the new session for future polls.');
      } else {
        this.log.info('Withings full login succeeded; session token unchanged.');
      }
    } else {
      this.log.warn('Withings full login succeeded but no new session token was issued; will retry full login next poll.');
    }

    return result;
  }

  configureAccessory(accessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const uuid = this.api.hap.uuid.generate('withings-environment-data');
    let accessory = this.accessories.find((acc) => acc.UUID === uuid);

    if (!accessory) {
      accessory = new this.api.platformAccessory(this.config.name || 'Withings Environment', uuid);
      this.api.registerPlatformAccessories('homebridge-withings-environment-data', PLATFORM_NAME, [accessory]);
    }

    this.setupServices(accessory);
    this.startPolling();
  }

  setupServices(accessory) {
    this.infoService = accessory.getService(this.Service.AccessoryInformation);
    if (this.infoService) {
      this.infoService
        .setCharacteristic(this.Characteristic.Manufacturer, 'Withings')
        .setCharacteristic(this.Characteristic.Model, 'WS-50')
        .setCharacteristic(this.Characteristic.SerialNumber, 'pending discovery');
    }

    this.co2Service =
      accessory.getService(this.Service.CarbonDioxideSensor) ||
      accessory.addService(this.Service.CarbonDioxideSensor, 'CO2', 'co2');

    this.airQualityService =
      accessory.getService(this.Service.AirQualitySensor) ||
      accessory.addService(this.Service.AirQualitySensor, 'Air Quality', 'air-quality');

    this.temperatureService =
      accessory.getService(this.Service.TemperatureSensor) ||
      accessory.addService(this.Service.TemperatureSensor, 'Temperature', 'temperature');

    this.co2Service
      .getCharacteristic(this.Characteristic.CarbonDioxideLevel)
      .onGet(() => this.getCo2LevelOrThrow());
    this.co2Service
      .getCharacteristic(this.Characteristic.CarbonDioxideDetected)
      .onGet(() => this.getCo2DetectedOrThrow());
    this.airQualityService
      .getCharacteristic(this.Characteristic.AirQuality)
      .onGet(() => this.getAirQualityOrThrow());
    this.temperatureService
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.getTemperatureOrThrow());
  }

  startPolling() {
    const minutes = Number(this.config.pollIntervalMinutes);
    const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;

    this.poll();
    this.pollTimer = setInterval(() => this.poll(), intervalMs);
  }

  async poll() {
    try {
      let cookieHeader, sessionToken;
      try {
        ({ cookieHeader, sessionToken } = await this.authenticate());
      } catch (err) {
        err.isAuthFailure = true;
        throw err;
      }

      if (!this.deviceId || !this.userId) {
        const discovered = await discoverDevice(cookieHeader);
        this.deviceId = discovered.deviceId;
        this.userId = discovered.userId;
        this.log.info(`Discovered Withings device ${this.deviceId} for user ${this.userId}`);
        if (this.infoService) {
          this.infoService.setCharacteristic(this.Characteristic.SerialNumber, this.deviceId);
        }
      }

      const { co2, temperature, readingDate } = await fetchLatest({
        cookieHeader,
        sessionToken,
        deviceId: this.deviceId,
        userId: this.userId,
      });

      this.applyReading(co2, temperature, readingDate);
      this.setFault(false);
      this.missedCycles = 0;
      this.hasNotifiedFailure = false;
    } catch (err) {
      // Deliberately do not touch the value characteristics here — the Home app
      // should keep showing the last known good reading, not go blank, on a
      // single poll failure (e.g. the trust cookie expired and login needs
      // recapturing). Only once missedCycles crosses the configured threshold
      // do the onGet handlers below start throwing, which is what actually
      // surfaces "No Response" in the Home app.
      this.missedCycles += 1;
      this.log.error(`Withings poll failed (missed cycle ${this.missedCycles}): ${err.message}`);
      this.setFault(true);

      if (!this.hasNotifiedFailure) {
        this.hasNotifiedFailure = true;
        const notificationMessage = err.isAuthFailure
          ? 'Authentication for Withings account failed. Check the Homebridge logs for details.'
          : err.message;
        await this.sendNtfyNotification(notificationMessage);
      }
    }

    // Independent of whether this poll itself succeeded — the scale can go
    // quiet (no one's stood on it) while polls keep succeeding fine, so this
    // is checked every cycle against whatever the newest reading actually is.
    await this.checkStaleData();
  }

  async sendNtfyNotification(message, title = 'Homebridge: Getting Withings Environment Data Failed!') {
    const topic = this.config.ntfyTopic;
    if (!topic) return;

    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { Title: title },
        body: message,
      });
    } catch (err) {
      this.log.warn(`Failed to send ntfy notification: ${err.message}`);
    }
  }

  getCo2Threshold() {
    const threshold = Number(this.config.co2DetectedThresholdPpm);
    return Number.isFinite(threshold) && threshold > 0 ? threshold : 1000;
  }

  getNoResponseThreshold() {
    const threshold = Number(this.config.noResponseAfterMissedPolls);
    return Number.isFinite(threshold) && threshold >= 0 ? threshold : 2;
  }

  getAirQualityThresholds() {
    const excellentMaxPpm = Number(this.config.airQualityExcellentMaxPpm);
    const goodMaxPpm = Number(this.config.airQualityGoodMaxPpm);
    const fairMaxPpm = Number(this.config.airQualityFairMaxPpm);
    const inferiorMaxPpm = Number(this.config.airQualityInferiorMaxPpm);
    return {
      excellentMaxPpm: Number.isFinite(excellentMaxPpm) && excellentMaxPpm > 0 ? excellentMaxPpm : 800,
      goodMaxPpm: Number.isFinite(goodMaxPpm) && goodMaxPpm > 0 ? goodMaxPpm : 1000,
      fairMaxPpm: Number.isFinite(fairMaxPpm) && fairMaxPpm > 0 ? fairMaxPpm : 1500,
      inferiorMaxPpm: Number.isFinite(inferiorMaxPpm) && inferiorMaxPpm > 0 ? inferiorMaxPpm : 2000,
    };
  }

  getStaleDataThresholdHours() {
    const threshold = Number(this.config.staleDataWarningThresholdHours);
    return Number.isFinite(threshold) && threshold >= 1 ? threshold : 4;
  }

  // dd-mm and 24hr time, per the configured warning's required format — no
  // year, since this is about "how long ago", not a historical record.
  formatStaleDateTime(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    };
  }

  isDataStale() {
    if (!this.lastReadingDate) return false;
    const ageHours = (Date.now() / 1000 - this.lastReadingDate) / 3600;
    return ageHours > this.getStaleDataThresholdHours();
  }

  async checkStaleData() {
    const stale = this.isDataStale();

    if (stale) {
      const { date, time } = this.formatStaleDateTime(this.lastReadingDate);
      this.log.warn(`Withings data is stale: last recorded at ${date} ${time}`);

      const alreadyNotifiedForThisReading = this.staleNotifiedForReadingDate === this.lastReadingDate;
      if (!alreadyNotifiedForThisReading) {
        this.staleNotifiedForReadingDate = this.lastReadingDate;
        this.persistState();
        await this.sendNtfyNotification(
          `Temperature and/or CO2 readings haven't been updated since ${date} at ${time}.`,
          'Homebridge: Withings Environment Data is out of date'
        );
      }
    } else if (this.staleNotifiedForReadingDate !== null) {
      this.staleNotifiedForReadingDate = null;
      this.persistState();
      this.log.info('Withings: fresh data has been recorded.');
    }
  }

  isStale() {
    return !this.hasEverSucceeded || this.missedCycles > this.getNoResponseThreshold() || this.isDataStale();
  }

  throwIfStale() {
    if (this.isStale()) {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getCo2LevelOrThrow() {
    this.throwIfStale();
    return this.lastReading.co2;
  }

  getCo2DetectedOrThrow() {
    this.throwIfStale();
    return this.lastReading.co2 > this.getCo2Threshold()
      ? this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
      : this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
  }

  getAirQualityOrThrow() {
    this.throwIfStale();
    return mapCo2ToAirQuality(this.lastReading.co2, this.Characteristic.AirQuality, this.getAirQualityThresholds());
  }

  getTemperatureOrThrow() {
    this.throwIfStale();
    return this.lastReading.temperature;
  }

  applyReading(co2, temperature, readingDate) {
    const co2Threshold = this.getCo2Threshold();
    const hasReading = (co2 !== null && co2 !== undefined) || (temperature !== null && temperature !== undefined);

    if (hasReading && (readingDate === null || readingDate === undefined)) {
      if (!this.warnedMissingReadingDate) {
        this.warnedMissingReadingDate = true;
        this.log.warn(
          'Withings measurement data has no recognizable date field; stale data detection is disabled until this is fixed.'
        );
      }
    } else if (readingDate !== null && readingDate !== undefined && readingDate !== this.lastReadingDate) {
      this.lastReadingDate = readingDate;
      this.persistState();
    }

    if (co2 !== null && co2 !== undefined) {
      this.lastReading.co2 = co2;
      this.hasEverSucceeded = true;
      this.co2Service.updateCharacteristic(this.Characteristic.CarbonDioxideLevel, co2);
      this.co2Service.updateCharacteristic(
        this.Characteristic.CarbonDioxideDetected,
        co2 > co2Threshold
          ? this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
          : this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL
      );
      this.airQualityService.updateCharacteristic(
        this.Characteristic.AirQuality,
        mapCo2ToAirQuality(co2, this.Characteristic.AirQuality, this.getAirQualityThresholds())
      );
    }

    if (temperature !== null && temperature !== undefined) {
      this.lastReading.temperature = temperature;
      this.hasEverSucceeded = true;
      this.temperatureService.updateCharacteristic(this.Characteristic.CurrentTemperature, temperature);
    }
  }

  setFault(hasFault) {
    const value = hasFault
      ? this.Characteristic.StatusFault.GENERAL_FAULT
      : this.Characteristic.StatusFault.NO_FAULT;

    this.co2Service.updateCharacteristic(this.Characteristic.StatusFault, value);
    this.airQualityService.updateCharacteristic(this.Characteristic.StatusFault, value);
    this.temperatureService.updateCharacteristic(this.Characteristic.StatusFault, value);
  }
}

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, WithingsEnvironmentDataPlatform);
};
