/**
 * HTTP server and request router for the Gmail Sync OAuth dashboard.
 *
 * Routes:
 *   GET  /                       — redirect to frontend dashboard
 *   GET  /health                 — liveness probe (JSON)
 *   GET  /auth/start/:email      — begin OAuth consent flow
 *   GET  /auth/callback          — OAuth callback from Google
 *   POST /auth/revoke/:email     — revoke account authorization
 *   GET  /api/accounts           — REST: list all accounts (JSON)
 *   GET  /api/accounts/:email    — REST: single account details (JSON)
 *   OPTIONS *                    — CORS preflight
 */

const http = require("http");
const env = require("./config/env");
const log = require("./utils/logger");
const { sendJson, sendHtml, htmlPage, parseQuery } = require("./utils/http");
const { handleAuthStart, handleAuthCallback, handleRevoke, REDIRECT_URI } = require("./routes/auth");
const {
  handleGetAccounts, handleGetAccount, handleAddAccount, handleSyncNow,
  handleGetSettings, handlePutSettings,
  handleHealth,
} = require("./routes/api");

// ── Body parser ───────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ── Request router ────────────────────────────────────────────────────────────
async function router(req, res) {
  const url = req.url || "/";
  const method = req.method || "GET";
  const path = url.split("?")[0];
  const query = parseQuery(url);
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const start = Date.now();

  log.debug("HTTP", `→ ${method} ${path} [${ip}]`);

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    log.request(method, path, ip, 204, Date.now() - start);
    return;
  }

  try {
    // ── Health check ─────────────────────────────────────────────────────────
    if (method === "GET" && path === "/health") {
      handleHealth(req, res);
      log.request(method, path, ip, 200, Date.now() - start);
      return;
    }

    // ── Root — redirect to frontend dashboard ────────────────────────────────
    if (method === "GET" && path === "/") {
      res.writeHead(302, { Location: env.FRONTEND_URL });
      res.end();
      log.request(method, path, ip, 302, Date.now() - start);
      return;
    }

    // ── REST API — settings ───────────────────────────────────────────────────
    if (method === "GET" && path === "/api/settings") {
      await handleGetSettings(req, res);
      log.request(method, path, ip, 200, Date.now() - start);
      return;
    }

    if (method === "PUT" && path === "/api/settings") {
      const body = await readBody(req);
      await handlePutSettings(req, res, body);
      log.request(method, path, ip, 200, Date.now() - start);
      return;
    }

    // ── REST API — add account ────────────────────────────────────────────────
    if (method === "POST" && path === "/api/accounts") {
      const body = await readBody(req);
      await handleAddAccount(req, res, body);
      log.request(method, path, ip, 201, Date.now() - start);
      return;
    }

    // ── REST API — accounts list ──────────────────────────────────────────────
    if (method === "GET" && path === "/api/accounts") {
      await handleGetAccounts(req, res);
      log.request(method, path, ip, 200, Date.now() - start);
      return;
    }

    // ── REST API — sync now ───────────────────────────────────────────────────
    const syncMatch = path.match(/^\/api\/accounts\/(.+)\/sync$/);
    if (method === "POST" && syncMatch) {
      await handleSyncNow(req, res, syncMatch[1]);
      log.request(method, path, ip, 202, Date.now() - start);
      return;
    }

    // ── REST API — single account ─────────────────────────────────────────────
    const accountMatch = path.match(/^\/api\/accounts\/(.+)$/);
    if (method === "GET" && accountMatch) {
      await handleGetAccount(req, res, accountMatch[1]);
      log.request(method, path, ip, 200, Date.now() - start);
      return;
    }

    // ── OAuth — start flow ────────────────────────────────────────────────────
    const startMatch = path.match(/^\/auth\/start\/(.+)$/);
    if (method === "GET" && startMatch) {
      await handleAuthStart(req, res, startMatch[1]);
      log.request(method, path, ip, 302, Date.now() - start);
      return;
    }

    // ── OAuth — callback ──────────────────────────────────────────────────────
    if (method === "GET" && path === "/auth/callback") {
      await handleAuthCallback(req, res, query);
      log.request(method, path, ip, 302, Date.now() - start);
      return;
    }

    // ── OAuth — revoke ────────────────────────────────────────────────────────
    const revokeMatch = path.match(/^\/auth\/revoke\/(.+)$/);
    if (method === "POST" && revokeMatch) {
      // Drain the request body (even if empty) to keep the socket healthy
      await new Promise((resolve) => {
        req.resume();
        req.on("end", resolve);
      });
      await handleRevoke(req, res, revokeMatch[1]);
      log.request(method, path, ip, 302, Date.now() - start);
      return;
    }

    // ── 404 fallback ──────────────────────────────────────────────────────────
    log.debug("HTTP", `404 — no route matched for ${method} ${path}`);
    sendJson(res, 404, { error: "Not found", path });
    log.request(method, path, ip, 404, Date.now() - start);
  } catch (err) {
    log.error("HTTP", `Unhandled error for ${method} ${path}: ${err.message}`, err);
    try {
      sendJson(res, 500, { error: "Internal server error" });
    } catch {
      // Response may already be partially written — nothing we can do
    }
    log.request(method, path, ip, 500, Date.now() - start);
  }
}

// ── Server factory ────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(router);

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log.error(
          "SERVER",
          `Port ${env.AUTH_PORT} is already in use. ` +
          "Stop the conflicting process or change AUTH_PORT in .env.",
        );
      } else {
        log.error("SERVER", `HTTP server error: ${err.message}`, err);
      }
      reject(err);
    });

    server.listen(env.AUTH_PORT, () => {
      log.info("SERVER", `HTTP server listening on port ${env.AUTH_PORT}`);
      log.info("SERVER", `API base      → ${env.BASE_URL}/api`);
      log.info("SERVER", `OAuth start   → ${env.BASE_URL}/auth/start/:email`);
      log.info("SERVER", `Redirect URI  → ${REDIRECT_URI}`);
      log.info("SERVER", `Frontend URL  → ${env.FRONTEND_URL}`);
      log.info("SERVER", "Ensure the redirect URI is registered in your Google Cloud OAuth client.");
      resolve(server);
    });
  });
}

module.exports = { startServer };
