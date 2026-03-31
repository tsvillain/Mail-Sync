/**
 * Shared HTTP response helpers and HTML template utilities.
 */

// ── JSON response ─────────────────────────────────────────────────────────────
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

// ── HTML response ─────────────────────────────────────────────────────────────
function sendHtml(res, status, html) {
  const buf = Buffer.from(html, "utf-8");
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buf.length,
    "X-Content-Type-Options": "nosniff",
  });
  res.end(buf);
}

// ── HTML template ─────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
           background: #0f172a; color: #e2e8f0; min-height: 100vh; padding: 2rem; }
    h1 { font-size: 1.6rem; font-weight: 700; color: #f8fafc; margin-bottom: 0.25rem; }
    h2 { font-size: 1.1rem; color: #94a3b8; font-weight: 400; margin-bottom: 2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px;
            padding: 1.25rem 1.5rem; margin-bottom: 1rem;
            display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; }
    .email { font-size: 1rem; font-weight: 600; flex: 1; min-width: 200px; }
    .badge { display: inline-block; padding: 0.2rem 0.65rem; border-radius: 99px;
             font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; }
    .badge-ok      { background: #166534; color: #bbf7d0; }
    .badge-err     { background: #7f1d1d; color: #fecaca; }
    .badge-pending { background: #1e3a5f; color: #bfdbfe; }
    .meta { font-size: 0.78rem; color: #64748b; flex: 2; min-width: 200px; }
    .actions { display: flex; gap: 0.5rem; }
    a.btn, button.btn {
      display: inline-block; padding: 0.4rem 1rem; border-radius: 6px;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; text-decoration: none;
      border: none; transition: opacity .15s;
    }
    a.btn:hover, button.btn:hover { opacity: 0.85; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-success { background: #16a34a; color: #fff; }
    .btn-warn    { background: #b45309; color: #fff; }
    .btn-danger  { background: #dc2626; color: #fff; }
    .alert { padding: 1rem 1.5rem; border-radius: 10px; margin-bottom: 1.5rem;
             font-size: 0.9rem; }
    .alert-success { background: #14532d; border: 1px solid #166534; color: #bbf7d0; }
    .alert-error   { background: #450a0a; border: 1px solid #7f1d1d; color: #fecaca; }
    .alert-info    { background: #0c1a3a; border: 1px solid #1e3a5f; color: #bfdbfe; }
    code { background: #0f172a; padding: 0.1rem 0.35rem; border-radius: 4px;
           font-size: 0.82rem; color: #67e8f9; }
    .section-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase;
                     letter-spacing: 0.1em; color: #475569; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>Gmail Sync — Account Manager</h1>
  <h2>OAuth Dashboard</h2>
  ${body}
</body>
</html>`;
}

// ── Query string parser ───────────────────────────────────────────────────────
function parseQuery(url) {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return {};
  const params = new URLSearchParams(url.slice(qIndex + 1));
  return Object.fromEntries(params.entries());
}

module.exports = { sendJson, sendHtml, htmlPage, escHtml, parseQuery };
