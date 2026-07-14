// AppVendas — carregamento de catálogo (clientes ativos, produtos ativos,
// empresas) e mapeamento para o combo de busca (createSearchSelect). Extraído
// de vendas.js/financeiro.js/agenda.js, que reimplementavam a mesma consulta
// e o mesmo mapeamento de forma quase idêntica em cada tela.

import { supabase } from "./supabaseClient.js";
import { isAdmin } from "./auth.js";
import { formatCurrency } from "./app.js";

export async function loadClientesAtivos() {
  const { data } = await supabase
    .from("clientes")
    .select("id, nome, documento")
    .eq("ativo", true)
    .eq("status_cadastro", "aprovado")
    .order("nome", { ascending: true });
  return data || [];
}

export async function loadProdutosAtivos(columns = "id, nome, sku, preco, estoque") {
  const { data } = await supabase.from("produtos").select(columns).eq("ativo", true).order("nome", { ascending: true });
  return data || [];
}

// Só admins enxergam empresas de fora da própria — quem não é admin nem
// precisa da lista, já está implicitamente restrito à sua empresa.
export async function loadEmpresasAtivas() {
  if (!isAdmin()) return [];
  const { data } = await supabase.from("empresas").select("id, nome_fantasia, codigo").eq("ativo", true).order("nome_fantasia", { ascending: true });
  return data || [];
}

// Fornecedores não têm um dono único fixo por tela (Produtos filtra pelo
// formulário; Contas a Pagar filtra pelo período) — por isso recebe o
// empresa_id explícito em vez de resolver isAdmin()/getCurrentEmpresaId()
// sozinho, do jeito que loadEmpresasAtivas faz.
export async function loadFornecedoresPorEmpresa(empresaId) {
  if (!empresaId) return [];
  const { data } = await supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .order("nome", { ascending: true });
  return data || [];
}

export function fornecedorSearchOptions(fornecedores) {
  return fornecedores.map((f) => ({ value: f.id, label: f.nome }));
}

export function clienteSearchOptions(clientes) {
  return clientes.map((c) => ({ value: c.id, label: c.nome, meta: c.documento || "" }));
}

export function empresaSearchOptions(empresas) {
  return empresas.map((e) => ({ value: e.id, label: e.nome_fantasia, meta: e.codigo }));
}

// `meta` deixa cada tela decidir o que mostrar de complementar (Vendas e
// Financeiro mostram preço/estoque; Agenda só precisa do SKU).
export function produtoSearchOptions(produtos, { meta } = {}) {
  return produtos.map((p) => ({
    value: p.id,
    label: p.nome,
    meta: meta ? meta(p) : (p.sku || ""),
  }));
}

export const produtoMetaPrecoEstoque = (p) => `${formatCurrency(p.preco)} · estoque ${p.estoque}`;
