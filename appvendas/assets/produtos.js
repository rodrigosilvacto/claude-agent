import { renderCadastro } from "./cadastro.js";
import { supabase } from "./supabaseClient.js";
import { formatCurrency, escapeHtml } from "./app.js";

async function loadFornecedorOptions() {
  const { data } = await supabase.from("fornecedores").select("id, nome").order("nome", { ascending: true });
  return (data || []).map((f) => ({ value: f.id, label: f.nome }));
}

export async function render(view, actionsEl) {
  await renderCadastro(view, actionsEl, {
    table: "produtos",
    titleSingular: "Produto",
    searchPlaceholder: "Buscar por nome, SKU ou categoria…",
    searchColumns: ["nome", "sku", "categoria"],
    orderBy: "nome",
    scopeByEmpresa: true,
    selectQuery: "*, fornecedor:fornecedores(id, nome)",
    columns: [
      { key: "nome", label: "Nome" },
      { key: "sku", label: "SKU" },
      { key: "categoria", label: "Categoria" },
      { key: "preco", label: "Preço", align: "right", render: (row) => formatCurrency(row.preco) },
      {
        key: "estoque",
        label: "Estoque",
        align: "right",
        render: (row) => {
          const low = row.estoque <= row.estoque_minimo;
          return `<span style="${low ? "color: var(--danger); font-weight: 700;" : ""}">${row.estoque}</span>`;
        },
      },
      { key: "fornecedor", label: "Fornecedor", render: (row) => escapeHtml(row.fornecedor?.nome || "—") },
      {
        key: "ativo",
        label: "Status",
        render: (row) => `<span class="status status--${row.ativo ? "ativo" : "inativo"}">${row.ativo ? "Ativo" : "Inativo"}</span>`,
      },
    ],
    fields: [
      { key: "nome", label: "Nome", required: true, full: true },
      { key: "sku", label: "SKU" },
      { key: "categoria", label: "Categoria" },
      { key: "preco", label: "Preço de venda", type: "number", step: "0.01", required: true, default: 0 },
      { key: "custo", label: "Custo", type: "number", step: "0.01", default: 0 },
      { key: "estoque", label: "Estoque atual", type: "number", step: "1", required: true, default: 0 },
      { key: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "1", default: 0 },
      { key: "fornecedor_id", label: "Fornecedor", type: "search-select", optionsLoader: loadFornecedorOptions },
      { key: "descricao", label: "Descrição", type: "textarea", full: true },
      { key: "ativo", label: "Produto ativo", type: "checkbox", default: true, full: true },
    ],
  });
}
