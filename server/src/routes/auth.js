/**
 * OAuth 2.0 routes for Gmail account authorization:
 *   GET  /auth/start/:email   — begin OAuth flow (redirects to Google)
 *   GET  /auth/callback       — Google redirects here; exchanges code for tokens
 *   POST /auth/revoke/:email  — remove tokens, stop syncing that account
 *
 * CSRF protection: a cryptographically random `state` token is generated per
 * OAuth initiation, stored in an in-memory Map, and validated on callback.
 * Tokens expire after 10 minutes.
 *
 * NOTE: In-memory state store is single-process only. For multi-process
 * deployments, move pendingStates to Redis or MongoDB.
 */

const crypto = require("crypto");
const { google } = require("googleapis");
const { AccountCredentials } = require("../config/db");
const env = require("../config/env");
const log = require("../utils/logger");
const { sendJson, sendHtml, htmlPage, escHtml } = require("../utils/http");

const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
];

const REDIRECT_URI = `${env.BASE_URL}/auth/callback`;

// ── CSRF state store ──────────────────────────────────────────────────────────
const pendingStates = new Map(); // token → { email, expiresAt }
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Clean up expired state tokens every minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [token, meta] of pendingStates.entries()) {
    if (now > meta.expiresAt) {
      pendingStates.delete(token);
      cleaned++;
    }
  }
  if (cleaned > 0) log.debug("AUTH", `Cleaned ${cleaned} expired CSRF state token(s)`);
}, 60_000);

function createStateToken(email) {
  // Remove stale pending state for this email before creating a new one
  for (const [token, meta] of pendingStates.entries()) {
    if (meta.email === email) pendingStates.delete(token);
  }
  const token = crypto.randomBytes(32).toString("hex");
  pendingStates.set(token, { email, expiresAt: Date.now() + STATE_TTL_MS });
  log.debug("AUTH", `CSRF state token created for ${email}`);
  return token;
}

function consumeStateToken(token) {
  const meta = pendingStates.get(token);
  if (!meta) return null;
  pendingStates.delete(token);
  if (Date.now() > meta.expiresAt) {
    log.warn("AUTH", `CSRF state token expired for ${meta.email}`);
    return null;
  }
  return meta.email;
}

// ── OAuth2 client factory ─────────────────────────────────────────────────────
function makeOAuth2Client() {
  return new google.auth.OAuth2(
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    REDIRECT_URI,
  );
}

// ── Route handlers ────────────────────────────────────────────────────────────
async function handleAuthStart(req, res, email) {
  const decodedEmail = decodeURIComponent(email).toLowerCase().trim();

  if (!decodedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decodedEmail)) {
    log.warn("AUTH", `Invalid email in auth start: "${decodedEmail}"`);
    return sendHtml(
      res,
      400,
      htmlPage(
        "Bad Request",
        `<div class="alert alert-error">Invalid email address: <code>${escHtml(decodedEmail)}</code></div>`,
      ),
    );
  }

  log.oauthStart(decodedEmail);

  const state = createStateToken(decodedEmail);
  const oauth2Client = makeOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: OAUTH_SCOPES,
    // prompt=consent forces Google to return a refresh_token on every auth.
    // Without this, Google only issues a refresh_token on the first authorization.
    prompt: "consent",
    login_hint: decodedEmail,
    state,
  });

  log.info("AUTH", `Redirecting ${decodedEmail} to Google consent page`);
  res.writeHead(302, { Location: authUrl });
  res.end();
}

async function handleAuthCallback(req, res, query) {
  const { code, state, error } = query;

  if (error) {
    log.warn("AUTH", `OAuth consent denied or error returned by Google: ${error}`);
    return sendHtml(
      res,
      400,
      htmlPage(
        "Authorization Denied",
        `<div class="alert alert-error">
          Google returned an error: <code>${escHtml(error)}</code><br/>
          The user may have denied access, or the OAuth app is misconfigured.
          <br/><br/><a class="btn btn-primary" href="${escHtml(env.FRONTEND_URL)}">Back to Dashboard</a>
        </div>`,
      ),
    );
  }

  if (!code || !state) {
    log.warn("AUTH", "OAuth callback missing code or state parameter");
    return sendHtml(
      res,
      400,
      htmlPage(
        "Bad Request",
        `<div class="alert alert-error">Missing <code>code</code> or <code>state</code> parameter.</div>`,
      ),
    );
  }

  const email = consumeStateToken(state);
  if (!email) {
    log.warn("AUTH", "OAuth callback received invalid or expired CSRF state token — possible stale tab or CSRF attempt");
    return sendHtml(
      res,
      400,
      htmlPage(
        "Session Expired",
        `<div class="alert alert-error">
          The authorization session has expired or is invalid (possible stale browser tab).
          <br/><br/><a class="btn btn-primary" href="${escHtml(env.FRONTEND_URL)}">Back to Dashboard</a>
        </div>`,
      ),
    );
  }

  try {
    log.info("AUTH", `Exchanging authorization code for tokens for ${email}`);
    const oauth2Client = makeOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      log.warn(
        "AUTH",
        `Google did not return a refresh_token for ${email}. ` +
        "This usually means the account was previously authorized without prompt=consent.",
      );
      return sendHtml(
        res,
        400,
        htmlPage(
          "Missing Refresh Token",
          `<div class="alert alert-error">
            Google did not return a refresh token for <code>${escHtml(email)}</code>.<br/>
            Try revoking access in your
            <a href="https://myaccount.google.com/permissions" target="_blank" style="color:#93c5fd">
              Google Account Permissions
            </a>
            and then clicking Authorize again.
            <br/><br/><a class="btn btn-primary" href="${escHtml(env.FRONTEND_URL)}">Back to Dashboard</a>
          </div>`,
        ),
      );
    }

    await AccountCredentials.findOneAndUpdate(
      { email },
      {
        email,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token || null,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        authorized: true,
        authorizedAt: new Date(),
        lastSyncError: null,
        consecutiveErrors: 0,
      },
      { upsert: true, returnDocument: "after" },
    );

    log.oauthSuccess(email);
    log.info("AUTH", `Redirecting to frontend dashboard after successful auth for ${email}`);

    // Redirect browser back to the Next.js frontend dashboard
    res.writeHead(302, { Location: env.FRONTEND_URL + "?authorized=" + encodeURIComponent(email) });
    res.end();
  } catch (err) {
    log.error("AUTH", `Token exchange failed for ${email}`, err);
    sendHtml(
      res,
      500,
      htmlPage(
        "Token Exchange Failed",
        `<div class="alert alert-error">
          Failed to exchange authorization code: <code>${escHtml(err.message)}</code>
          <br/><br/><a class="btn btn-primary" href="${escHtml(env.FRONTEND_URL)}">Back to Dashboard</a>
        </div>`,
      ),
    );
  }
}

async function handleRevoke(req, res, email) {
  const decodedEmail = decodeURIComponent(email).toLowerCase().trim();

  if (!decodedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(decodedEmail)) {
    log.warn("AUTH", `Invalid email in revoke request: "${decodedEmail}"`);
    return sendJson(res, 400, { error: "Invalid email address" });
  }

  log.info("AUTH", `Revoke request received for ${decodedEmail}`);

  try {
    const acc = await AccountCredentials.findOne({ email: decodedEmail });

    if (!acc) {
      log.warn("AUTH", `Revoke: account not found in DB for ${decodedEmail}`);
      res.writeHead(302, { Location: env.FRONTEND_URL + "?error=account_not_found" });
      return res.end();
    }

    // Best-effort revocation with Google — don't fail the whole flow if this errors
    if (acc.accessToken) {
      try {
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({ access_token: acc.accessToken });
        await oauth2Client.revokeCredentials();
        log.info("AUTH", `Google-side token revoked for ${decodedEmail}`);
      } catch (revokeErr) {
        log.warn(
          "AUTH",
          `Google-side revocation failed for ${decodedEmail} (tokens may have expired): ${revokeErr.message}`,
        );
      }
    }

    await AccountCredentials.findOneAndUpdate(
      { email: decodedEmail },
      {
        refreshToken: null,
        accessToken: null,
        tokenExpiry: null,
        authorized: false,
        lastSyncError: "Manually revoked",
        syncLocked: false,
      },
    );

    log.oauthRevoked(decodedEmail);

    // Redirect back to the frontend dashboard
    res.writeHead(302, { Location: env.FRONTEND_URL + "?revoked=" + encodeURIComponent(decodedEmail) });
    res.end();
  } catch (err) {
    log.error("AUTH", `Revoke failed for ${decodedEmail}`, err);
    sendHtml(
      res,
      500,
      htmlPage("Error", `<div class="alert alert-error">Revoke failed: ${escHtml(err.message)}</div>`),
    );
  }
}

module.exports = {
  handleAuthStart,
  handleAuthCallback,
  handleRevoke,
  REDIRECT_URI,
};
