// ============================================================================
// SourceOn — Edge Function: analyze-scan
// ----------------------------------------------------------------------------
// Nimmt einen hochgeladenen Scan/Plan/PDF entgegen, lässt ihn von einer KI
// (Vision) auslesen und liefert strukturierte Materialien zurück, die das
// Frontend dann in die Formularzeilen einträgt (Nutzer prüft & sendet normal ab).
//
// VERTRAG (das Frontend erwartet exakt dieses JSON):
//   POST  multipart/form-data  field "file"
//   ->  200 { "success": true,
//             "materials": [
//               { "sourceon_id": "BET-C2530",   // bevorzugt: exakte Katalog-ID
//                 "bezeichnung": "Beton C25/30", // Fallback-Text, falls keine ID
//                 "menge": "200 m³",
//                 "liefer_von": "2026-09-01",    // optional, ISO yyyy-mm-dd
//                 "liefer_bis": "2026-09-30" },  // optional
//               ...
//             ],
//             "note": "optionaler Hinweis" }
//   ->  4xx/5xx { "success": false, "error": "..." }
//
// DEPLOY:
//   supabase functions deploy analyze-scan
//   supabase secrets set AI_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=...
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  try {
    // 1) Datei aus dem multipart-Body lesen
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ success: false, error: "no file" }, 400);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = btoa(String.fromCharCode(...bytes));
    const mime = file.type || "application/octet-stream";

    // 2) Materialkatalog laden (für das Mapping auf sourceon_id)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: catalog } = await supabase
      .from("material_catalog")
      .select("sourceon_id,bezeichnung,kategorie,einheit");

    // 3) === KI-ANALYSE — HIER DEINE API EINBAUEN =============================
    // Ziel: aus `base64`/`mime` (dem Scan) + `catalog` eine Liste von
    // { sourceon_id?, bezeichnung?, menge, liefer_von?, liefer_bis? } erzeugen.
    //
    // Beispiel-Skizze (Anthropic Claude Vision) — vor dem Launch aktivieren:
    //
    // const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
    //   method: "POST",
    //   headers: {
    //     "x-api-key": Deno.env.get("AI_API_KEY")!,
    //     "anthropic-version": "2023-06-01",
    //     "content-type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     model: "claude-sonnet-5",
    //     max_tokens: 2000,
    //     messages: [{
    //       role: "user",
    //       content: [
    //         { type: "image", source: { type: "base64", media_type: mime, data: base64 } },
    //         { type: "text", text:
    //           "Lies die Baustoff-Positionen aus. Gib NUR JSON zurück: " +
    //           "{\"materials\":[{\"bezeichnung\":\"…\",\"menge\":\"… Einheit\"," +
    //           "\"liefer_von\":\"yyyy-mm-dd\",\"liefer_bis\":\"yyyy-mm-dd\"}]}. " +
    //           "Ordne jede Position, wenn möglich, diesem Katalog zu und nutze dessen " +
    //           "sourceon_id: " + JSON.stringify(catalog) },
    //       ],
    //     }],
    //   }),
    // });
    // const aiJson = await aiResp.json();
    // const parsed = JSON.parse(aiJson.content[0].text);
    // let materials = parsed.materials || [];
    //
    // Solange keine API hinterlegt ist: leere, klar signalisierte Antwort.
    const AI_KEY = Deno.env.get("AI_API_KEY");
    if (!AI_KEY) {
      return json({ success: false, error: "AI not configured yet" }, 501);
    }
    let materials: unknown[] = [];
    // TODO(launch): materials = <Ergebnis deiner KI, gemappt auf sourceon_id>
    // =======================================================================

    return json({ success: true, materials, note: "" });
  } catch (err) {
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
