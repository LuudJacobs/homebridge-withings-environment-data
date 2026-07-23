const ACCOUNT_BASE = 'https://account.withings.com';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromResponse(response) {
    const setCookieHeaders =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')]
          : [];
    for (const header of setCookieHeaders) {
      const pair = header.split(';', 1)[0];
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      // Withings clears cookies by setting value to the literal string "deleted"
      // (alongside an expired Expires attribute) rather than omitting them.
      if (value === 'deleted' || /expires=[^;]*1970/i.test(header)) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  set(name, value) {
    this.cookies.set(name, value);
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  findByPrefix(prefix) {
    for (const [name, value] of this.cookies) {
      if (name.startsWith(prefix)) return { name, value };
    }
    return null;
  }
}

async function requestFollowingRedirects(method, url, body, jar, maxHops = 10) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;

  for (let hop = 0; hop <= maxHops; hop++) {
    const headers = {
      Cookie: jar.toHeader(),
      'User-Agent': USER_AGENT,
      Origin: ACCOUNT_BASE,
      Referer: currentUrl,
    };
    if (currentBody) headers['Content-Type'] = 'application/x-www-form-urlencoded';

    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers,
      body: currentBody,
      redirect: 'manual',
    });
    jar.setFromResponse(response);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { response, finalUrl: currentUrl };
      currentUrl = new URL(location, currentUrl).toString();
      currentMethod = 'GET';
      currentBody = undefined;
      continue;
    }

    if (response.status >= 400) {
      throw new Error(
        `Withings login request to ${currentUrl} failed with status ${response.status}`
      );
    }

    return { response, finalUrl: currentUrl };
  }

  throw new Error(`Withings login exceeded ${maxHops} redirect hops starting from ${url}`);
}

async function login(email, password, wUuid, trustCookieName, trustCookieValue) {
  const jar = new CookieJar();
  jar.set('w_uuid', wUuid);
  // The actual "this device already passed 2FA" marker appears to be this specific
  // cookie (scoped to account.withings.com), not w_uuid — its name has stayed stable
  // across many logins while w_uuid alone wasn't enough to skip 2FA. It must be sent
  // on the very first request of a fresh login attempt, before email/password.
  jar.set(trustCookieName, trustCookieValue);

  await requestFollowingRedirects('GET', `${ACCOUNT_BASE}/`, undefined, jar);

  const emailBody = new URLSearchParams({ email }).toString();
  await requestFollowingRedirects(
    'POST',
    `${ACCOUNT_BASE}/new_workflow/login`,
    emailBody,
    jar
  );

  const passwordBody = new URLSearchParams({ password }).toString();
  const { finalUrl } = await requestFollowingRedirects(
    'POST',
    `${ACCOUNT_BASE}/new_workflow/password_check`,
    passwordBody,
    jar
  );

  if (finalUrl.includes('confirm_totp')) {
    throw new Error(
      "Withings session not trusted (landed on confirm_totp) — log in manually at " +
        "https://account.withings.com with 'trust this device' checked during the 2FA step, " +
        'then update the wUuid and trustCookieValue plugin config fields with fresh values ' +
        '(DevTools -> Application tab -> Cookies -> account.withings.com).'
    );
  }

  const sessionTokenCookie = jar.findByPrefix('2fa_token_');
  if (!sessionTokenCookie) {
    throw new Error(
      'Withings login completed but no 2fa_token_* cookie was found — the login flow may have changed.'
    );
  }

  return {
    cookieHeader: jar.toHeader(),
    sessionToken: sessionTokenCookie.value,
  };
}

module.exports = { login };
