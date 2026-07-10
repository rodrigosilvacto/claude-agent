// Generates (or regenerates) a 3-5 line AI summary for an uploaded report.
// Login is temporarily disabled for the panel (see migration 0003), so this
// function does not require an authenticated session — the report itself is
// fetched/updated with the service role so RLS never blocks this path.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-opus-4-8";

const PROMPT =
  "Resuma o conteúdo deste documento em 3 a 5 linhas, em português, destacando o tema principal, as principais conclusões e para quem o material é relevante. Responda apenas com o resumo, sem introduções nem comentários adicionais.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let reportId: string | undefined;
  try {
    ({ reportId } = await req.json());
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }
  if (!reportId) {
    return json({ error: "reportId é obrigatório." }, 400);
  }

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: report, error: reportError } = await serviceClient
    .from("reports")
    .select("id, file_path, file_name, file_type")
    .eq("id", reportId)
    .maybeSingle();

  if (reportError || !report) {
    return json({ error: "Report não encontrado." }, 404);
  }

  if (!ANTHROPIC_API_KEY) {
    await serviceClient.from("reports").update({ summary_status: "error" }).eq("id", reportId);
    return json({ error: "ANTHROPIC_API_KEY não configurada no projeto Supabase." }, 500);
  }

  try {
    const { data: fileBlob, error: downloadError } = await serviceClient.storage
      .from("reports")
      .download(report.file_path);

    if (downloadError || !fileBlob) {
      throw new Error("Falha ao baixar arquivo do storage.");
    }

    const summary = await summarizeFile(fileBlob, report.file_name);

    await serviceClient
      .from("reports")
      .update({ summary, summary_status: "ready", updated_at: new Date().toISOString() })
      .eq("id", reportId);

    return json({ summary, status: "ready" });
  } catch (err) {
    console.error("generate-summary failed:", err);
    await serviceClient.from("reports").update({ summary_status: "error" }).eq("id", reportId);
    return json({ error: "Falha ao gerar resumo. O report continua visível e pode ser reprocessado." }, 502);
  }
});

async function summarizeFile(blob: Blob, fileName: string): Promise<string> {
  const ext = (fileName.split(".").pop() || "").toLowerCase();

  const userContent: Record<string, unknown>[] = [];

  if (ext === "pdf") {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    userContent.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: encodeBase64(bytes) },
    });
    userContent.push({ type: "text", text: PROMPT });
  } else if (ext === "docx") {
    const text = truncate(await extractDocxText(blob));
    userContent.push({ type: "text", text: `${PROMPT}\n\n---\n${text}` });
  } else {
    const text = truncate(await blob.text());
    userContent.push({ type: "text", text: `${PROMPT}\n\n---\n${text}` });
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const textBlock = (data.content ?? []).find((b: { type: string }) => b.type === "text");
  const summary = textBlock?.text?.trim();
  if (!summary) throw new Error("Resposta da IA sem texto.");
  return summary;
}

function truncate(text: string, max = 15000): string {
  return text.length > max ? text.slice(0, max) + "\n[...conteúdo truncado...]" : text;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function extractDocxText(blob: Blob): Promise<string> {
  const { default: JSZip } = await import("npm:jszip@3");
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml
    .replace(/<w:p[ >]/g, "\n$&")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
