const { login } = require('./lib/login');

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

async function fetchLatest({ cookieHeader, sessionToken, deviceId, userId, appliver }) {
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
    appliver,
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

  return {
    // Both series are newest-first, so the first entry is the latest reading.
    co2: co2Series.length > 0 ? co2Series[0].value : null,
    temperature: tempSeries.length > 0 ? tempSeries[0].value : null,
  };
}

function mapCo2ToAirQuality(ppm, AirQuality) {
  if (ppm < 800) return AirQuality.EXCELLENT;
  if (ppm < 1000) return AirQuality.GOOD;
  if (ppm < 1500) return AirQuality.FAIR;
  if (ppm < 2000) return AirQuality.INFERIOR;
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

    this.api.on('didFinishLaunching', () => this.discoverDevices());
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
    const info = accessory.getService(this.Service.AccessoryInformation);
    if (info) {
      info
        .setCharacteristic(this.Characteristic.Manufacturer, 'Withings')
        .setCharacteristic(this.Characteristic.Model, 'WS-50')
        .setCharacteristic(this.Characteristic.SerialNumber, String(this.config.deviceId ?? 'unknown'));
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
  }

  startPolling() {
    const minutes = Number(this.config.pollIntervalMinutes);
    const intervalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 30) * 60 * 1000;

    this.poll();
    this.pollTimer = setInterval(() => this.poll(), intervalMs);
  }

  async poll() {
    try {
      const { cookieHeader, sessionToken } = await login(
        this.config.email,
        this.config.password,
        this.config.wUuid,
        this.config.trustCookieName,
        this.config.trustCookieValue
      );

      const { co2, temperature } = await fetchLatest({
        cookieHeader,
        sessionToken,
        deviceId: this.config.deviceId,
        userId: this.config.userId,
        appliver: this.config.appliver,
      });

      this.applyReading(co2, temperature);
      this.setFault(false);
    } catch (err) {
      // Deliberately do not touch the value characteristics here — the Home app
      // should keep showing the last known good reading, not go blank, when a
      // poll fails (e.g. the trust cookie expired and login needs recapturing).
      this.log.error(`Withings poll failed: ${err.message}`);
      this.setFault(true);
    }
  }

  applyReading(co2, temperature) {
    const threshold = Number(this.config.co2DetectedThresholdPpm);
    const co2Threshold = Number.isFinite(threshold) && threshold > 0 ? threshold : 1000;

    if (co2 !== null && co2 !== undefined) {
      this.co2Service.updateCharacteristic(this.Characteristic.CarbonDioxideLevel, co2);
      this.co2Service.updateCharacteristic(
        this.Characteristic.CarbonDioxideDetected,
        co2 > co2Threshold
          ? this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
          : this.Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL
      );
      this.airQualityService.updateCharacteristic(
        this.Characteristic.AirQuality,
        mapCo2ToAirQuality(co2, this.Characteristic.AirQuality)
      );
    }

    if (temperature !== null && temperature !== undefined) {
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
