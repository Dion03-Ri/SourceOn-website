// chat — serverseitiger Proxy für den öffentlichen SourceOn-Chatbot.
// Der Anthropic-API-Key liegt AUSSCHLIESSLICH serverseitig (Env ANTHROPIC_API_KEY)
// und wird nie an den Browser ausgeliefert. Der Client sendet nur den
// Gesprächsverlauf; der System-Prompt wird serverseitig fest gesetzt, damit
// der Key nicht als kostenloser Fremd-LLM missbraucht werden kann.
//
// Deploy: Function "chat", Verify JWT = AUS.
// Secret setzen: ANTHROPIC_API_KEY = <dein Anthropic-Key>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// --- Rate-Limiting (pro Client-IP) -----------------------------------------
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
// true = Limit ueberschritten. Fail-open bei Limiter-Fehler (echte Nutzer nicht blocken).
async function overLimit(bucket: string, ip: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc("rate_limit_hit", {
      p_bucket: bucket, p_identifier: ip, p_max: max, p_window_seconds: windowSec,
    });
    if (error) { console.error("[rate_limit_hit]", error.message); return false; }
    return data === false;
  } catch (e) { console.error("[rate_limit_hit]", e); return false; }
}

// Fester System-Prompt (serverseitig, nicht vom Client überschreibbar).
const SYSTEM =
  "Du bist der offizielle SourceOn Assistent. SourceOn ist ein Schweizer B2B " +
  "Beschaffungsvermittler für die Baubranche. Provision: 2.25% auf Materialwert, " +
  "nur bei nachgewiesener Ersparnis. Antworte immer auf Deutsch, kurz und präzise, " +
  "maximal 3 Sätze. Beantworte ausschliesslich Fragen zu SourceOn und der " +
  "Baumaterial-Beschaffung. Bei themenfremden oder unangemessenen Anfragen " +
  "verweise höflich auf info@sourceon.ch.";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 300;
const MAX_MESSAGES = 20;      // Verlaufslänge begrenzen
const MAX_CHARS = 2000;       // pro Nachricht

interface Msg { role: string; content: unknown; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  // Rate-Limit: bezahlter LLM -> Kosten-/DoS-Schutz. 15/Min und 150/Std pro IP.
  const ip = clientIp(req);
  if (await overLimit("chat_min", ip, 15, 60) || await overLimit("chat_hour", ip, 150, 3600)) {
    return json({ error: "rate_limited" }, 429);
  }

  let body: { messages?: Msg[] };
  try { body = await req.json(); } catch { return json({ error: "bad_request" }, 400); }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  // Validieren + säubern: nur user/assistant, Strings, gekappt.
  const messages = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: (m.content as string).slice(0, MAX_CHARS) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return json({ error: "no_user_message" }, 400);
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM, messages }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.error("anthropic_error", r.status, t.slice(0, 500));
      return json({ error: "upstream_error" }, 502);
    }
    const d = await r.json();
    const reply = d?.content?.[0]?.text ?? null;
    if (!reply) return json({ error: "empty_reply" }, 502);
    return json({ reply });
  } catch (e) {
    console.error("chat_exception", String(e));
    return json({ error: "exception" }, 500);
  }
});
