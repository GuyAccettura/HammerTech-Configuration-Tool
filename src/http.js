import { randomUUID } from "node:crypto";
import { getRegionConfig, normalizeRegion } from "./config.js";

export class HammerTechApiError extends Error {
  constructor(message, { status, statusText, responseBody, requestId } = {}) {
    super(message);
    this.name = "HammerTechApiError";
    this.status = status;
    this.statusText = statusText;
    this.responseBody = responseBody;
    this.requestId = requestId;
  }
}

export class CookieJar {
  constructor(cookies = []) {
    this.cookies = [];
    for (const cookie of cookies) this.add(cookie);
  }

  add(cookie) {
    if (!cookie || !cookie.name) return;
    const normalized = {
      name: cookie.name,
      value: cookie.value ?? "",
      domain: String(cookie.domain || "").toLowerCase(),
      path: cookie.path || "/",
      expires: cookie.expires || null,
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly)
    };
    this.cookies = this.cookies.filter((existing) => {
      return !(
        existing.name === normalized.name &&
        existing.domain === normalized.domain &&
        existing.path === normalized.path
      );
    });
    this.cookies.push(normalized);
  }

  storeFromHeaders(url, headers) {
    const setCookies = typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitCombinedSetCookie(headers.get("set-cookie"));

    for (const header of setCookies) {
      const parsed = parseSetCookie(header, url);
      if (parsed) this.add(parsed);
    }
  }

  headerFor(url) {
    const target = new URL(url);
    const host = target.hostname.toLowerCase();
    const path = target.pathname || "/";
    const now = Date.now();
    const parts = [];

    for (const cookie of this.cookies) {
      if (cookie.expires && Date.parse(cookie.expires) <= now) continue;
      if (cookie.secure && target.protocol !== "https:") continue;
      if (!domainMatches(host, cookie.domain)) continue;
      if (!path.startsWith(cookie.path || "/")) continue;
      parts.push(`${cookie.name}=${cookie.value}`);
    }

    return parts.join("; ");
  }

  toJSON() {
    return this.cookies;
  }
}

export class HammerTechClient {
  constructor({ region, token, cookieJar, fetchImpl = globalThis.fetch } = {}) {
    this.region = normalizeRegion(region || "us");
    this.regionConfig = getRegionConfig(this.region);
    this.token = token || null;
    this.cookieJar = cookieJar instanceof CookieJar ? cookieJar : new CookieJar(cookieJar || []);
    this.fetch = fetchImpl;

    if (!this.fetch) {
      throw new Error("No fetch implementation available. Use Node.js 22 or newer.");
    }
  }

  static async authenticate({ region, tenant, email, password, fetchImpl = globalThis.fetch } = {}) {
    const normalizedRegion = normalizeRegion(region || "us");
    const regionConfig = getRegionConfig(normalizedRegion);
    const missing = [];
    if (!tenant) missing.push("tenant");
    if (!email) missing.push("email");
    if (!password) missing.push("password");
    if (missing.length) {
      throw new Error(`Missing authentication field(s): ${missing.join(", ")}.`);
    }

    const cookieJar = new CookieJar();
    const url = new URL("/api/login/generatetoken", regionConfig.authBaseUrl);
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        tenant
      })
    });

    cookieJar.storeFromHeaders(url, response.headers);
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw apiErrorFromResponse("HammerTech authentication failed", response, body);
    }

    const token = body?.token;
    if (!token || typeof token !== "string") {
      throw new Error("HammerTech authentication response did not include a token property.");
    }

    return new HammerTechClient({
      region: normalizedRegion,
      token,
      cookieJar,
      fetchImpl
    });
  }

  async cookieLogin({ url, method = "POST", body, headers = {} } = {}) {
    if (!url) throw new Error("cookieLogin requires a URL.");
    const requestHeaders = removeUndefined({
      accept: "application/json",
      "content-type": body === undefined ? undefined : "application/json",
      ...headers
    });
    const response = await this.fetch(url, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    this.cookieJar.storeFromHeaders(url, response.headers);
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw apiErrorFromResponse("HammerTech cookie login failed", response, responseBody);
    }
    return responseBody;
  }

  async request(method, pathOrUrl, { query, body, headers = {}, bearer = true, cookies = true } = {}) {
    const url = this.resolveUrl(pathOrUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    const requestHeaders = {
      accept: "application/json",
      ...headers
    };

    if (bearer && this.token) {
      requestHeaders.authorization = `Bearer ${this.token}`;
    }

    if (cookies) {
      const cookieHeader = this.cookieJar.headerFor(url);
      if (cookieHeader) requestHeaders.cookie = cookieHeader;
    }

    let requestBody;
    if (body !== undefined) {
      requestHeaders["content-type"] = requestHeaders["content-type"] || "application/json";
      requestBody = typeof body === "string" ? body : JSON.stringify(body);
    }

    if (method !== "GET" && method !== "HEAD") {
      requestHeaders["x-request-id"] = requestHeaders["x-request-id"] || randomUUID();
    }

    const response = await this.fetch(url, {
      method,
      headers: requestHeaders,
      body: requestBody
    });

    this.cookieJar.storeFromHeaders(url, response.headers);
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      throw apiErrorFromResponse("HammerTech API request failed", response, responseBody);
    }
    return responseBody;
  }

  resolveUrl(pathOrUrl) {
    if (!pathOrUrl) throw new Error("Missing request path or URL.");
    if (/^https?:\/\//i.test(pathOrUrl)) return new URL(pathOrUrl);
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return new URL(path, this.regionConfig.apiBaseUrl);
  }

  listUsers(query = {}) {
    return this.request("GET", "/api/v1/Users", { query });
  }

  getUser(id) {
    return this.request("GET", `/api/v1/Users/${encodeURIComponent(id)}`);
  }

  createUser(payload) {
    return this.request("POST", "/api/v1/Users", { body: payload });
  }

  patchUser(id, payload, query = {}) {
    return this.request("PATCH", `/api/v1/Users/${encodeURIComponent(id)}`, { query, body: payload });
  }

  deleteUser(id) {
    return this.request("DELETE", `/api/v1/Users/${encodeURIComponent(id)}`);
  }

  listProjects(query = {}) {
    return this.request("GET", "/api/v1/Projects", { query });
  }

  getProject(id) {
    return this.request("GET", `/api/v1/Projects/${encodeURIComponent(id)}`);
  }

  createProject(payload) {
    return this.request("POST", "/api/v1/Projects", { body: payload });
  }

  patchProject(id, payload) {
    return this.request("PATCH", `/api/v1/Projects/${encodeURIComponent(id)}`, { body: payload });
  }

  listEmployerProfiles(query = {}) {
    return this.request("GET", "/api/v1/EmployerProfiles", { query });
  }

  getEmployerProfile(id) {
    return this.request("GET", `/api/v1/EmployerProfiles/${encodeURIComponent(id)}`);
  }

  createEmployerProfile(payload) {
    return this.request("POST", "/api/v1/EmployerProfiles", { body: payload });
  }

  patchEmployerProfile(id, payload) {
    return this.request("PATCH", `/api/v1/EmployerProfiles/${encodeURIComponent(id)}`, { body: payload });
  }

  toSession({ tenant, email } = {}) {
    return {
      region: this.region,
      tenant: tenant || null,
      email: email || null,
      token: this.token,
      cookies: this.cookieJar.toJSON(),
      savedAt: new Date().toISOString()
    };
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json") || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function apiErrorFromResponse(prefix, response, responseBody) {
  const messageText = responseBody?.messageText || responseBody?.message || responseBody?.title;
  const message = messageText
    ? `${prefix}: ${response.status} ${response.statusText} - ${messageText}`
    : `${prefix}: ${response.status} ${response.statusText}`;
  return new HammerTechApiError(message, {
    status: response.status,
    statusText: response.statusText,
    responseBody,
    requestId: responseBody?.xRequestId
  });
}

function parseSetCookie(header, url) {
  if (!header) return null;
  const sourceUrl = new URL(url);
  const parts = header.split(";").map((part) => part.trim()).filter(Boolean);
  const [nameValue, ...attributes] = parts;
  const equalsIndex = nameValue.indexOf("=");
  if (equalsIndex <= 0) return null;

  const cookie = {
    name: nameValue.slice(0, equalsIndex),
    value: nameValue.slice(equalsIndex + 1),
    domain: sourceUrl.hostname.toLowerCase(),
    path: "/",
    expires: null,
    secure: false,
    httpOnly: false
  };

  for (const attribute of attributes) {
    const [rawName, ...rawValue] = attribute.split("=");
    const attrName = rawName.toLowerCase();
    const attrValue = rawValue.join("=");
    if (attrName === "domain" && attrValue) cookie.domain = attrValue.replace(/^\./, "").toLowerCase();
    if (attrName === "path" && attrValue) cookie.path = attrValue;
    if (attrName === "expires" && attrValue) cookie.expires = attrValue;
    if (attrName === "secure") cookie.secure = true;
    if (attrName === "httponly") cookie.httpOnly = true;
  }

  return cookie;
}

function splitCombinedSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((part) => part.trim()).filter(Boolean);
}

function domainMatches(host, cookieDomain) {
  const domain = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
