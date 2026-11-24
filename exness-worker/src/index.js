const DEFAULT_GATEWAY = "https://api.exness.com";
const EMPTY_BODY_HASH = "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU";
const encoder = new TextEncoder();

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromHex(value) {
  if (!/^[0-9a-fA-F]{128}$/.test(value)) throw new Error("EXN_PRIVATE_KEY must be 128 hex characters or unencrypted PKCS#8 PEM");
  return Uint8Array.from(value.match(/.{2}/g), pair => parseInt(pair, 16));
}

function pemBytes(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(body);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function importSigningKey(value) {
  const input = value.trim();
  let pkcs8;
  if (input.startsWith("-----BEGIN PRIVATE KEY-----")) {
    pkcs8 = pemBytes(input);
  } else {
    const raw = fromHex(input);
    // Exness hex format: 32-byte seed followed by its 32-byte public key.
    // RFC 8410 PKCS#8 wrapper around the Ed25519 seed.
    pkcs8 = new Uint8Array(16 + 32);
    pkcs8.set([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
    pkcs8.set(raw.slice(0, 32), 16);
  }
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
}

async function signedGetHeaders(apiKey, privateKey, path) {
  const timestamp = Date.now();
  const payload = encoder.encode(JSON.stringify({
    api_key: apiKey,
    idempotency_key: "",
    timestamp,
    sign_version: 1,
    method: "GET",
    path,
    body_hash: EMPTY_BODY_HASH
  }));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, privateKey, payload));
  return {
    "EXN-API-KEY": apiKey,
    "EXN-IDEMPOTENCY-KEY": "",
    "EXN-TIMESTAMP": String(timestamp),
    "EXN-SIGN-VERSION": "1",
    "EXN-DATA": b64url(payload),
    "EXN-SIGN": b64url(signature),
    "User-Agent": "TradingAssistantG/1.0"
  };
}

function httpsBase(value, label) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(label + " must be an HTTPS origin without credentials, path, query, or fragment");
  }
  return url.origin;
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization,x-setup-token"
    }
  });
}

async function exnessGet(host, path, apiKey, key) {
  const response = await fetch(host + path, {
    method: "GET",
    headers: await signedGetHeaders(apiKey, key, path),
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: "Non-JSON response from upstream" }; }
  if (!response.ok) {
    // Never return upstream request headers or credential material.
    throw new Error("Exness request failed: HTTP " + response.status + (data?.error_message ? " " + String(data.error_message).slice(0, 100) : ""));
  }
  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "https://susantowijaya-hub.github.io";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": allowedOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-setup-token",
        "access-control-max-age": "86400"
      }});
    }
    if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403, allowedOrigin);

    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ service: "Trading Assistant G Exness read-only connector", status: "ready-for-secret-configuration", credentialsConfigured: Boolean(env.EXN_API_KEY && env.EXN_PRIVATE_KEY && env.EXN_ACCOUNT_ID && env.TA_SETUP_TOKEN) }, 200, allowedOrigin);
    }
    if (url.pathname !== "/auth-test" || request.method !== "POST") {
      return json({ error: "Not found" }, 404, allowedOrigin);
    }
    if (!env.TA_SETUP_TOKEN || request.headers.get("x-setup-token") !== env.TA_SETUP_TOKEN) {
      return json({ error: "Unauthorized" }, 401, allowedOrigin);
    }

    try {
      const apiKey = env.EXN_API_KEY;
      const accountId = String(env.EXN_ACCOUNT_ID || "");
      if (!apiKey || !env.EXN_PRIVATE_KEY || !/^[1-9][0-9]{0,19}$/.test(accountId) || BigInt(accountId) > 18446744073709551615n) {
        throw new Error("Missing or invalid backend secret configuration");
      }
      const gateway = httpsBase(env.EXN_DISCOVERY_BASE_URL || DEFAULT_GATEWAY, "EXN_DISCOVERY_BASE_URL");
      const privateKey = await importSigningKey(env.EXN_PRIVATE_KEY);

      const discoveryPath = "/v1/trading/access-point?account_id=" + accountId;
      const discovery = await exnessGet(gateway, discoveryPath, apiKey, privateKey);
      if (typeof discovery.access_point !== "string" || !discovery.access_point) {
        throw new Error("Discovery response did not contain access_point");
      }
      const accessPoint = httpsBase(discovery.access_point, "Discovered access_point");
      const accountPath = "/v1/configuration/accounts/" + accountId + "/account";
      await exnessGet(accessPoint, accountPath, apiKey, privateKey);

      return json({
        milestone: "passed",
        authentication: "success",
        discovery: "success",
        readOnlyAccountRequest: "HTTP 200",
        accessPointHost: new URL(accessPoint).host,
        accountIdSuffix: accountId.slice(-4),
        tradingOperations: "not implemented"
      }, 200, allowedOrigin);
    } catch (error) {
      return json({
        milestone: "not-passed",
        error: error instanceof Error ? error.message : "Unexpected connector error",
        nextAction: "Check the Gateway host, secret formats, account access, and Exness response diagnostics."
      }, 502, allowedOrigin);
    }
  }
};
