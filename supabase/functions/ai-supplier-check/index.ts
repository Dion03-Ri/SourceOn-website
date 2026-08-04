import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function buildPrompt(s: Record<string, unknown>): string {
  const mats = Array.isArray(s.materials) ? s.materials.join(", ") : (s.materials || "nicht angegeben");
  const regs = Array.isArray(s.regions) ? s.regions.join(", ") : (s.regions || "nicht angegeben");
  const certs = Array.isArray(s.certifications) ? s.certifications.join(", ") : (s.certifications || "keine");

  return `Du bist ein Prüfassistent für SourceOn, einen Schweizer B2B-Marktplatz für Baumaterialien.

Bewerte die folgende Lieferanten-Bewerbung auf Plausibilität und Vertrauenswürdigkeit.

BEWERBUNGSDATEN:
- Firmenname: ${s.company_name || "nicht angegeben"}
- Kontaktperson: ${s.contact_person || "nicht angegeben"}
- E-Mail: ${s.email || "nicht angegeben"}
- Telefon: ${s.phone || "nicht angegeben"}
- Website: ${s.website || "nicht angegeben"}
- Materialien: ${mats}
- Regionen: ${regs}
- Jahreskapazität: ${s.annual_capacity || "nicht angegeben"}
- Zertifikate: ${certs}
- Notizen: ${s.notes || "keine"}

PRÜFE FOLGENDES:
1. Stimmt die E-Mail-Domain mit der Website-Domain überein? (Falls Website angegeben)
2. Sind die angegebenen Materialien und die Jahreskapazität plausibel zusammen? (z.B. "Vollsortiment" mit sehr niedriger Kapazität wäre verdächtig)
3. Enthalten Firmenname, Kontaktdaten oder Notizen offensichtlich verdächtige, unvollständige oder Platzhalter-Inhalte? (z.B. "test", "asdf", offensichtlich erfundene Namen)
4. Sieht die Bewerbung insgesamt nach einem seriösen Schweizer Bauzulieferer aus?

ANTWORTE AUSSCHLIESSLICH mit einem JSON-Objekt in genau diesem Format (keine Markdown-Codeblöcke, kein zusätzlicher Text):
{"score": <Ganzzahl 0-100, wobei 100 = höchst vertrauenswürdig/plausibel>, "assessment": "<kurze deutsche Zusammenfassung in 1-2 Sätzen, die den Score erklärt>", "flags": ["<kurze Flag-Strings wie domain_mismatch, incomplete_info, capacity_mismatch, placeholder_content, suspicious_name>"]}`;
}

function parseGeminiResponse(responseBody: Record<string, unknown>): { score: number; assessment: string; flags: string[] } | null {
  try {
    const candidates = responseBody.candidates as Array<Record<string, unknown>>;
    if (!candidates || candidates.length === 0) return null;
    const content = candidates[0].content as Record<string, unknown>;
    if (!content) return null;
    const parts = content.parts as Array<Record<string, unknown>>;
    if (!parts || parts.length === 0) return null;
    let text = parts[0].text as string;
    if (!text) return null;

    // Strip markdown code fences if present
    text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    const parsed = JSON.parse(text);
    if (typeof parsed.score !== "number" || typeof parsed.assessment !== "string") return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(parsed.score))),
      assessment: parsed.assessment,
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    };
  } catch (e) {
    console.error("[ai-supplier-check] Failed to parse Gemini response:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  try {
    // --- Interner Auth-Check ---
    // Verify JWT ist AUS (die Function wird vom DB-Trigger server-to-server aufgerufen),
    // daher MUSS die Function selbst pruefen. Nur Aufrufe mit dem geheimen Header
    // x-ai-secret (den nur der DB-Trigger kennt) duerfen das bezahlte Gemini ausloesen.
    // Ohne diesen Check waere die Function fuer jeden im Internet aufrufbar.
    const triggerSecret = Deno.env.get("AI_TRIGGER_SECRET");
    if (!triggerSecret || req.headers.get("x-ai-secret") !== triggerSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const sb = createClient(supabaseUrl, supabaseKey);

    if (!geminiKey) {
      return Response.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    // Accept optional supplier_id from request body, otherwise process all unchecked pending
    let targetIds: string[] = [];
    try {
      const body = await req.json();
      if (body.supplier_id) targetIds = [body.supplier_id];
      // Webhook trigger from Supabase sends record in body
      if (body.record && body.record.id) targetIds = [body.record.id];
    } catch {
      // No body or invalid JSON — process all unchecked
    }

    let query = sb
      .from("suppliers")
      .select("id, company_name, contact_person, email, phone, website, materials, regions, annual_capacity, certifications, notes, status");

    if (targetIds.length > 0) {
      query = query.in("id", targetIds);
    } else {
      query = query.eq("status", "pending").is("ai_checked_at", null);
    }

    const { data: suppliers, error: fetchErr } = await query;

    if (fetchErr) {
      return Response.json({ error: "Failed to fetch suppliers", detail: fetchErr.message }, { status: 500 });
    }

    if (!suppliers || suppliers.length === 0) {
      return Response.json({ message: "No suppliers to check", checked: 0 });
    }

    const results: Array<{ id: string; company_name: string; score: number | null; flags: string[] }> = [];

    for (const supplier of suppliers) {
      console.log(`[ai-supplier-check] Processing: ${supplier.company_name} (${supplier.id})`);

      try {
        const prompt = buildPrompt(supplier);

        const geminiResp = await fetch(GEMINI_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 500,
            },
          }),
        });

        if (!geminiResp.ok) {
          const errText = await geminiResp.text();
          console.error(`[ai-supplier-check] Gemini API error for ${supplier.id}: ${geminiResp.status} ${errText}`);
          console.error(`[ai-supplier-check] Gemini error: ${geminiResp.status} - ${errText}`);
          results.push({ id: supplier.id, company_name: supplier.company_name, score: null, flags: ["api_error"] });
          continue;
        }

        const geminiBody = await geminiResp.json();
        const parsed = parseGeminiResponse(geminiBody);

        if (!parsed) {
          console.error(`[ai-supplier-check] Could not parse Gemini response for ${supplier.id}`);
          results.push({ id: supplier.id, company_name: supplier.company_name, score: null, flags: ["parse_error"] });
          continue;
        }

        // Update supplier row — NEVER touches the status field
        const { error: updateErr } = await sb
          .from("suppliers")
          .update({
            ai_score: parsed.score,
            ai_assessment: parsed.assessment,
            ai_flags: parsed.flags,
            ai_checked_at: new Date().toISOString(),
          })
          .eq("id", supplier.id);

        if (updateErr) {
          console.error(`[ai-supplier-check] Failed to update supplier ${supplier.id}:`, updateErr);
        } else {
          console.log(`[ai-supplier-check] ${supplier.company_name}: score=${parsed.score}, flags=[${parsed.flags.join(", ")}]`);
        }

        results.push({
          id: supplier.id,
          company_name: supplier.company_name,
          score: parsed.score,
          flags: parsed.flags,
        });
      } catch (e) {
        console.error(`[ai-supplier-check] Unexpected error for ${supplier.id}:`, e);
        results.push({ id: supplier.id, company_name: supplier.company_name, score: null, flags: ["unexpected_error"] });
      }
    }

    console.log(`[ai-supplier-check] Checked ${results.length} supplier(s)`);

    return Response.json({
      checked: results.length,
      results,
    });
  } catch (err) {
    console.error("[ai-supplier-check] Unexpected error:", err);
    return Response.json({ error: "Internal error", detail: String(err) }, { status: 500 });
  }
});
