// Recebe um tema e gera um texto pronto para publicar no LinkedIn usando a
// API da Anthropic. Requer a secret ANTHROPIC_API_KEY configurada no projeto
// Supabase (`supabase secrets set ANTHROPIC_API_KEY=...`).
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

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

const TONES: Record<string, string> = {
  profissional: "profissional e direto, com autoridade no assunto",
  inspirador: "inspirador e motivacional, com uma mensagem pessoal",
  storytelling: "em formato de storytelling, contando uma pequena história ou aprendizado",
  objetivo: "direto e objetivo, com foco em dados e resultados práticos",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let theme: string | undefined;
  let tone: string | undefined;
  try {
    ({ theme, tone } = await req.json());
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  theme = theme?.trim();
  if (!theme) {
    return json({ error: "theme é obrigatório." }, 400);
  }
  if (theme.length > 300) {
    return json({ error: "theme muito longo (máx. 300 caracteres)." }, 400);
  }

  const toneDescription = TONES[tone ?? ""] ?? TONES.profissional;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system:
        "Você é um redator especialista em posts para o LinkedIn em português do Brasil. " +
        "Escreva um único post pronto para publicar, sem explicações antes ou depois e sem aspas envolvendo o texto todo. " +
        "Regras: comece com uma frase de impacto (hook) nas primeiras 1-2 linhas; " +
        "use parágrafos curtos separados por linha em branco, fáceis de ler no celular; " +
        "termine com uma pergunta ou chamada para reflexão/comentário; " +
        "inclua no máximo 3 hashtags relevantes ao final; " +
        "evite emojis em excesso (no máximo 2-3 no total); " +
        "tamanho entre 800 e 1500 caracteres.",
      messages: [
        {
          role: "user",
          content: `Tema do post: "${theme}"\nTom desejado: ${toneDescription}.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error:", response.status, errText);
    return json({ error: "Falha ao gerar o post. Tente novamente em instantes." }, 502);
  }

  const data = await response.json();
  const post = data.content?.find((b: { type: string }) => b.type === "text")?.text?.trim();
  if (!post) {
    return json({ error: "Resposta inesperada do modelo." }, 502);
  }

  return json({ post });
});
