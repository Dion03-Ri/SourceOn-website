// chat — serverseitiger Proxy für den öffentlichen SourceOn-Chatbot.
// Der Anthropic-API-Key liegt AUSSCHLIESSLICH serverseitig (Env ANTHROPIC_API_KEY)
// und wird nie an den Browser ausgeliefert. Der Client sendet nur den
// Gesprächsverlauf; der System-Prompt wird serverseitig fest gesetzt, damit
// der Key nicht als kostenloser Fremd-LLM missbraucht werden kann.
//
// Deploy: Function "chat", Verify JWT = AUS.
// Secret setzen: ANTHROPIC_API_KEY = <dein Anthropic-Key>

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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
