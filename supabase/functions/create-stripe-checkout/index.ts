import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import Stripe from "https://esm.sh/stripe@17.4.0?target=deno";

// AppVendas — cria uma Stripe Checkout Session para uma venda com forma de
// pagamento "Stripe". Fluxo "link/QR": o cliente paga pelo próprio celular
// (o app nunca vê dados de cartão), então a venda nasce como
// 'aguardando_pagamento' (criar_venda com p_status) e só vira 'confirmada'
// quando o webhook stripe-webhook recebe a confirmação do Stripe — ver
// migration 0013.
//
// Chamado autenticado (verify_jwt ligado no deploy): o cliente Supabase
// abaixo é criado com o JWT de quem chamou, então is_admin()/
// current_empresa_id() dentro de criar_venda funcionam exatamente como na
// chamada direta da RPC (mesma checagem de empresa/permissão).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

// Tempo de vida do QR/link — curto de propósito (mínimo aceito pelo Stripe
// é 30 min): isso é um pagamento de balcão, não faz sentido um QR de venda
// continuar válido horas depois. Ao expirar, o Stripe manda
// checkout.session.expired e o webhook cancela a venda automaticamente.
const CHECKOUT_EXPIRES_IN_SECONDS = 30 * 60;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const successUrl = typeof body.success_url === "string" ? body.success_url : "";
  const cancelUrl = typeof body.cancel_url === "string" ? body.cancel_url : "";
  if (!/^https?:\/\//.test(successUrl) || !/^https?:\/\//.test(cancelUrl)) {
    return json({ error: "success_url/cancel_url inválidos." }, 400);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const supabaseAsUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: vendaId, error: criarError } = await supabaseAsUser.rpc("criar_venda", {
    p_cliente_id: body.p_cliente_id ?? null,
    p_data_venda: body.p_data_venda ?? null,
    p_forma_pagamento: "Stripe",
    p_observacoes: body.p_observacoes ?? null,
    p_desconto: body.p_desconto ?? 0,
    p_itens: body.p_itens ?? [],
    p_empresa_id: body.p_empresa_id ?? null,
    p_status: "aguardando_pagamento",
  });

  if (criarError || !vendaId) {
    return json({ error: criarError?.message || "Não foi possível criar a venda." }, 400);
  }

  const { data: venda, error: vendaError } = await supabaseAsUser
    .from("vendas")
    .select("numero, total")
    .eq("id", vendaId)
    .single();

  if (vendaError || !venda) {
    await supabaseAsUser.rpc("cancelar_venda", { p_venda_id: vendaId });
    return json({ error: "Venda criada, mas não foi possível lê-la de volta." }, 500);
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      client_reference_id: vendaId,
      metadata: { venda_id: vendaId },
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: { name: `Venda #${venda.numero}` },
            unit_amount: Math.round(Number(venda.total) * 100),
          },
          quantity: 1,
        },
      ],
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRES_IN_SECONDS,
      success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}venda=${vendaId}`,
      cancel_url: `${cancelUrl}${cancelUrl.includes("?") ? "&" : "?"}venda=${vendaId}`,
    });

    return json({ url: session.url, venda_id: vendaId, numero: venda.numero });
  } catch (err) {
    console.error("Falha ao criar Stripe Checkout Session:", err);
    // A venda já existe como 'aguardando_pagamento' — sem sessão do Stripe
    // associada ela nunca seria confirmada nem expiraria sozinha, então
    // desfaz aqui mesmo em vez de deixar uma pendência órfã.
    await supabaseAsUser.rpc("cancelar_venda", { p_venda_id: vendaId });
    return json({ error: "Não foi possível iniciar o pagamento no Stripe." }, 502);
  }
});
