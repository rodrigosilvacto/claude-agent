// Motor genérico de tela de cadastro (listar + buscar + ordenar + criar/editar
// + excluir). Clientes, Produtos e Fornecedores compartilham exatamente este
// fluxo — só mudam os campos e colunas — então fica configurado por tela em
// vez de triplicado.

import { supabase } from "./supabaseClient.js";
import { showToast, openModal, closeModal, confirmDialog, escapeHtml, skeletonTable, createSearchSelect, registerAutoRefresh } from "./app.js";

const SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

export async function renderCadastro(view, actionsEl, config) {
  actionsEl.innerHTML = `<button type="button" class="btn btn--primary" id="btn-new">+ Novo ${escapeHtml(config.titleSingular)}</button>`;
  view.innerHTML = `
    <div class="toolbar">
      <div class="search-input-wrap">
        ${SEARCH_ICON}
        <input type="search" class="input" id="search-input" placeholder="${escapeHtml(config.searchPlaceholder)}" />
      </div>
      <p class="record-count" id="record-count"></p>
    </div>
    ${skeletonTable()}
  `;

  const searchInput = view.querySelector("#search-input");
  const state = { key: config.orderBy || "nome", asc: true };

  actionsEl.querySelector("#btn-new").addEventListener("click", () => openForm(config, null, () => loadRows(config, view, searchInput.value.trim(), state)));

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadRows(config, view, searchInput.value.trim(), state), 250);
  });

  await loadRows(config, view, "", state);

  registerAutoRefresh(() => loadRows(config, view, searchInput.value.trim(), state, { silent: true }), 15000);
}

async function loadRows(config, view, term, state, opts = {}) {
  const { silent = false } = opts;
  const countEl = view.querySelector("#record-count");
  const existingCard = view.querySelector(".card");

  if (!silent || !existingCard) {
    existingCard?.remove();
    view.insertAdjacentHTML("beforeend", skeletonTable());
    if (countEl) countEl.textContent = "";
  }

  let query = supabase.from(config.table).select(config.selectQuery || "*");

  if (term && config.searchColumns?.length) {
    const orFilter = config.searchColumns.map((col) => `${col}.ilike.%${term.replace(/[%,]/g, "")}%`).join(",");
    query = query.or(orFilter);
  }

  const { data, error } = await query;
  const card = view.querySelector(".card");

  if (error) {
    card.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar</p><p class="empty-state__hint">${escapeHtml(error.message)}</p></div>`;
    return;
  }

  if (!data || data.length === 0) {
    card.innerHTML = `<div class="empty-state"><p class="empty-state__title">Nenhum registro encontrado</p><p class="empty-state__hint">Use "+ Novo ${escapeHtml(config.titleSingular)}" para cadastrar o primeiro.</p></div>`;
    return;
  }

  if (countEl) countEl.textContent = `${data.length} registro${data.length === 1 ? "" : "s"}`;

  renderTable(config, view, card, data, state);
}

function sortData(data, config, state) {
  const col = config.columns.find((c) => c.key === state.key);
  const dir = state.asc ? 1 : -1;
  return [...data].sort((a, b) => {
    const va = col?.sortValue ? col.sortValue(a) : a[state.key];
    const vb = col?.sortValue ? col.sortValue(b) : b[state.key];
    if (va == null && vb == null) return 0;
    if (va == null) return -1 * dir;
    if (vb == null) return 1 * dir;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb), "pt-BR") * dir;
  });
}

function renderTable(config, view, card, data, state) {
  const sorted = sortData(data, config, state);

  const rows = sorted.map((row) => {
    const railColor = "ativo" in row ? `var(${row.ativo ? "--success" : "--text-muted"})` : "transparent";
    return `
    <tr>
      ${config.columns.map((col, idx) => {
        const classes = [col.align === "right" ? "cell-num" : "", idx === 0 ? "cell-rail" : ""].filter(Boolean).join(" ");
        const style = idx === 0 ? ` style="--rail-color:${railColor}"` : "";
        return `<td class="${classes}"${style}>${col.render ? col.render(row) : escapeHtml(row[col.key] ?? "—")}</td>`;
      }).join("")}
      <td class="cell-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit="${row.id}">Editar</button>
        <button type="button" class="btn btn--danger btn--sm" data-delete="${row.id}">Excluir</button>
      </td>
    </tr>
  `;
  }).join("");

  card.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            ${config.columns.map((col) => `
              <th ${col.align === "right" ? 'style="text-align:right"' : ""}>
                <button type="button" class="th-sort ${state.key === col.key ? "is-active" : ""}" data-sort="${col.key}">
                  ${escapeHtml(col.label)}
                  <span class="th-sort__caret">${state.key === col.key ? (state.asc ? "▲" : "▼") : "↕"}</span>
                </button>
              </th>
            `).join("")}
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  card.querySelectorAll("[data-sort]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sort;
      state.asc = state.key === key ? !state.asc : true;
      state.key = key;
      renderTable(config, view, card, data, state);
    });
  });

  card.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = data.find((r) => r.id === btn.dataset.edit);
      openForm(config, row, () => loadRows(config, view, view.querySelector("#search-input").value.trim(), state));
    });
  });

  card.querySelectorAll("[data-delete]").forEach((btn) => {
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
      loadRows(config, view, view.querySelector("#search-input").value.trim(), state);
    });
  });
}

async function openForm(config, existingRow, onSaved) {
  const isEdit = Boolean(existingRow);
  const body = openModal(isEdit ? `Editar ${config.titleSingular}` : `Novo ${config.titleSingular}`);

  const optionsByField = {};
  for (const field of config.fields) {
    if ((field.type === "select" || field.type === "search-select") && field.optionsLoader) {
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

  const searchSelects = {};
  for (const field of config.fields) {
    if (field.type !== "search-select") continue;
    const mount = body.querySelector(`[data-search-select="${field.key}"]`);
    searchSelects[field.key] = createSearchSelect({
      container: mount,
      placeholder: field.placeholder || `Buscar ${field.label.toLowerCase()}…`,
      options: optionsByField[field.key] || [],
      value: existingRow ? existingRow[field.key] : (field.default ?? null),
      allowClear: !field.required,
    });
  }

  body.querySelector("#btn-cancel").addEventListener("click", closeModal);

  body.querySelector("#cadastro-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = {};
    const errorEl = form.querySelector("#form-error");
    errorEl.innerHTML = "";

    for (const field of config.fields) {
      if (field.type === "search-select") {
        const value = searchSelects[field.key].getValue();
        if (field.required && !value) {
          errorEl.innerHTML = `<div class="form-error">Selecione um valor para "${escapeHtml(field.label)}".</div>`;
          return;
        }
        payload[field.key] = value;
        continue;
      }
      const input = form.elements[field.key];
      if (field.type === "checkbox") {
        payload[field.key] = input.checked;
      } else if (field.type === "number") {
        payload[field.key] = input.value === "" ? null : Number(input.value);
      } else {
        payload[field.key] = input.value === "" ? null : input.value;
      }
    }

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
  });
}

function renderField(field, existingRow, options) {
  const value = existingRow ? existingRow[field.key] : field.default;
  const wrapClass = field.full ? "field field--full" : "field";
  const required = field.required ? "required" : "";
  const requiredMark = field.required ? '<span class="field-required">*</span>' : "";

  if (field.type === "checkbox") {
    const checked = existingRow ? Boolean(value) : field.default !== false;
    return `
      <div class="${wrapClass}">
        <label><input type="checkbox" name="${field.key}" ${checked ? "checked" : ""} /> ${escapeHtml(field.label)}</label>
      </div>
    `;
  }

  if (field.type === "search-select") {
    return `
      <div class="${wrapClass}">
        <label>${escapeHtml(field.label)}${requiredMark}</label>
        <div data-search-select="${field.key}"></div>
      </div>
    `;
  }

  if (field.type === "select") {
    return `
      <div class="${wrapClass}">
        <label for="f-${field.key}">${escapeHtml(field.label)}${requiredMark}</label>
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
        <label for="f-${field.key}">${escapeHtml(field.label)}${requiredMark}</label>
        <textarea class="input" id="f-${field.key}" name="${field.key}" rows="3" ${required}>${escapeHtml(value ?? "")}</textarea>
      </div>
    `;
  }

  return `
    <div class="${wrapClass}">
      <label for="f-${field.key}">${escapeHtml(field.label)}${requiredMark}</label>
      <input class="input" type="${field.type || "text"}" id="f-${field.key}" name="${field.key}" step="${field.step || ""}" value="${escapeHtml(value ?? "")}" ${required} />
    </div>
  `;
}
