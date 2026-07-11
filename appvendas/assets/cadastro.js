// Motor genérico de tela de cadastro (listar + buscar + criar/editar + excluir).
// Clientes, Produtos e Fornecedores compartilham exatamente este fluxo —
// só mudam os campos e colunas — então fica configurado por tela em vez de
// triplicado.

import { supabase } from "./supabaseClient.js";
import { showToast, openModal, closeModal, confirmDialog, escapeHtml } from "./app.js";

export async function renderCadastro(view, actionsEl, config) {
  actionsEl.innerHTML = `<button type="button" class="btn btn--primary" id="btn-new">+ Novo ${escapeHtml(config.titleSingular)}</button>`;
  view.innerHTML = `
    <div class="toolbar">
      <input type="search" class="input search-input" id="search-input" placeholder="${escapeHtml(config.searchPlaceholder)}" />
    </div>
    <div class="card">
      <div class="table-wrap" id="table-wrap"><div class="empty-state">Carregando…</div></div>
    </div>
  `;

  const tableWrap = view.querySelector("#table-wrap");
  const searchInput = view.querySelector("#search-input");
  actionsEl.querySelector("#btn-new").addEventListener("click", () => openForm(config, null));

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRows(config, tableWrap, searchInput.value.trim()), 250);
  });

  await loadRows(config, tableWrap, "");
}

async function loadRows(config, tableWrap, term) {
  tableWrap.innerHTML = '<div class="empty-state">Carregando…</div>';

  let query = supabase.from(config.table).select(config.selectQuery || "*");

  if (term && config.searchColumns?.length) {
    const orFilter = config.searchColumns.map((col) => `${col}.ilike.%${term.replace(/[%,]/g, "")}%`).join(",");
    query = query.or(orFilter);
  }

  query = query.order(config.orderBy || "nome", { ascending: true });

  const { data, error } = await query;

  if (error) {
    tableWrap.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar</p><p class="empty-state__hint">${escapeHtml(error.message)}</p></div>`;
    return;
  }

  if (!data || data.length === 0) {
    tableWrap.innerHTML = `<div class="empty-state"><p class="empty-state__title">Nenhum registro encontrado</p><p class="empty-state__hint">Use "+ Novo ${escapeHtml(config.titleSingular)}" para cadastrar o primeiro.</p></div>`;
    return;
  }

  const rows = data.map((row) => `
    <tr>
      ${config.columns.map((col) => `<td class="${col.align === "right" ? "cell-num" : ""}">${col.render ? col.render(row) : escapeHtml(row[col.key] ?? "—")}</td>`).join("")}
      <td class="cell-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit="${row.id}">Editar</button>
        <button type="button" class="btn btn--danger btn--sm" data-delete="${row.id}">Excluir</button>
      </td>
    </tr>
  `).join("");

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          ${config.columns.map((col) => `<th ${col.align === "right" ? 'style="text-align:right"' : ""}>${escapeHtml(col.label)}</th>`).join("")}
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  tableWrap.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = data.find((r) => r.id === btn.dataset.edit);
      openForm(config, row, () => loadRows(config, tableWrap, ""));
    });
  });

  tableWrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog(`Excluir este ${config.titleSingular.toLowerCase()}? Esta ação não pode ser desfeita.`, { confirmLabel: "Excluir" });
      if (!ok) return;
      const { error } = await supabase.from(config.table).delete().eq("id", btn.dataset.delete);
      if (error) {
        const friendly = error.code === "23503"
          ? "Não é possível excluir: existem registros vinculados a este cadastro."
          : error.message;
        showToast(friendly, "error");
        return;
      }
      showToast(`${config.titleSingular} excluído.`);
      loadRows(config, tableWrap, "");
    });
  });
}

async function openForm(config, existingRow, onSaved) {
  const isEdit = Boolean(existingRow);
  const body = openModal(isEdit ? `Editar ${config.titleSingular}` : `Novo ${config.titleSingular}`);

  const optionsByField = {};
  for (const field of config.fields) {
    if (field.type === "select" && field.optionsLoader) {
      optionsByField[field.key] = await field.optionsLoader();
    }
  }

  body.innerHTML = `
    <form id="cadastro-form">
      <div id="form-error"></div>
      <div class="form-grid">
        ${config.fields.map((field) => renderField(field, existingRow, optionsByField[field.key])).join("")}
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="btn-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Salvar</button>
      </div>
    </form>
  `;

  body.querySelector("#btn-cancel").addEventListener("click", closeModal);

  body.querySelector("#cadastro-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = {};
    for (const field of config.fields) {
      const input = form.elements[field.key];
      if (field.type === "checkbox") {
        payload[field.key] = input.checked;
      } else if (field.type === "number") {
        payload[field.key] = input.value === "" ? null : Number(input.value);
      } else {
        payload[field.key] = input.value === "" ? null : input.value;
      }
    }

    const errorEl = form.querySelector("#form-error");
    errorEl.innerHTML = "";

    const query = isEdit
      ? supabase.from(config.table).update(payload).eq("id", existingRow.id)
      : supabase.from(config.table).insert(payload);

    const { error } = await query;

    if (error) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(error.message)}</div>`;
      return;
    }

    showToast(`${config.titleSingular} ${isEdit ? "atualizado" : "cadastrado"}.`);
    closeModal();
    if (onSaved) onSaved();
    else document.dispatchEvent(new CustomEvent("cadastro:saved"));
  });
}

function renderField(field, existingRow, options) {
  const value = existingRow ? existingRow[field.key] : field.default;
  const wrapClass = field.full ? "field field--full" : "field";
  const required = field.required ? "required" : "";

  if (field.type === "checkbox") {
    const checked = existingRow ? Boolean(value) : field.default !== false;
    return `
      <div class="${wrapClass}">
        <label><input type="checkbox" name="${field.key}" ${checked ? "checked" : ""} /> ${escapeHtml(field.label)}</label>
      </div>
    `;
  }

  if (field.type === "select") {
    return `
      <div class="${wrapClass}">
        <label for="f-${field.key}">${escapeHtml(field.label)}</label>
        <select class="input" id="f-${field.key}" name="${field.key}" ${required}>
          <option value="">—</option>
          ${(options || []).map((opt) => `<option value="${escapeHtml(opt.value)}" ${String(value) === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}
        </select>
      </div>
    `;
  }

  if (field.type === "textarea") {
    return `
      <div class="${wrapClass}">
        <label for="f-${field.key}">${escapeHtml(field.label)}</label>
        <textarea class="input" id="f-${field.key}" name="${field.key}" rows="3" ${required}>${escapeHtml(value ?? "")}</textarea>
      </div>
    `;
  }

  return `
    <div class="${wrapClass}">
      <label for="f-${field.key}">${escapeHtml(field.label)}</label>
      <input class="input" type="${field.type || "text"}" id="f-${field.key}" name="${field.key}" step="${field.step || ""}" value="${escapeHtml(value ?? "")}" ${required} />
    </div>
  `;
}
