// Agente avaliador: recebe o texto de um post de LinkedIn já pronto e
// classifica a qualidade em uma de quatro categorias. É chamado
// internamente pela function generate-linkedin-post (agente 1 escreve,
// agente 2 avalia) logo depois que o texto é gerado, mas também pode ser
// chamado diretamente com { "post": "..." }.
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

const CATEGORIAS = ["executivo", "tecnico", "pessimo", "reescrever"] as const;
type Categoria = (typeof CATEGORIAS)[number];

interface Grade {
  categoria: Categoria;
  nota: number | null;
  justificativa: string;
}

async function gradePost(post: string): Promise<Grade> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 512,
      system:
        "Você avalia posts de LinkedIn em português do Brasil. Classifique o texto recebido em " +
        'exatamente UMA das quatro categorias: ' +
        '"executivo" (bem escrito, tom executivo/estratégico, claro e profissional, pronto para publicar — dê uma nota de 1 a 10), ' +
        '"tecnico" (bem escrito, tom técnico/especialista, claro e bem estruturado, pronto para publicar — dê uma nota de 1 a 10), ' +
        '"pessimo" (texto ruim: confuso, genérico, mal formatado ou sem valor — não dê nota, deixe nota como null), ' +
        '"reescrever" (o texto tem potencial mas precisa de revisão significativa antes de publicar — não dê nota, deixe nota como null). ' +
        'Use "executivo" ou "tecnico" apenas quando o texto já estiver pronto para publicar sem alterações. ' +
        "Responda apenas com o objeto JSON pedido, com uma justificativa curta (1-2 frases).",
      messages: [
        { role: "user", content: `Avalie este post de LinkedIn:\n\n${post}` },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              categoria: { type: "string", enum: CATEGORIAS },
              nota: { anyOf: [{ type: "integer" }, { type: "null" }] },
              justificativa: { type: "string" },
            },
            required: ["categoria", "nota", "justificativa"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Anthropic API error (grade):", response.status, errText);
    throw new Error("Falha ao avaliar o post.");
  }

  const data = await response.json();
  const text = data.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) {
    throw new Error("Resposta inesperada do modelo ao avaliar.");
  }

  const parsed = JSON.parse(text);
  if (!CATEGORIAS.includes(parsed.categoria)) {
    throw new Error("Categoria de avaliação inválida.");
  }

  const isScored = parsed.categoria === "executivo" || parsed.categoria === "tecnico";
  let nota: number | null = null;
  if (isScored && typeof parsed.nota === "number" && Number.isFinite(parsed.nota)) {
    nota = Math.min(10, Math.max(1, Math.round(parsed.nota)));
  }

  return {
    categoria: parsed.categoria,
    nota,
    justificativa: String(parsed.justificativa ?? "").trim(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let post: string | undefined;
  try {
    ({ post } = await req.json());
  } catch {
    return json({ error: "Corpo da requisição inválido." }, 400);
  }

  post = post?.trim();
  if (!post) {
    return json({ error: "post é obrigatório." }, 400);
  }

  try {
    const grade = await gradePost(post);
    return json(grade);
  } catch (err) {
    console.error(err);
    return json({ error: "Falha ao avaliar o post. Tente novamente em instantes." }, 502);
  }
});
