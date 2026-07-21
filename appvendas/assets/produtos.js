import { renderCadastro } from "./cadastro.js";
import { supabase } from "./supabaseClient.js";
import { formatCurrency, escapeHtml } from "./app.js";
import { isAdmin, getCurrentEmpresaId } from "./auth.js";

// Um admin enxerga fornecedores de todas as empresas nas outras telas (é
// assim que a RLS foi desenhada), mas o dropdown de fornecedor no formulário
// de Produto precisa ficar restrito à empresa do próprio produto — senão um
// admin cadastrando um produto da Empresa A consegue vincular um fornecedor
// que só existe na Empresa B. Para "caixa" a RLS já restringe à própria
// empresa; o filtro aqui é reforço explícito, não a única barreira.
async function loadFornecedorOptions(existingRow, empresaIdOverride) {
  const empresaId = isAdmin() ? (empresaIdOverride ?? existingRow?.empresa_id ?? null) : getCurrentEmpresaId();
  if (!empresaId) return [];

  const { data } = await supabase
    .from("fornecedores")
    .select("id, nome")
    .eq("empresa_id", empresaId)
    .order("nome", { ascending: true });
  return (data || []).map((f) => ({ value: f.id, label: f.nome }));
}

const TIPO_OPTIONS = [
  { value: "produto", label: "Produto físico (controla estoque)" },
  { value: "servico", label: "Serviço (curso/mensalidade — vendido em Matrículas)" },
];

function loadTipoOptions() {
  return TIPO_OPTIONS;
}

const TIPO_LABEL = { produto: "Produto", servico: "Serviço" };

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
      {
        key: "tipo",
        label: "Tipo",
        render: (row) => `<span class="status status--${row.tipo === "servico" ? "matricula" : "venda"}">${TIPO_LABEL[row.tipo] || row.tipo}</span>`,
      },
      { key: "preco", label: "Preço", align: "right", render: (row) => formatCurrency(row.preco) },
      {
        key: "estoque",
        label: "Estoque",
        align: "right",
        render: (row) => {
          if (row.tipo === "servico") return '<span class="cell-muted">—</span>';
          const low = row.estoque <= row.estoque_minimo;
          return `<span style="${low ? "color: var(--danger); font-weight: 700;" : ""}">${row.estoque}</span>`;
        },
      },
      { key: "fornecedor", label: "Fornecedor", sortable: false, render: (row) => escapeHtml(row.fornecedor?.nome || "—") },
      {
        key: "ativo",
        label: "Status",
        render: (row) => `<span class="status status--${row.ativo ? "ativo" : "inativo"}">${row.ativo ? "Ativo" : "Inativo"}</span>`,
      },
    ],
    fields: [
      { key: "nome", label: "Nome", required: true, full: true },
      { key: "tipo", label: "Tipo", type: "select", required: true, default: "produto", full: true, optionsLoader: loadTipoOptions },
      { key: "sku", label: "SKU" },
      { key: "categoria", label: "Categoria" },
      { key: "preco", label: "Preço de venda", type: "number", step: "0.01", required: true, default: 0 },
      { key: "custo", label: "Custo", type: "number", step: "0.01", default: 0 },
      { key: "estoque_minimo", label: "Estoque mínimo", type: "number", step: "1", default: 0 },
      { key: "fornecedor_id", label: "Fornecedor", type: "search-select", dependsOn: "empresa_id", optionsLoader: loadFornecedorOptions },
      { key: "descricao", label: "Descrição", type: "textarea", full: true },
      { key: "ativo", label: "Produto ativo", type: "checkbox", default: true, full: true },
    ],
  });
}
