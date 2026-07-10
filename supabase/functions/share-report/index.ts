// Public, unauthenticated endpoint behind a report's share token. Returns
// read-only metadata plus a short-lived signed URL to the file — the storage
// bucket itself stays private.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  let token: string | undefined;
  try {
    ({ token } = await req.json());
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }
  if (!token) {
    return json({ error: "token é obrigatório." }, 400);
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: report, error } = await client
    .from("reports")
    .select("title, theme, tags, summary, summary_status, file_name, file_type, created_at, share_enabled, file_path")
    .eq("share_token", token)
    .maybeSingle();

  if (error || !report || !report.share_enabled) {
    return json({ error: "Link inválido, expirado ou desativado." }, 404);
  }

  const { data: signed, error: signError } = await client.storage
    .from("reports")
    .createSignedUrl(report.file_path, 600);

  if (signError || !signed) {
    return json({ error: "Falha ao gerar acesso ao arquivo." }, 500);
  }

  return json({
    report: {
      title: report.title,
      theme: report.theme,
      tags: report.tags,
      summary: report.summary,
      summary_status: report.summary_status,
      file_name: report.file_name,
      file_type: report.file_type,
      created_at: report.created_at,
    },
    fileUrl: signed.signedUrl,
  });
});
