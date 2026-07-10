// Agente 1 (escritor): recebe um tema e gera um texto pronto para publicar
// no LinkedIn usando a API da Anthropic. Em seguida chama o agente 2
// (grade-linkedin-post) para avaliar o texto gerado, e devolve os dois
// resultados juntos. Requer a secret ANTHROPIC_API_KEY configurada no
// projeto Supabase (`supabase secrets set ANTHROPIC_API_KEY=...`).
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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

// Chama o agente 2 (grade-linkedin-post) para avaliar o texto gerado pelo
// agente 1. Se a avaliação falhar, retorna null em vez de derrubar a
// resposta principal — o post gerado ainda é útil sem a nota.
async function gradePost(post: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/grade-linkedin-post`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ post }),
    });
    if (!res.ok) {
      console.error("grade-linkedin-post error:", res.status, await res.text());
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("Falha ao chamar grade-linkedin-post:", err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let theme: string | undefined;
  let tone: string | undefined;
  let feedback: string | undefined;
  let previousPost: string | undefined;
  try {
    ({ theme, tone, feedback, previousPost } = await req.json());
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

  feedback = feedback?.trim();
  if (feedback && feedback.length > 500) {
    return json({ error: "feedback muito longo (máx. 500 caracteres)." }, 400);
  }
  previousPost = previousPost?.trim();
  if (previousPost && previousPost.length > 4000) {
    return json({ error: "previousPost muito longo." }, 400);
  }

  const toneDescription = TONES[tone ?? ""] ?? TONES.profissional;

  // Se vier feedback + o post anterior, o agente revisa o texto existente em
  // vez de escrever do zero — é o mesmo agente escritor, só que em modo de
  // ajuste iterativo a partir do feedback do usuário.
  const userContent = feedback && previousPost
    ? `Post atual sobre o tema "${theme}":\n\n${previousPost}\n\n` +
      `Feedback do usuário sobre esse post:\n"${feedback}"\n\n` +
      `Reescreva o post aplicando esse feedback. Mantenha o tom ${toneDescription}, a menos que o feedback peça o contrário.`
    : `Tema do post: "${theme}"\nTom desejado: ${toneDescription}.`;

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
          content: userContent,
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

  const grade = await gradePost(post);

  return json({ post, grade });
});
