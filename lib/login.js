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

  get(name) {
    return this.cookies.get(name);
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

function buildResult(jar) {
  const sessionTokenCookie = jar.findByPrefix('2fa_token_');
  if (!sessionTokenCookie) {
    throw new Error(
      'Withings session established but no 2fa_token_* cookie was found — the login flow may have changed.'
    );
  }

  return {
    cookieHeader: jar.toHeader(),
    sessionToken: sessionTokenCookie.value,
    sessionKey: jar.get('session_key') ?? null,
  };
}

// Fast path: account.withings.com hands out a long-lived (~1 week) session_key
// cookie that, when replayed, skips straight past email/password/2FA entirely
// (redirects to /new_workflow/exit instead of asking for credentials at all).
// Confirmed empirically this doesn't need w_uuid alongside it. Throws if the
// session_key has expired/is invalid, signaling the caller to fall back to login().
async function resumeSession(sessionKey, trustCookieName, trustCookieValue) {
  const jar = new CookieJar();
  jar.set(trustCookieName, trustCookieValue);
  jar.set('session_key', sessionKey);

  const { finalUrl } = await requestFollowingRedirects(
    'GET',
    `${ACCOUNT_BASE}/new_workflow/login`,
    undefined,
    jar
  );

  if (!finalUrl.includes('/new_workflow/exit')) {
    throw new Error('Withings session_key did not resume a session (did not land on /new_workflow/exit)');
  }

  return buildResult(jar);
}

// Full fallback flow: email + password + trust cookie. Only needed the first
// time, or once the long-lived session_key from resumeSession() has actually
// expired — this is what Withings appears to throttle heavily if hit too
// often, so resumeSession() should always be tried first.
async function login(email, password, trustCookieName, trustCookieValue) {
  const jar = new CookieJar();
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
        'then update the trustCookieValue plugin config field with a fresh value ' +
        '(DevTools -> Application tab -> Cookies -> account.withings.com).'
    );
  }

  return buildResult(jar);
}

module.exports = { login, resumeSession };
