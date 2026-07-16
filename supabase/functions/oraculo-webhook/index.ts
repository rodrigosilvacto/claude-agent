// Versão exata pinada (mesmo motivo de manage-usuarios/index.ts): uma
// release nova do supabase-js não deve entrar em produção sem passar por
// um commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// Agente Oráculo: recebe mensagens de WhatsApp via webhook do Z-API, dá
// conselhos pessoais e profissionais usando a API da Anthropic, e responde
// de volta pelo Z-API. Histórico de conversa persistido por telefone
// (tabelas `oraculo_conversas`/`oraculo_mensagens`, migration 0010).
//
// Endpoint público (deploy com --no-verify-jwt, quem chama é o Z-API, não
// um cliente Supabase autenticado). Segurança feita por um secret próprio
// na query string (?secret=...), configurado como parte da URL do webhook
// no painel do Z-API — ver README.
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ZAPI_INSTANCE_ID = Deno.env.get("ZAPI_INSTANCE_ID")!;
const ZAPI_TOKEN = Deno.env.get("ZAPI_TOKEN")!;
const ZAPI_CLIENT_TOKEN = Deno.env.get("ZAPI_CLIENT_TOKEN")!;
const ORACULO_WEBHOOK_SECRET = Deno.env.get("ORACULO_WEBHOOK_SECRET")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// Quantas mensagens do histórico entram no contexto enviado à Anthropic.
const HISTORICO_LIMITE = 20;
// Rate limit por conversa (o webhook está aberto a qualquer número que
// mandar mensagem, então isso é o que contém o custo/abuso).
const RATE_LIMIT_JANELA_MINUTOS = 15;
const RATE_LIMIT_MAX_MENSAGENS = 20;

const SYSTEM_PROMPT =
  "Você é o Oráculo, um conselheiro que dá orientações pessoais e profissionais " +
  "para quem te procura pelo WhatsApp, em português do Brasil. " +
  "Seu tom é direto, acolhedor e prático — nada de respostas genéricas de autoajuda. " +
  "Quando faltar contexto para dar um conselho útil, faça 1-2 perguntas antes de responder " +
  "em vez de generalizar. Respostas curtas e objetivas, pensadas para leitura no celular " +
  "(evite parágrafos longos). Quando o assunto tocar em saúde mental, questões jurídicas " +
  "ou decisões financeiras de grande impacto, dê seu conselho mas deixe claro que vale a " +
  "pena buscar um profissional humano (psicólogo, advogado, contador) para aprofundar. " +
  "Você não é terapeuta, advogado nem consultor financeiro licenciado.";

function normalizarTelefone(input: unknown): string {
  return String(input ?? "").replace(/\D/g, "");
}

async function enviarMensagemZapi(phone: string, message: string): Promise<void> {
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Client-Token": ZAPI_CLIENT_TOKEN,
        },
        body: JSON.stringify({ phone, message }),
      },
    );
    if (!res.ok) {
      console.error("Z-API send-text error:", res.status, await res.text());
    }
  } catch (err) {
    console.error("Falha ao chamar Z-API send-text:", err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== ORACULO_WEBHOOK_SECRET) {
    return json({ error: "Não autorizado." }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  // Eco do próprio bot ou mensagem de grupo: fora de escopo no MVP.
  if (payload.fromMe === true || payload.isGroup === true) {
    return json({ ignored: true });
  }

  const telefone = normalizarTelefone(payload.phone);
  if (!telefone) {
    return json({ ignored: true });
  }

  const textoRecebido = (payload.text as { message?: string } | undefined)?.message?.trim();
  const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
  const senderName = typeof payload.senderName === "string" ? payload.senderName.trim() : null;

  if (!textoRecebido) {
    await enviarMensagemZapi(
      telefone,
      "Por enquanto eu só entendo mensagens de texto — me conta em palavras o que você está pensando 🙂",
    );
    return json({ ignored: true, reason: "non-text" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Get-or-create da conversa pelo telefone.
  let conversaId: string;
  const { data: conversaExistente, error: selectConversaErr } = await supabase
    .from("oraculo_conversas")
    .select("id, nome")
    .eq("telefone", telefone)
    .maybeSingle();
  if (selectConversaErr) {
    console.error("Erro ao buscar conversa:", selectConversaErr);
    return json({ error: "Erro interno." }, 500);
  }

  if (conversaExistente) {
    conversaId = conversaExistente.id;
    if (!conversaExistente.nome && senderName) {
      await supabase.from("oraculo_conversas").update({ nome: senderName }).eq("id", conversaId);
    }
  } else {
    const { data: novaConversa, error: insertConversaErr } = await supabase
      .from("oraculo_conversas")
      .insert({ telefone, nome: senderName })
      .select("id")
      .single();
    if (insertConversaErr || !novaConversa) {
      console.error("Erro ao criar conversa:", insertConversaErr);
      return json({ error: "Erro interno." }, 500);
    }
    conversaId = novaConversa.id;
  }

  // Idempotência: se o Z-API reentregar a mesma mensagem (retry), o unique
  // index em zapi_message_id barra o insert e não reprocessamos.
  const { error: insertMsgErr } = await supabase.from("oraculo_mensagens").insert({
    conversa_id: conversaId,
    role: "user",
    conteudo: textoRecebido,
    zapi_message_id: messageId,
  });
  if (insertMsgErr) {
    if (insertMsgErr.code === "23505") {
      return json({ ok: true, deduped: true });
    }
    console.error("Erro ao salvar mensagem do usuário:", insertMsgErr);
    return json({ error: "Erro interno." }, 500);
  }

  const desde = new Date(Date.now() - RATE_LIMIT_JANELA_MINUTOS * 60_000).toISOString();
  const { count: mensagensRecentes, error: countErr } = await supabase
    .from("oraculo_mensagens")
    .select("id", { count: "exact", head: true })
    .eq("conversa_id", conversaId)
    .eq("role", "user")
    .gte("criado_em", desde);
  if (countErr) {
    console.error("Erro ao contar mensagens para rate limit:", countErr);
  } else if ((mensagensRecentes ?? 0) > RATE_LIMIT_MAX_MENSAGENS) {
    await enviarMensagemZapi(
      telefone,
      "Recebi muitas mensagens suas nos últimos minutos, me dá um tempinho antes de mandar mais 🙏",
    );
    return json({ ok: true, rateLimited: true });
  }

  const { data: historico, error: histErr } = await supabase
    .from("oraculo_mensagens")
    .select("role, conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(HISTORICO_LIMITE);
  if (histErr) {
    console.error("Erro ao buscar histórico:", histErr);
    return json({ error: "Erro interno." }, 500);
  }
  const mensagens = (historico ?? [])
    .reverse()
    .map((m: { role: string; conteudo: string }) => ({ role: m.role, content: m.conteudo }));

  let resposta: string;
  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: mensagens,
      }),
    });
    if (!anthropicRes.ok) {
      console.error("Anthropic API error:", anthropicRes.status, await anthropicRes.text());
      throw new Error("anthropic-error");
    }
    const data = await anthropicRes.json();
    const texto = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim();
    if (!texto) throw new Error("resposta-vazia");
    resposta = texto;
  } catch (err) {
    console.error("Falha ao gerar resposta do Oráculo:", err);
    await enviarMensagemZapi(telefone, "Tive um problema para responder agora. Tenta de novo daqui a pouco?");
    return json({ error: "Falha ao gerar resposta." }, 502);
  }

  const { error: insertRespostaErr } = await supabase.from("oraculo_mensagens").insert({
    conversa_id: conversaId,
    role: "assistant",
    conteudo: resposta,
  });
  if (insertRespostaErr) {
    console.error("Erro ao salvar resposta do assistente:", insertRespostaErr);
  }
  await supabase
    .from("oraculo_conversas")
    .update({ atualizado_em: new Date().toISOString() })
    .eq("id", conversaId);

  await enviarMensagemZapi(telefone, resposta);

  return json({ ok: true });
});
