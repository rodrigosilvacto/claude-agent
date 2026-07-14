// Versão exata pinada (em vez de "@2") para que uma release nova do
// supabase-js não entre em produção sem passar por um commit e revisão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// AppVendas — gestão de usuários (criar, editar, resetar senha, excluir).
// Roda com a service role para poder falar com auth.admin.*; a autorização
// de quem pode chamar cada ação é verificada manualmente aqui dentro
// (verify_jwt fica desligado no deploy porque a primeira chamada — criação
// do administrador inicial — acontece sem ninguém logado ainda).
//
// Multiempresas: usuários com papel "caixa" precisam estar vinculados a uma
// empresa ativa (empresa_id obrigatório); administradores podem ficar sem
// empresa (enxergam todas).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

const DIACRITICS_RE = new RegExp("[̀-ͯ]", "g");

function sanitizeLogin(raw: string) {
  return String(raw || "")
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  let caller: { id: string } | null = null;
  if (token) {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data.user) caller = { id: data.user.id };
  }

  const { count, error: countError } = await admin
    .from("usuarios")
    .select("id", { count: "exact", head: true });

  if (countError) return json({ error: countError.message }, 500);

  const isBootstrap = (count || 0) === 0;

  let callerIsAdmin = false;
  if (caller && !isBootstrap) {
    const { data: callerRow } = await admin
      .from("usuarios")
      .select("role, ativo")
      .eq("id", caller.id)
      .maybeSingle();
    callerIsAdmin = Boolean(callerRow && callerRow.role === "admin" && callerRow.ativo);
  }

  if (isBootstrap) {
    if (body.action !== "create") {
      return json({ error: "Nenhum usuário cadastrado ainda. Cadastre o primeiro administrador." }, 400);
    }
    body.role = "admin";
  } else if (!callerIsAdmin) {
    return json({ error: "Acesso restrito a administradores." }, 403);
  }

  switch (body.action) {
    case "create":
      return await handleCreate(admin, body);
    case "update":
      return await handleUpdate(admin, body, caller);
    case "reset_password":
      return await handleResetPassword(admin, body);
    case "delete":
      return await handleDelete(admin, body, caller);
    default:
      return json({ error: "Ação inválida." }, 400);
  }
});

async function validarEmpresa(admin: ReturnType<typeof createClient>, empresaId: string) {
  const { data: empresa } = await admin.from("empresas").select("id, ativo").eq("id", empresaId).maybeSingle();
  return Boolean(empresa && empresa.ativo);
}

async function handleCreate(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const nome = String(body.nome || "").trim();
  const login = sanitizeLogin(String(body.login || ""));
  const senha = String(body.senha || "");
  const role = body.role === "admin" ? "admin" : body.role === "caixa" ? "caixa" : null;
  const empresaIdRaw = body.empresa_id ? String(body.empresa_id) : null;

  if (!nome) return json({ error: "Informe o nome." }, 400);
  if (!login) return json({ error: "Informe um usuário (login) válido." }, 400);
  if (senha.length < 6) return json({ error: "A senha deve ter ao menos 6 caracteres." }, 400);
  if (!role) return json({ error: "Papel inválido." }, 400);

  if (role !== "admin" && !empresaIdRaw) {
    return json({ error: "Selecione uma empresa para este usuário." }, 400);
  }

  let empresaId: string | null = null;
  if (empresaIdRaw) {
    if (!(await validarEmpresa(admin, empresaIdRaw))) {
      return json({ error: "Selecione uma empresa válida." }, 400);
    }
    empresaId = empresaIdRaw;
  }

  const email = `${login}@appvendas.local`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true,
    user_metadata: { nome, login },
  });

  if (createError || !created.user) {
    const msg = /already.*registered|already exists/i.test(createError?.message || "")
      ? "Já existe um usuário com este login."
      : createError?.message || "Não foi possível criar o usuário.";
    return json({ error: msg }, 400);
  }

  const { data: row, error: insertError } = await admin
    .from("usuarios")
    .insert({ id: created.user.id, nome, login, role, ativo: true, empresa_id: empresaId })
    .select()
    .single();

  if (insertError) {
    await admin.auth.admin.deleteUser(created.user.id);
    const msg = insertError.code === "23505" ? "Já existe um usuário com este login." : insertError.message;
    return json({ error: msg }, 400);
  }

  return json({ usuario: row });
}

async function handleUpdate(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  caller: { id: string } | null,
) {
  const id = String(body.id || "");
  if (!id) return json({ error: "Usuário inválido." }, 400);

  const { data: currentRow, error: currentError } = await admin
    .from("usuarios")
    .select("role, empresa_id")
    .eq("id", id)
    .maybeSingle();
  if (currentError) return json({ error: currentError.message }, 400);
  if (!currentRow) return json({ error: "Usuário não encontrado." }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.nome === "string" && body.nome.trim()) patch.nome = body.nome.trim();
  if (body.role === "admin" || body.role === "caixa") patch.role = body.role;
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

  const effectiveRole = (patch.role as string) || currentRow.role;
  const empresaProvided = Object.prototype.hasOwnProperty.call(body, "empresa_id");
  const empresaIdRaw = empresaProvided && body.empresa_id ? String(body.empresa_id) : null;
  const effectiveEmpresaId = empresaProvided ? empresaIdRaw : currentRow.empresa_id;

  if (effectiveRole !== "admin" && !effectiveEmpresaId) {
    return json({ error: "Selecione uma empresa para este usuário." }, 400);
  }

  if (empresaProvided) {
    if (empresaIdRaw) {
      if (!(await validarEmpresa(admin, empresaIdRaw))) {
        return json({ error: "Selecione uma empresa válida." }, 400);
      }
    }
    patch.empresa_id = empresaIdRaw;
  }

  if (caller && caller.id === id) {
    if (patch.role && patch.role !== "admin") {
      return json({ error: "Não é possível remover seu próprio papel de administrador." }, 400);
    }
    if (patch.ativo === false) {
      return json({ error: "Não é possível desativar o próprio usuário." }, 400);
    }
  }

  if (Object.keys(patch).length === 0) return json({ error: "Nada para atualizar." }, 400);

  const { data, error } = await admin.from("usuarios").update(patch).eq("id", id).select().single();
  if (error) return json({ error: error.message }, 400);
  return json({ usuario: data });
}

async function handleResetPassword(admin: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  const id = String(body.id || "");
  const senha = String(body.senha || "");
  if (!id) return json({ error: "Usuário inválido." }, 400);
  if (senha.length < 6) return json({ error: "A senha deve ter ao menos 6 caracteres." }, 400);

  const { error } = await admin.auth.admin.updateUserById(id, { password: senha });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleDelete(
  admin: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  caller: { id: string } | null,
) {
  const id = String(body.id || "");
  if (!id) return json({ error: "Usuário inválido." }, 400);
  if (caller && caller.id === id) return json({ error: "Não é possível excluir o próprio usuário." }, 400);

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}
