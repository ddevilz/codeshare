// ─────────────────────────────────────────────────────────────────────────────
// CodeDrop — Ephemeral Code Sharing Platform
// Cloudflare Worker + KV Storage  |  10-minute auto-expiry
// ─────────────────────────────────────────────────────────────────────────────

const TTL_SECONDS = 600; // 10 minutes

// ─── Routing ─────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // CORS headers for API routes
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // ── API: Create Snippet ──────────────────────────────────────────────────
    if (pathname === "/api/snippets" && request.method === "POST") {
      try {
        const body = await request.json();
        const { code, language, title } = body;

        if (!code || typeof code !== "string") {
          return json({ error: "code is required" }, 400, corsHeaders);
        }
        if (code.length > 500_000) {
          return json({ error: "code too large (max 500KB)" }, 413, corsHeaders);
        }

        const id = generateId();
        const snippet = {
          id,
          code,
          language: language || "plaintext",
          title: title || "Untitled Snippet",
          createdAt: Date.now(),
          expiresAt: Date.now() + TTL_SECONDS * 1000,
        };

        await env.SNIPPETS.put(id, JSON.stringify(snippet), {
          expirationTtl: TTL_SECONDS,
        });

        return json({ id, expiresAt: snippet.expiresAt }, 201, corsHeaders);
      } catch (err) {
        return json({ error: "Invalid request body" }, 400, corsHeaders);
      }
    }

    // ── API: Get Snippet ─────────────────────────────────────────────────────
    if (pathname.startsWith("/api/snippets/") && request.method === "GET") {
      const id = pathname.slice("/api/snippets/".length).trim();
      if (!id) return json({ error: "id required" }, 400, corsHeaders);

      const raw = await env.SNIPPETS.get(id);
      if (!raw) return json({ error: "Snippet not found or expired" }, 404, corsHeaders);

      const snippet = JSON.parse(raw);
      return json(snippet, 200, corsHeaders);
    }

    // ── Health Check ─────────────────────────────────────────────────────────
    if (pathname === "/health") {
      return json({ status: "ok", ts: Date.now() }, 200);
    }

    // ── SPA Fallback ─────────────────────────────────────────────────────────
    return env.ASSETS.fetch(new Request(new URL("/", request.url), request));
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

function generateId() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  const rand = crypto.getRandomValues(new Uint8Array(10));
  for (const b of rand) id += chars[b % chars.length];
  return id;
}
