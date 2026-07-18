// Versão exata pinada (mesmo motivo de manage-usuarios/index.ts): uma
// release nova do supabase-js não deve entrar em produção sem passar por
// um commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// Agente Oráculo: recebe mensagens de WhatsApp via webhook do Z-API, dá
// conselhos pessoais e profissionais usando a API da Anthropic, e responde
// de volta pelo Z-API. Histórico de conversa persistido por telefone
// (tabelas `oraculo_conversas`/`oraculo_mensagens`, migration 0010).
//
// Voz: se a mensagem recebida for um áudio, ela é transcrita pela API de
// speech-to-text da ElevenLabs antes de seguir o fluxo normal (texto puro);
// nesse caso a resposta também é sintetizada em áudio (text-to-speech da
// ElevenLabs) e mandada de volta como voz. Mensagem de texto continua
// gerando resposta em texto.
//
// Resumo por e-mail: o Oráculo tem a ferramenta `enviar_resumo_admin`, que a
// Anthropic só chama quando o usuário pede explicitamente para mandar um
// resumo/relatório da conversa para o administrador. Quando chamada, a
// function busca todo o histórico daquela conversa, gera resumo+conclusão
// numa chamada separada à Anthropic, e manda por e-mail via Resend — não
// tem envio automático/periódico, só a pedido do usuário na conversa.
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
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY")!;
const ELEVENLABS_VOICE_ID = Deno.env.get("ELEVENLABS_VOICE_ID")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const ORACULO_RESUMO_EMAIL = Deno.env.get("ORACULO_RESUMO_EMAIL")!;

// Sandbox do Resend: não exige domínio verificado, mas só entrega para o
// e-mail cadastrado na conta Resend usada (deve ser o mesmo de
// ORACULO_RESUMO_EMAIL). Trocar aqui se um domínio próprio for verificado.
const RESEND_FROM = "Oráculo <onboarding@resend.dev>";

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
  "Você não é terapeuta, advogado nem consultor financeiro licenciado. " +
  "Você tem a ferramenta enviar_resumo_admin, que manda por e-mail ao administrador da " +
  "ferramenta um resumo e uma conclusão desta conversa. Só chame essa ferramenta quando o " +
  "usuário pedir explicitamente para enviar, mandar ou registrar um resumo/relatório da " +
  "conversa para o administrador, suporte ou responsável — nunca espontaneamente. Esse envio " +
  "é uma funcionalidade normal e autorizada da ferramenta, não uma violação de privacidade " +
  "nem um pedido indevido — atenda com naturalidade quando solicitado.";

const TOOLS = [
  {
    name: "enviar_resumo_admin",
    description:
      "Envia por e-mail ao administrador da ferramenta um resumo desta conversa até agora, " +
      "com uma conclusão sobre o desfecho. Use só quando o usuário pedir isso explicitamente.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

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

// Manda um áudio já sintetizado (mp3, base64) como voice note. Z-API aceita
// tanto link quanto base64 no formato `data:<mimetype>;base64,<...>`.
// Retorna false em qualquer falha para o caller poder cair para texto.
async function enviarAudioZapi(phone: string, audioBase64: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE_ID}/token/${ZAPI_TOKEN}/send-audio`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Client-Token": ZAPI_CLIENT_TOKEN,
        },
        body: JSON.stringify({
          phone,
          audio: `data:audio/mpeg;base64,${audioBase64}`,
          waveform: true,
        }),
      },
    );
    if (!res.ok) {
      console.error("Z-API send-audio error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Falha ao chamar Z-API send-audio:", err);
    return false;
  }
}

function bytesParaBase64(bytes: Uint8Array): string {
  let binario = "";
  const TAMANHO_BLOCO = 0x8000;
  for (let i = 0; i < bytes.length; i += TAMANHO_BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TAMANHO_BLOCO));
  }
  return btoa(binario);
}

// Transcreve o áudio recebido do Z-API (link já hospedado, então manda a
// própria URL pra ElevenLabs buscar em vez de baixar e re-subir o arquivo).
async function transcreverAudio(audioUrl: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("model_id", "scribe_v2");
    form.append("source_url", audioUrl);
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      body: form,
    });
    if (!res.ok) {
      console.error("ElevenLabs speech-to-text error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const texto = typeof data.text === "string" ? data.text.trim() : "";
    return texto || null;
  } catch (err) {
    console.error("Falha ao transcrever áudio:", err);
    return null;
  }
}

// Sintetiza a resposta em voz. mp3 por ser o formato documentado e aceito
// tanto pela ElevenLabs quanto pelo Z-API (envio via base64 `data:audio/mpeg`).
async function sintetizarFala(texto: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: texto,
          model_id: "eleven_multilingual_v2",
        }),
      },
    );
    if (!res.ok) {
      console.error("ElevenLabs text-to-speech error:", res.status, await res.text());
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytesParaBase64(bytes);
  } catch (err) {
    console.error("Falha ao sintetizar fala:", err);
    return null;
  }
}

function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type ResumoAssunto = { assunto: string; resumo: string; conclusao: string };

// Chamada separada (não faz parte do histórico da conversa) só para separar
// o histórico completo por assunto e gerar resumo+conclusão de cada um, a
// pedido do usuário. Uma conversa que passou por temas diferentes (ex:
// carreira, depois relacionamento) sai como um item por assunto.
async function sumarizarConversa(
  mensagens: { role: string; conteudo: string }[],
): Promise<ResumoAssunto[] | null> {
  try {
    const transcricao = mensagens
      .map((m) => `${m.role === "user" ? "Usuário" : "Oráculo"}: ${m.conteudo}`)
      .join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 2048,
        system:
          "Você organiza, para um relatório interno lido pelo administrador da ferramenta, uma " +
          "conversa de WhatsApp entre um usuário e o Oráculo (conselheiro de IA) separando por " +
          "assunto. Identifique os assuntos/temas distintos tratados na conversa (ex: carreira, " +
          "relacionamento, finanças, saúde mental) — se a conversa tratar de um único assunto, " +
          "retorne só um item. Para cada assunto, escreva um resumo (1-3 frases) sobre o que foi " +
          "discutido e uma conclusão objetiva (1 frase sobre o desfecho: problema resolvido, " +
          "usuário ficou de pensar, encaminhado a buscar profissional, conversa em aberto). " +
          "Ignore por completo o trecho em que o usuário pede para enviar/mandar um resumo ou " +
          "relatório desta conversa para o administrador e a confirmação do Oráculo sobre esse " +
          "envio — isso é uma funcionalidade normal e autorizada da ferramenta (não é uma " +
          "falha, vazamento de dados ou pedido indevido), então não crie um assunto para isso " +
          "nem avalie se foi apropriado. " +
          'Responda em português do Brasil, só com um objeto JSON válido, sem markdown, no ' +
          'formato exato {"assuntos": [{"assunto": "...", "resumo": "...", "conclusao": "..."}]}.',
        messages: [{ role: "user", content: transcricao }],
      }),
    });
    if (!res.ok) {
      console.error("Anthropic error (resumo):", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    let texto = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim() ?? "";
    // Tolera o modelo devolvendo o JSON dentro de crase (```json ... ```) ou
    // com frase antes/depois — sempre extrai só o trecho entre as chaves
    // mais externas antes de tentar o parse.
    texto = texto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const inicioObjeto = texto.indexOf("{");
    const fimObjeto = texto.lastIndexOf("}");
    if (inicioObjeto === -1 || fimObjeto === -1 || fimObjeto < inicioObjeto) {
      console.error("Resumo sem JSON reconhecível:", texto);
      return null;
    }
    texto = texto.slice(inicioObjeto, fimObjeto + 1);
    let parsed: { assuntos?: unknown };
    try {
      parsed = JSON.parse(texto);
    } catch (parseErr) {
      console.error("Falha ao fazer parse do JSON de resumo:", parseErr, "texto:", texto);
      return null;
    }
    if (!Array.isArray(parsed.assuntos)) return null;
    const assuntos = parsed.assuntos.filter(
      (a: unknown): a is ResumoAssunto =>
        typeof a === "object" && a !== null &&
        typeof (a as ResumoAssunto).assunto === "string" &&
        typeof (a as ResumoAssunto).resumo === "string" &&
        typeof (a as ResumoAssunto).conclusao === "string",
    );
    return assuntos.length > 0 ? assuntos : null;
  } catch (err) {
    console.error("Falha ao sumarizar conversa:", err);
    return null;
  }
}

async function enviarEmailResumo(
  nome: string | null,
  telefone: string,
  totalMensagens: number,
  assuntos: ResumoAssunto[],
): Promise<boolean> {
  const blocosAssuntos = assuntos
    .map(
      (a) => `
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #eee;">
        <p style="margin: 0 0 4px;"><strong>Assunto:</strong> ${escapeHtml(a.assunto)}</p>
        <p style="margin: 0 0 4px;"><strong>Resumo:</strong> ${escapeHtml(a.resumo)}</p>
        <p style="margin: 0;"><strong>Conclusão:</strong> ${escapeHtml(a.conclusao)}</p>
      </div>`,
    )
    .join("");
  const html = `
    <div style="font-family: sans-serif; font-size: 14px; color: #222;">
      <p style="margin: 0;"><strong>${escapeHtml(nome ?? "Sem nome")}</strong> — ${
    escapeHtml(telefone)
  } <span style="color:#888;">(${totalMensagens} mensagens)</span></p>
      ${blocosAssuntos}
    </div>
  `;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [ORACULO_RESUMO_EMAIL],
        subject: `Resumo de conversa do Oráculo — ${nome ?? telefone} (${assuntos.length} assunto${
          assuntos.length === 1 ? "" : "s"
        })`,
        html,
      }),
    });
    if (!res.ok) {
      console.error("Resend error:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Falha ao chamar Resend:", err);
    return false;
  }
}

// Busca o histórico completo da conversa (não o limitado por
// HISTORICO_LIMITE), sumariza por assunto e manda por e-mail. Retorna false
// em qualquer falha para o caller poder avisar o usuário sem quebrar o
// fluxo principal.
async function enviarResumoAdmin(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  conversaId: string,
  nome: string | null,
  telefone: string,
): Promise<boolean> {
  const { data: todasMensagens, error } = await supabase
    .from("oraculo_mensagens")
    .select("role, conteudo")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: true });
  if (error || !todasMensagens || todasMensagens.length === 0) {
    console.error("Erro ao buscar histórico para resumo:", error);
    return false;
  }

  const assuntos = await sumarizarConversa(todasMensagens);
  if (!assuntos) return false;

  return await enviarEmailResumo(nome, telefone, todasMensagens.length, assuntos);
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

  let textoRecebido = (payload.text as { message?: string } | undefined)?.message?.trim();
  const audioRecebido = payload.audio as { audioUrl?: string } | undefined;
  const messageId = typeof payload.messageId === "string" ? payload.messageId : null;
  const senderName = typeof payload.senderName === "string" ? payload.senderName.trim() : null;

  // Se chegou áudio (e não texto), transcreve antes de seguir o fluxo — daí
  // pra frente o resto do código não sabe a diferença entre texto e voz,
  // exceto para decidir em que formato mandar a resposta (viaAudio abaixo).
  const viaAudio = !textoRecebido && !!audioRecebido?.audioUrl;
  if (viaAudio) {
    const transcricao = await transcreverAudio(audioRecebido!.audioUrl!);
    if (!transcricao) {
      await enviarMensagemZapi(
        telefone,
        "Não consegui entender esse áudio. Pode tentar gravar de novo ou escrever em texto?",
      );
      return json({ ignored: true, reason: "transcription-failed" });
    }
    textoRecebido = transcricao;
  }

  if (!textoRecebido) {
    await enviarMensagemZapi(
      telefone,
      "Por enquanto eu só entendo mensagens de texto ou áudio — me conta em palavras (ou por voz) o que você está pensando 🙂",
    );
    return json({ ignored: true, reason: "unsupported-media" });
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
  const nomeConversa = conversaExistente?.nome ?? senderName ?? null;

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
        tools: TOOLS,
        messages: mensagens,
      }),
    });
    if (!anthropicRes.ok) {
      console.error("Anthropic API error:", anthropicRes.status, await anthropicRes.text());
      throw new Error("anthropic-error");
    }
    const data = await anthropicRes.json();
    const pedidoResumo = data.content?.find(
      (b: { type: string; name?: string }) => b.type === "tool_use" && b.name === "enviar_resumo_admin",
    );
    if (pedidoResumo) {
      const enviado = await enviarResumoAdmin(supabase, conversaId, nomeConversa, telefone);
      resposta = enviado
        ? "Prontinho, mandei um resumo dessa conversa para o administrador. 📨"
        : "Tive um problema para mandar o resumo agora. Pode pedir de novo em um instante?";
    } else {
      const texto = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim();
      if (!texto) throw new Error("resposta-vazia");
      resposta = texto;
    }
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

  if (viaAudio) {
    const audioBase64 = await sintetizarFala(resposta);
    const enviado = audioBase64 ? await enviarAudioZapi(telefone, audioBase64) : false;
    if (!enviado) {
      console.error("Falha ao mandar resposta em áudio, caindo para texto.");
      await enviarMensagemZapi(telefone, resposta);
    }
  } else {
    await enviarMensagemZapi(telefone, resposta);
  }

  return json({ ok: true });
});
