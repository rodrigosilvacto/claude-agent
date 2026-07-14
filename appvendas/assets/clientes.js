import { renderCadastro } from "./cadastro.js";
import { supabase } from "./supabaseClient.js";
import { showToast } from "./app.js";
import { getCurrentEmpresaId } from "./auth.js";

const SITUACAO_LABEL = { pendente: "Pendente", aprovado: "Aprovado", reprovado: "Reprovado" };

export async function render(view, actionsEl) {
  await renderCadastro(view, actionsEl, {
    table: "clientes",
    titleSingular: "Cliente",
    searchPlaceholder: "Buscar por nome, documento ou cidade…",
    searchColumns: ["nome", "documento", "cidade"],
    orderBy: "nome",
    scopeByEmpresa: true,
    columns: [
      { key: "nome", label: "Nome" },
      { key: "documento", label: "Documento" },
      { key: "telefone", label: "Telefone" },
      { key: "cidade", label: "Cidade" },
      {
        key: "status_cadastro",
        label: "Situação",
        render: (row) => `<span class="status status--${row.status_cadastro}">${SITUACAO_LABEL[row.status_cadastro] || row.status_cadastro}</span>`,
      },
      {
        key: "ativo",
        label: "Status",
        render: (row) => `<span class="status status--${row.ativo ? "ativo" : "inativo"}">${row.ativo ? "Ativo" : "Inativo"}</span>`,
      },
    ],
    fields: [
      { key: "nome", label: "Nome", required: true, full: true },
      { key: "documento", label: "CPF/CNPJ" },
      { key: "cep", label: "CEP", type: "cep", autofillMap: { logradouro: "endereco", localidade: "cidade", uf: "uf" } },
      { key: "endereco", label: "Endereço", full: true },
      { key: "cidade", label: "Cidade" },
      { key: "uf", label: "UF" },
      { key: "email", label: "E-mail", type: "email" },
      { key: "telefone", label: "Telefone" },
      { key: "ativo", label: "Cliente ativo", type: "checkbox", default: true, full: true },
    ],
    rowActions: (row) => {
      if (row.status_cadastro === "aprovado") return "";
      const aprovar = `<button type="button" class="btn btn--primary btn--sm" data-row-action="aprovar" data-row-action-id="${row.id}">Aprovar</button>`;
      const reprovar = row.status_cadastro === "pendente"
        ? `<button type="button" class="btn btn--danger btn--sm" data-row-action="reprovar" data-row-action-id="${row.id}">Reprovar</button>`
        : "";
      return aprovar + reprovar;
    },
    onRowAction: async (action, row, reload) => {
      const patch = action === "aprovar"
        ? { status_cadastro: "aprovado", ativo: true }
        : { status_cadastro: "reprovado", ativo: false };
      const { error } = await supabase.from("clientes").update(patch).eq("id", row.id);
      if (error) {
        showToast(error.message, "error");
        return;
      }
      showToast(action === "aprovar" ? `${row.nome} aprovado — já pode ser selecionado nas vendas.` : `${row.nome} reprovado.`);
      reload();
    },
  });

  actionsEl.insertAdjacentHTML("afterbegin", `<button type="button" class="btn btn--ghost" id="btn-copy-precadastro">Copiar link de pré-cadastro</button>`);
  actionsEl.querySelector("#btn-copy-precadastro").addEventListener("click", async () => {
    const basePath = window.location.pathname.replace(/[^/]*$/, "");
    let query = "";
    const empresaId = getCurrentEmpresaId();
    if (empresaId) {
      const { data: empresa } = await supabase.from("empresas").select("codigo").eq("id", empresaId).maybeSingle();
      if (empresa?.codigo) query = `?empresa=${encodeURIComponent(empresa.codigo)}`;
    }
    const url = `${window.location.origin}${basePath}pre-cadastro.html${query}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link de pré-cadastro copiado.");
    } catch {
      showToast(`Link: ${url}`);
    }
  });
}
