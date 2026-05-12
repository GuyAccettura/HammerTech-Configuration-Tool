#!/usr/bin/env node

import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAuthOptions } from "./config.js";
import { HammerTechClient } from "./http.js";
import { readSpreadsheetRowsFromBuffer } from "./spreadsheet.js";
import { clientFromSession, deleteSession, loadSession, saveSession } from "./session.js";
import { executeUserOperations, listAllUsers, planUserOperations } from "./users.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicRoot = join(projectRoot, "public");
const defaultSessionPath = ".hammertech/session.json";
const maxBodyBytes = 25 * 1024 * 1024;

export function createAppServer({ sessionPath = process.env.HAMMERTECH_SESSION_PATH || defaultSessionPath } = {}) {
  return createServer(async (request, response) => {
    try {
      await route(request, response, { sessionPath });
    } catch (error) {
      sendJson(response, error.statusCode || 500, {
        error: error.message || "Unexpected server error",
        responseBody: error.responseBody
      });
    }
  });
}

async function route(request, response, context) {
  const url = new URL(request.url, "http://127.0.0.1");

  if (url.pathname.startsWith("/api/")) {
    return routeApi(request, response, url, context);
  }

  return serveStatic(request, response, url);
}

async function routeApi(request, response, url, context) {
  if (request.method === "GET" && url.pathname === "/api/session") {
    const session = await loadSession(context.sessionPath);
    return sendJson(response, 200, summarizeSession(session));
  }

  if (request.method === "DELETE" && url.pathname === "/api/session") {
    await deleteSession(context.sessionPath);
    return sendJson(response, 200, { authenticated: false });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/token") {
    const body = await readJsonBody(request);
    const client = await HammerTechClient.authenticate(body);
    if (body.saveSession !== false) {
      await saveSession(context.sessionPath, client.toSession({ tenant: body.tenant, email: body.email }));
    }
    return sendJson(response, 200, summarizeSession(client.toSession({ tenant: body.tenant, email: body.email })));
  }

  if (request.method === "GET" && url.pathname === "/api/users") {
    const client = await authenticatedClient(context.sessionPath);
    const users = await listAllUsers(client, queryObject(url));
    return sendJson(response, 200, { users });
  }

  if (request.method === "POST" && url.pathname === "/api/users") {
    const client = await authenticatedClient(context.sessionPath);
    const body = await readJsonBody(request);
    return sendJson(response, 200, await client.createUser(body));
  }

  if (request.method === "POST" && (url.pathname === "/api/users/import/plan" || url.pathname === "/api/users/import/apply")) {
    const apply = url.pathname.endsWith("/apply");
    const fileName = request.headers["x-file-name"] || "users.csv";
    const buffer = await readBody(request);
    const rows = await readSpreadsheetRowsFromBuffer(String(fileName), buffer, {
      sheet: url.searchParams.get("sheet") || undefined
    });
    const plan = planUserOperations(rows, {
      defaultAction: url.searchParams.get("action") || "create"
    });
    const client = apply ? await authenticatedClient(context.sessionPath) : null;
    const results = await executeUserOperations(client, plan.operations, {
      apply,
      matchByEmail: url.searchParams.get("matchByEmail") === "true",
      continueOnError: url.searchParams.get("continueOnError") === "true"
    });
    return sendJson(response, 200, {
      rowCount: rows.length,
      hasErrors: results.some((result) => result.status === "invalid" || result.status === "failed"),
      results
    });
  }

  if (url.pathname.startsWith("/api/users/")) {
    const client = await authenticatedClient(context.sessionPath);
    const id = decodeURIComponent(url.pathname.slice("/api/users/".length));
    if (!id) throw httpError(400, "Missing user id.");
    if (request.method === "GET") return sendJson(response, 200, await client.getUser(id));
    if (request.method === "PATCH") return sendJson(response, 200, await client.patchUser(id, await readJsonBody(request)));
    if (request.method === "DELETE") return sendJson(response, 200, await client.deleteUser(id));
  }

  if (request.method === "POST" && url.pathname === "/api/request") {
    const client = await authenticatedClient(context.sessionPath);
    const body = await readJsonBody(request);
    const result = await client.request(required(body.method, "method").toUpperCase(), required(body.url, "url"), {
      body: body.body === "" || body.body === undefined ? undefined : body.body,
      bearer: body.cookieOnly ? false : true,
      cookies: body.noCookies ? false : true
    });
    return sendJson(response, 200, result);
  }

  throw httpError(404, "Not found.");
}

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw httpError(405, "Method not allowed.");
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const requestedPath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicRoot, `.${requestedPath}`);
  if (!filePath.startsWith(publicRoot)) throw httpError(403, "Forbidden.");

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store"
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code === "ENOENT") {
      const index = await readFile(join(publicRoot, "index.html"));
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(index);
      return;
    }
    throw error;
  }
}

async function authenticatedClient(sessionPath) {
  const auth = resolveAuthOptions({ session: sessionPath });
  const session = await loadSession(auth.sessionPath);
  if (!session?.token && !session?.cookies?.length) {
    throw httpError(401, "No HammerTech session. Sign in first.");
  }
  return clientFromSession(session);
}

function summarizeSession(session) {
  return {
    authenticated: Boolean(session?.token || session?.cookies?.length),
    region: session?.region || null,
    tenant: session?.tenant || null,
    email: session?.email || null,
    hasBearerToken: Boolean(session?.token),
    cookieCount: session?.cookies?.length || 0,
    savedAt: session?.savedAt || null
  };
}

async function readJsonBody(request) {
  const buffer = await readBody(request);
  if (!buffer.length) return {};
  return JSON.parse(buffer.toString("utf8"));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function queryObject(url) {
  return Object.fromEntries(Array.from(url.searchParams.entries()).filter(([, value]) => value !== ""));
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw httpError(400, `Missing ${name}.`);
  return value;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function contentType(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || "127.0.0.1";
  const server = createAppServer();
  server.listen(port, host, () => {
    process.stdout.write(`HammerTech Configuration Tool UI: http://${host}:${port}\n`);
  });
}
