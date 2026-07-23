const ASSOCIATION_URL = 'https://scalews.withings.com/cgi-bin/association';

// Reverse-engineered/unofficial: not part of the documented Withings API.
// Lets the plugin find the account's scale deviceId/userId automatically
// after login, instead of requiring the user to hunt for them in DevTools.
async function discoverDevice(cookieHeader) {
  const body = new URLSearchParams({ action: 'getbyaccountid', enrich: 't' }).toString();

  const response = await fetch(ASSOCIATION_URL, {
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
    throw new Error(`Device discovery request failed with HTTP status ${response.status}`);
  }

  const json = await response.json();
  if (json.status !== 0) {
    throw new Error(`Device discovery returned Withings status ${json.status}`);
  }

  const deviceId = json.body.associations?.[0]?.deviceid;
  const userId = json.body.accounts?.[0]?.users?.[0]?.userid;

  if (!deviceId || !userId) {
    throw new Error('Could not determine deviceId/userId from the Withings association response');
  }

  return { deviceId: String(deviceId), userId: String(userId) };
}

module.exports = { discoverDevice };
