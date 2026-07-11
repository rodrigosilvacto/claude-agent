import { renderCadastro } from "./cadastro.js";

export async function render(view, actionsEl) {
  await renderCadastro(view, actionsEl, {
    table: "clientes",
    titleSingular: "Cliente",
    searchPlaceholder: "Buscar por nome, documento ou cidade…",
    searchColumns: ["nome", "documento", "cidade"],
    orderBy: "nome",
    columns: [
      { key: "nome", label: "Nome" },
      { key: "documento", label: "Documento" },
      { key: "telefone", label: "Telefone" },
      { key: "cidade", label: "Cidade" },
      {
        key: "ativo",
        label: "Status",
        render: (row) => `<span class="status status--${row.ativo ? "ativo" : "inativo"}">${row.ativo ? "Ativo" : "Inativo"}</span>`,
      },
    ],
    fields: [
      { key: "nome", label: "Nome", required: true, full: true },
      { key: "documento", label: "CPF/CNPJ" },
      { key: "email", label: "E-mail", type: "email" },
      { key: "telefone", label: "Telefone" },
      { key: "cidade", label: "Cidade" },
      { key: "uf", label: "UF" },
      { key: "endereco", label: "Endereço", full: true },
      { key: "ativo", label: "Cliente ativo", type: "checkbox", default: true, full: true },
    ],
  });
}
