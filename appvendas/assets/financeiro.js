// AppVendas — Financeiro > Contas a Receber: lista tudo que foi recebido no
// período (vendas confirmadas + lançamentos manuais) e permite registrar um
// recebimento manual avulso (além de vendas), que também exige um produto e
// reduz o estoque dele — mesmo padrão de criar_venda/cancelar_venda.

import { supabase } from "./supabaseClient.js";
import { showToast, openModal, closeModal, confirmDialog, formatCurrency, formatDate, escapeHtml, createSearchSelect, registerAutoRefresh } from "./app.js";
import { isAdmin, getCurrentEmpresaId } from "./auth.js";

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de crédito", "Cartão de débito", "Boleto"];

let clientesOptions = [];
let produtosOptions = [];
let empresasOptions = [];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthStr() {
  return `${todayStr().slice(0, 7)}-01`;
}

async function loadClientes() {
  const { data } = await supabase.from("clientes").select("id, nome, documento").eq("ativo", true).eq("status_cadastro", "aprovado").order("nome", { ascending: true });
  return data || [];
}

async function loadProdutos() {
  const { data } = await supabase.from("produtos").select("id, nome, sku, preco, estoque").eq("ativo", true).order("nome", { ascending: true });
  return data || [];
}

async function loadEmpresas() {
  if (!isAdmin()) return [];
  const { data } = await supabase.from("empresas").select("id, nome_fantasia, codigo").eq("ativo", true).order("nome_fantasia", { ascending: true });
  return data || [];
}

export async function render(view, actionsEl) {
  const state = { inicio: firstDayOfMonthStr(), fim: todayStr() };

  [clientesOptions, produtosOptions, empresasOptions] = await Promise.all([loadClientes(), loadProdutos(), loadEmpresas()]);

  actionsEl.innerHTML = `<button type="button" class="btn btn--primary" id="btn-novo-recebimento">+ Novo recebimento</button>`;
  actionsEl.querySelector("#btn-novo-recebimento").addEventListener("click", () => {
    openRecebimentoForm(() => load(view, state, { silent: true }));
  });

  view.innerHTML = `
    <div class="toolbar financeiro-filtro">
      <div class="field" style="flex: 0 0 160px;">
        <label for="cr-inicio">De</label>
        <input class="input" type="date" id="cr-inicio" value="${state.inicio}" />
      </div>
      <div class="field" style="flex: 0 0 160px;">
        <label for="cr-fim">Até</label>
        <input class="input" type="date" id="cr-fim" value="${state.fim}" />
      </div>
      <div class="field" style="flex: 0 0 auto;">
        <label>&nbsp;</label>
        <button type="button" class="btn btn--ghost" id="cr-filtrar">Filtrar</button>
      </div>
    </div>
    <div id="cr-content"><div class="empty-state">Carregando…</div></div>
  `;

  const inicioInput = view.querySelector("#cr-inicio");
  const fimInput = view.querySelector("#cr-fim");

  view.querySelector("#cr-filtrar").addEventListener("click", () => {
    state.inicio = inicioInput.value || state.inicio;
    state.fim = fimInput.value || state.fim;
    load(view, state);
  });

  await load(view, state);

  registerAutoRefresh(() => load(view, state, { silent: true }), 20000);
}

async function load(view, state, opts = {}) {
  const { silent = false } = opts;
  const content = view.querySelector("#cr-content");
  if (!silent) content.innerHTML = `<div class="empty-state">Carregando…</div>`;

  const [vendasRes, recebimentosRes] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, numero, data_venda, forma_pagamento, total, cliente:clientes(nome), itens:venda_itens(quantidade, produto:produtos(nome))")
      .eq("status", "confirmada")
      .gte("data_venda", state.inicio)
      .lte("data_venda", state.fim),
    supabase
      .from("recebimentos")
      .select("id, data_recebimento, quantidade, valor, forma_pagamento, observacoes, status, cliente:clientes(nome), produto:produtos(nome)")
      .gte("data_recebimento", state.inicio)
      .lte("data_recebimento", state.fim),
  ]);

  if (vendasRes.error || recebimentosRes.error) {
    const err = vendasRes.error || recebimentosRes.error;
    content.innerHTML = `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar os recebimentos</p><p class="empty-state__hint">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const linhasVendas = (vendasRes.data || []).map((v) => ({
    origem: "venda",
    id: v.id,
    data: v.data_venda,
    cliente: v.cliente?.nome || "Sem cliente",
    itens: (v.itens || []).map((i) => `${i.quantidade}x ${i.produto?.nome || "Produto"}`).join(", ") || "—",
    formaPagamento: v.forma_pagamento,
    valor: Number(v.total || 0),
    status: "recebido",
    numero: v.numero,
  }));

  const linhasManuais = (recebimentosRes.data || []).map((r) => ({
    origem: "manual",
    id: r.id,
    data: r.data_recebimento,
    cliente: r.cliente?.nome || "Sem cliente",
    itens: `${r.quantidade}x ${r.produto?.nome || "Produto"}`,
    formaPagamento: r.forma_pagamento,
    valor: Number(r.valor || 0),
    status: r.status,
  }));

  const linhas = [...linhasVendas, ...linhasManuais].sort((a, b) => new Date(b.data) - new Date(a.data));
  const linhasAtivas = linhas.filter((l) => l.status !== "cancelado");

  const totalRecebido = linhasAtivas.reduce((sum, l) => sum + l.valor, 0);
  const totalVendas = linhasAtivas.filter((l) => l.origem === "venda").reduce((sum, l) => sum + l.valor, 0);
  const totalManual = linhasAtivas.filter((l) => l.origem === "manual").reduce((sum, l) => sum + l.valor, 0);

  content.innerHTML = `
    <div class="stat-grid">
      ${statCard("Total recebido no período", formatCurrency(totalRecebido), "var(--accent-deep)")}
      ${statCard("Recebido em vendas", formatCurrency(totalVendas), "var(--accent)")}
      ${statCard("Recebido manualmente", formatCurrency(totalManual), "var(--amber)")}
      ${statCard("Lançamentos no período", linhasAtivas.length, "var(--text-muted)")}
    </div>
    <div class="card card-section">
      <p class="section-title">Recebimentos</p>
      ${renderTabela(linhas)}
    </div>
  `;

  content.querySelectorAll("[data-cancelar]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog("Cancelar este recebimento manual? O estoque do produto será devolvido.", { confirmLabel: "Cancelar recebimento" });
      if (!ok) return;
      const { error } = await supabase.rpc("cancelar_recebimento_manual", { p_recebimento_id: btn.dataset.cancelar });
      if (error) {
        showToast(error.message, "error");
        return;
      }
      showToast("Recebimento cancelado e estoque devolvido.");
      produtosOptions = await loadProdutos();
      load(view, state);
    });
  });
}

function statCard(label, value, tagColor) {
  return `
    <div class="card stat-card" style="--tag-color:${tagColor}">
      <p class="stat-card__label">${escapeHtml(label)}</p>
      <p class="stat-card__value">${value}</p>
    </div>
  `;
}

function renderTabela(linhas) {
  if (linhas.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhum valor recebido neste período.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Data</th><th>Origem</th><th>Cliente</th><th>Item(ns)</th><th>Pagamento</th><th style="text-align:right">Valor</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${linhas.map((l) => `
            <tr>
              <td>${formatDate(l.data)}</td>
              <td><span class="status status--${l.origem}">${l.origem === "venda" ? `Venda #${l.numero}` : "Manual"}</span></td>
              <td>${escapeHtml(l.cliente)}</td>
              <td>${escapeHtml(l.itens)}</td>
              <td class="cell-muted">${escapeHtml(l.formaPagamento || "—")}</td>
              <td class="cell-num">${formatCurrency(l.valor)}</td>
              <td><span class="status status--${l.status === "recebido" ? "confirmada" : "cancelada"}">${l.status === "recebido" ? "Recebido" : "Cancelado"}</span></td>
              <td class="cell-actions">
                ${l.origem === "manual" && l.status === "recebido" ? `<button type="button" class="btn btn--danger btn--sm" data-cancelar="${l.id}">Cancelar</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ── Modal de novo recebimento manual ────────────────────────────────

function produtoSearchOptions() {
  return produtosOptions.map((p) => ({
    value: p.id,
    label: p.nome,
    meta: `${formatCurrency(p.preco)} · estoque ${p.estoque}`,
  }));
}

function clienteSearchOptions() {
  return clientesOptions.map((c) => ({ value: c.id, label: c.nome, meta: c.documento || "" }));
}

function empresaSearchOptions() {
  return empresasOptions.map((e) => ({ value: e.id, label: e.nome_fantasia, meta: e.codigo }));
}

function openRecebimentoForm(onSaved) {
  const admin = isAdmin();
  const body = openModal("Novo recebimento");

  body.innerHTML = `
    <form id="cr-form">
      <div id="cr-form-error"></div>
      <div class="form-grid">
        ${admin ? `
        <div class="field field--full">
          <label>Empresa<span class="field-required">*</span></label>
          <div data-mount="cr-empresa"></div>
        </div>
        ` : ""}
        <div class="field field--full">
          <label>Cliente <span class="field-optional">opcional</span></label>
          <div data-mount="cr-cliente"></div>
        </div>
        <div class="field field--full">
          <label>Produto<span class="field-required">*</span></label>
          <div data-mount="cr-produto"></div>
        </div>
        <div class="field">
          <label for="cr-qtd">Quantidade<span class="field-required">*</span></label>
          <input class="input" type="number" id="cr-qtd" min="1" step="1" value="1" required />
        </div>
        <div class="field">
          <label for="cr-valor">Valor recebido<span class="field-required">*</span></label>
          <input class="input" type="number" id="cr-valor" min="0" step="0.01" value="0" required />
        </div>
        <div class="field">
          <label for="cr-forma">Forma de pagamento</label>
          <select class="input" id="cr-forma">
            ${FORMAS_PAGAMENTO.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="cr-data">Data do recebimento<span class="field-required">*</span></label>
          <input class="input" type="date" id="cr-data" value="${todayStr()}" required />
        </div>
        <div class="field field--full">
          <label for="cr-obs">Observações</label>
          <textarea class="input" id="cr-obs" rows="2"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="cr-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Registrar recebimento</button>
      </div>
    </form>
  `;

  const empresaSelect = admin
    ? createSearchSelect({
        container: body.querySelector('[data-mount="cr-empresa"]'),
        placeholder: "Buscar empresa…",
        options: empresaSearchOptions(),
        value: getCurrentEmpresaId(),
        allowClear: false,
      })
    : null;

  const clienteSelect = createSearchSelect({
    container: body.querySelector('[data-mount="cr-cliente"]'),
    placeholder: "Buscar cliente por nome ou documento… (opcional)",
    options: clienteSearchOptions(),
    allowClear: true,
  });

  const produtoSelect = createSearchSelect({
    container: body.querySelector('[data-mount="cr-produto"]'),
    placeholder: "Buscar produto por nome ou SKU…",
    options: produtoSearchOptions(),
    allowClear: true,
    onChange: () => atualizarSugestaoValor(),
  });

  const qtdInput = body.querySelector("#cr-qtd");
  const valorInput = body.querySelector("#cr-valor");

  // Sugere o valor (preço de tabela x quantidade) ao escolher o produto ou
  // mudar a quantidade — só enquanto o usuário não editar o valor manualmente.
  let valorTocado = false;
  valorInput.addEventListener("input", () => {
    valorTocado = true;
  });

  function atualizarSugestaoValor() {
    if (valorTocado) return;
    const produto = produtosOptions.find((p) => p.id === produtoSelect.getValue());
    if (!produto) return;
    const quantidade = Number(qtdInput.value || 0);
    valorInput.value = (Number(produto.preco || 0) * quantidade).toFixed(2);
  }

  qtdInput.addEventListener("input", atualizarSugestaoValor);

  body.querySelector("#cr-cancel").addEventListener("click", closeModal);

  body.querySelector("#cr-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = body.querySelector("#cr-form-error");
    errorEl.innerHTML = "";

    const produtoId = produtoSelect.getValue();
    if (!produtoId) {
      errorEl.innerHTML = `<div class="form-error">Selecione um produto.</div>`;
      return;
    }

    if (admin && !empresaSelect.getValue()) {
      errorEl.innerHTML = `<div class="form-error">Selecione uma empresa.</div>`;
      return;
    }

    const payload = {
      p_produto_id: produtoId,
      p_quantidade: Number(qtdInput.value || 0),
      p_valor: Number(valorInput.value || 0),
      p_cliente_id: clienteSelect.getValue() || null,
      p_forma_pagamento: body.querySelector("#cr-forma").value || null,
      p_data_recebimento: body.querySelector("#cr-data").value || null,
      p_observacoes: body.querySelector("#cr-obs").value || null,
    };
    if (admin) payload.p_empresa_id = empresaSelect.getValue();

    const { error } = await supabase.rpc("criar_recebimento_manual", payload);

    if (error) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(error.message)}</div>`;
      return;
    }

    showToast("Recebimento registrado com sucesso.");
    closeModal();
    if (onSaved) onSaved();
  });
}
