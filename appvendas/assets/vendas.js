import { supabase } from "./supabaseClient.js";
import { showToast, openModal, confirmDialog, formatCurrency, formatDate, formatDateTime, escapeHtml, createSearchSelect, registerAutoRefresh, consumeVendaPrefill, withButtonLock, friendlyPgError } from "./app.js";
import { isAdmin } from "./auth.js";
import { loadClientesAtivos, loadProdutosAtivos, loadEmpresasAtivas, clienteSearchOptions, produtoSearchOptions, empresaSearchOptions, produtoMetaPrecoEstoque } from "./catalogo.js";

// Cada forma de pagamento vira um "tile" com ícone no fechamento da venda —
// em vez de uma fileira de pílulas de texto (que não cabiam lado a lado e
// se sobrepunham), cada uma ganha seu próprio espaço, do jeito que um
// terminal de caixa de verdade apresenta as opções.
const FORMAS_PAGAMENTO = [
  {
    label: "Dinheiro",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  },
  {
    label: "Pix",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>',
  },
  {
    label: "Cartão de crédito",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  },
  {
    label: "Cartão de débito",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><rect x="5" y="9" width="4" height="3" rx="0.6"/><path d="M5 16h6"/></svg>',
  },
  {
    label: "Boleto",
    icon: '<svg aria-hidden="true" focusable="false" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="butt"><path d="M3 4v16" stroke-width="1.5"/><path d="M6.5 4v16" stroke-width="3"/><path d="M11 4v16" stroke-width="1.5"/><path d="M14 4v16" stroke-width="1.5"/><path d="M17.5 4v16" stroke-width="3"/><path d="M21.5 4v16" stroke-width="1.5"/></svg>',
  },
];

let clientesOptions = [];
let produtosOptions = [];
let empresasOptions = [];
let cart = [];
// Id do agendamento que originou a venda em andamento (fluxo Agenda → Vendas,
// via setVendaPrefill/consumeVendaPrefill em app.js). Null numa venda avulsa.
let agendamentoOrigemId = null;

export async function render(view, actionsEl) {
  actionsEl.innerHTML = "";
  cart = [];
  agendamentoOrigemId = null;

  view.innerHTML = `
    <div class="toolbar" style="margin-bottom: 1.25rem;">
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="btn btn--primary" id="tab-nova">Nova venda</button>
        <button type="button" class="btn btn--ghost" id="tab-historico">Histórico</button>
      </div>
    </div>
    <div id="tab-content"></div>
  `;

  const tabNova = view.querySelector("#tab-nova");
  const tabHistorico = view.querySelector("#tab-historico");
  const content = view.querySelector("#tab-content");

  function activate(tab) {
    tabNova.className = tab === "nova" ? "btn btn--primary" : "btn btn--ghost";
    tabHistorico.className = tab === "historico" ? "btn btn--primary" : "btn btn--ghost";
    if (tab === "nova") renderNovaVenda(content);
    else renderHistorico(content);
  }

  tabNova.addEventListener("click", () => activate("nova"));
  tabHistorico.addEventListener("click", () => activate("historico"));

  [clientesOptions, produtosOptions, empresasOptions] = await Promise.all([loadClientesAtivos(), loadProdutosAtivos(), loadEmpresasAtivas()]);

  activate("nova");
}

function renderNovaVenda(content) {
  const prefill = consumeVendaPrefill();
  agendamentoOrigemId = prefill?.agendamentoId || null;
  const admin = isAdmin();

  content.innerHTML = `
    <div class="venda-layout">
      <div class="card card-section venda-itens">
        ${prefill ? `
          <div class="form-info">
            Confirmando venda do atendimento de ${escapeHtml(prefill.clienteNome || "cliente sem cadastro")} em ${formatDate(prefill.dataAgendamento)} às ${prefill.horario}. Revise os dados e finalize para registrar a venda.
          </div>
        ` : ""}
        ${admin ? `
          <div class="field">
            <label>Empresa<span class="field-required">*</span></label>
            <div data-mount="v-empresa"></div>
          </div>
        ` : ""}
        <div class="venda-meta">
          <div class="field" style="flex: 1 1 auto; min-width: 0;">
            <label>Cliente <span class="field-optional">opcional</span></label>
            <div data-mount="v-cliente"></div>
          </div>
          <div class="field venda-meta__data">
            <label for="v-data">Data</label>
            <input class="input" type="date" id="v-data" value="${new Date().toISOString().slice(0, 10)}" />
          </div>
        </div>
        <button type="button" class="venda-obs-toggle" id="v-obs-toggle">+ Adicionar observação</button>
        <div class="field venda-obs" id="v-obs-field" hidden>
          <label for="v-obs">Observações</label>
          <textarea class="input" id="v-obs" rows="2"></textarea>
        </div>

        <p class="section-title" style="margin-top: 1.5rem;">Itens</p>
        <div class="form-grid" style="grid-template-columns: 2fr 1fr auto; align-items: end;">
          <div class="field">
            <label>Produto</label>
            <div data-mount="v-produto"></div>
          </div>
          <div class="field">
            <label for="v-qtd">Quantidade</label>
            <input class="input" type="number" id="v-qtd" min="1" step="1" value="1" />
          </div>
          <div class="field">
            <button type="button" class="btn btn--ghost" id="v-add-item">+ Adicionar</button>
          </div>
        </div>

        <div class="table-wrap" style="margin-top: 1rem;">
          <table class="data-table" id="cart-table">
            <thead>
              <tr><th>Produto</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Preço</th><th style="text-align:right">Subtotal</th><th></th></tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <div class="card receipt">
        <p class="section-title">Fechamento</p>

        <p class="receipt__label">Forma de pagamento</p>
        <div class="paytiles" id="v-forma" role="radiogroup" aria-label="Forma de pagamento">
          ${FORMAS_PAGAMENTO.map((forma, idx) => `
            <button type="button" class="paytile ${idx === 0 ? "is-active" : ""}" data-value="${escapeHtml(forma.label)}" role="radio" aria-checked="${idx === 0}">
              <span class="paytile__icon">${forma.icon}</span>
              <span class="paytile__label">${escapeHtml(forma.label)}</span>
            </button>
          `).join("")}
        </div>

        <div class="receipt__tear"></div>
        <div class="receipt__row"><span>Subtotal</span><span id="r-subtotal">${formatCurrency(0)}</span></div>
        <div class="receipt__row">
          <span>Desconto</span>
          <input class="input" type="number" id="v-desconto" min="0" step="0.01" value="0" style="width: 110px; text-align:right; font-family: var(--font-mono);" />
        </div>
        <div class="receipt__tear"></div>
        <div class="receipt__total"><span>Total</span><span id="r-total">${formatCurrency(0)}</span></div>
        <button type="button" class="btn btn--primary" id="v-finalizar" style="width:100%; justify-content:center; margin-top: 1.25rem;">Finalizar venda</button>
        <div id="v-error"></div>
      </div>
    </div>
  `;

  const cartBody = content.querySelector("#cart-table tbody");
  const descontoInput = content.querySelector("#v-desconto");
  const formaGroup = content.querySelector("#v-forma");
  let formaPagamento = FORMAS_PAGAMENTO[0].label;

  formaGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-value]");
    if (!btn) return;
    formaPagamento = btn.dataset.value;
    formaGroup.querySelectorAll(".paytile").forEach((b) => {
      const active = b === btn;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
  });

  const obsToggle = content.querySelector("#v-obs-toggle");
  const obsField = content.querySelector("#v-obs-field");
  const obsInput = content.querySelector("#v-obs");
  obsToggle.addEventListener("click", () => {
    obsField.hidden = false;
    obsToggle.hidden = true;
    obsInput.focus();
  });

  if (prefill) {
    obsField.hidden = false;
    obsToggle.hidden = true;
    obsInput.value = `Venda referente ao atendimento agendado em ${formatDate(prefill.dataAgendamento)} às ${prefill.horario}.${prefill.observacoes ? ` Obs. do agendamento: ${prefill.observacoes}` : ""}`;
  }

  const empresaSelect = admin
    ? createSearchSelect({
        container: content.querySelector('[data-mount="v-empresa"]'),
        placeholder: "Buscar empresa…",
        options: empresaSearchOptions(empresasOptions),
        allowClear: false,
      })
    : null;

  const clienteSelect = createSearchSelect({
    container: content.querySelector('[data-mount="v-cliente"]'),
    placeholder: "Buscar cliente por nome ou documento… (opcional)",
    options: clienteSearchOptions(clientesOptions),
    value: prefill?.clienteId || null,
    allowClear: true,
  });

  const produtoSelect = createSearchSelect({
    container: content.querySelector('[data-mount="v-produto"]'),
    placeholder: "Buscar produto por nome ou SKU…",
    options: produtoSearchOptions(produtosOptions, { meta: produtoMetaPrecoEstoque }),
    allowClear: true,
  });

  if (prefill?.produtoId) {
    const produto = produtosOptions.find((p) => p.id === prefill.produtoId);
    if (produto) cart.push({ produto_id: produto.id, nome: produto.nome, quantidade: 1, preco_unitario: produto.preco });
    else showToast("Produto do atendimento não encontrado no catálogo de vendas.", "error");
  }

  function renderCart() {
    if (cart.length === 0) {
      cartBody.innerHTML = `<tr><td colspan="5" class="empty-state" style="padding: 1.5rem;">Nenhum item adicionado ainda.</td></tr>`;
    } else {
      cartBody.innerHTML = cart.map((item, idx) => `
        <tr>
          <td>${escapeHtml(item.nome)}</td>
          <td class="cell-num">${item.quantidade}</td>
          <td class="cell-num">${formatCurrency(item.preco_unitario)}</td>
          <td class="cell-num">${formatCurrency(item.quantidade * item.preco_unitario)}</td>
          <td class="cell-actions"><button type="button" class="icon-btn" data-remove="${idx}" aria-label="Remover">&times;</button></td>
        </tr>
      `).join("");
      cartBody.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", () => {
          cart.splice(Number(btn.dataset.remove), 1);
          renderCart();
        });
      });
    }
    updateTotals();
  }

  function updateTotals() {
    const subtotal = cart.reduce((sum, item) => sum + item.quantidade * item.preco_unitario, 0);
    const desconto = Number(descontoInput.value || 0);
    content.querySelector("#r-subtotal").textContent = formatCurrency(subtotal);
    content.querySelector("#r-total").textContent = formatCurrency(Math.max(subtotal - desconto, 0));
  }

  descontoInput.addEventListener("input", updateTotals);

  const qtdInput = content.querySelector("#v-qtd");

  function addItem() {
    const produtoId = produtoSelect.getValue();
    const produto = produtosOptions.find((p) => p.id === produtoId);
    const quantidade = Number(qtdInput.value || 0);

    if (!produto || quantidade <= 0) return;

    const existing = cart.find((item) => item.produto_id === produto.id);
    if (existing) existing.quantidade += quantidade;
    else cart.push({ produto_id: produto.id, nome: produto.nome, quantidade, preco_unitario: produto.preco });

    qtdInput.value = 1;
    produtoSelect.reset();
    produtoSelect.focusInput();
    renderCart();
  }

  content.querySelector("#v-add-item").addEventListener("click", addItem);
  qtdInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  });

  content.querySelector("#v-finalizar").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
    const errorEl = content.querySelector("#v-error");
    errorEl.innerHTML = "";

    if (cart.length === 0) {
      errorEl.innerHTML = `<div class="form-error">Adicione ao menos um item antes de finalizar.</div>`;
      return;
    }

    if (admin && !empresaSelect.getValue()) {
      errorEl.innerHTML = `<div class="form-error">Selecione uma empresa.</div>`;
      return;
    }

    const payload = {
      p_cliente_id: clienteSelect.getValue() || null,
      p_data_venda: content.querySelector("#v-data").value || null,
      p_forma_pagamento: formaPagamento,
      p_observacoes: content.querySelector("#v-obs").value || null,
      p_desconto: Number(descontoInput.value || 0),
      p_itens: cart.map((item) => ({ produto_id: item.produto_id, quantidade: item.quantidade, preco_unitario: item.preco_unitario })),
    };
    if (admin) payload.p_empresa_id = empresaSelect.getValue();

    const { error } = await supabase.rpc("criar_venda", payload);

    if (error) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(friendlyPgError(error))}</div>`;
      return;
    }

    if (agendamentoOrigemId) {
      const { error: agError } = await supabase.from("agendamentos").update({ status: "atendido" }).eq("id", agendamentoOrigemId);
      showToast(agError ? "Venda registrada, mas não foi possível confirmar o atendimento na agenda." : "Venda registrada e atendimento confirmado.", agError ? "error" : "success");
    } else {
      showToast("Venda registrada com sucesso.");
    }

    agendamentoOrigemId = null;
    cart = [];
    produtosOptions = await loadProdutosAtivos();
    renderNovaVenda(content);
  }));

  renderCart();

  // Atualiza silenciosamente os catálogos de cliente/produto (estoque, novos
  // cadastros) sem perder o carrinho em andamento nem fechar os campos de busca.
  registerAutoRefresh(async () => {
    const [nextClientes, nextProdutos] = await Promise.all([loadClientesAtivos(), loadProdutosAtivos()]);
    clientesOptions = nextClientes;
    produtosOptions = nextProdutos;
    clienteSelect.setOptions(clienteSearchOptions(clientesOptions));
    produtoSelect.setOptions(produtoSearchOptions(produtosOptions, { meta: produtoMetaPrecoEstoque }));
  }, 15000);
}

const HISTORICO_PAGE_SIZE = 50;

async function renderHistorico(content) {
  content.innerHTML = `<div class="card"><div class="table-wrap" id="vendas-table">${'<div class="empty-state">Carregando…</div>'}</div></div><div id="vendas-pagination"></div>`;

  const state = { page: 0 };
  await loadHistorico(content, state);

  registerAutoRefresh(() => loadHistorico(content, state, { silent: true }), 15000);
}

async function loadHistorico(content, state, opts = {}) {
  const { silent = false } = opts;
  const tableWrap = content.querySelector("#vendas-table");
  if (!silent) tableWrap.innerHTML = `<div class="empty-state">Carregando…</div>`;

  const from = state.page * HISTORICO_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("vendas")
    .select("id, numero, data_venda, status, total, forma_pagamento, cliente:clientes(nome)", { count: "exact" })
    .order("numero", { ascending: false })
    .range(from, from + HISTORICO_PAGE_SIZE - 1);

  if (error) {
    tableWrap.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar</p><p class="empty-state__hint">${escapeHtml(friendlyPgError(error))}</p></div>`;
    return;
  }

  if ((!data || data.length === 0) && state.page > 0 && count > 0) {
    state.page = Math.max(0, Math.ceil(count / HISTORICO_PAGE_SIZE) - 1);
    return loadHistorico(content, state, opts);
  }

  if (!data || data.length === 0) {
    tableWrap.innerHTML = `<div class="empty-state"><p class="empty-state__title">Nenhuma venda registrada ainda</p></div>`;
    content.querySelector("#vendas-pagination").innerHTML = "";
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Pagamento</th><th style="text-align:right">Total</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        ${data.map((v) => `
          <tr>
            <td class="cell-num">#${v.numero}</td>
            <td>${formatDate(v.data_venda)}</td>
            <td>${escapeHtml(v.cliente?.nome || "Sem cliente")}</td>
            <td class="cell-muted">${escapeHtml(v.forma_pagamento || "—")}</td>
            <td class="cell-num">${formatCurrency(v.total)}</td>
            <td><span class="status status--${v.status}">${statusLabel(v.status)}</span></td>
            <td class="cell-actions">
              <button type="button" class="btn btn--ghost btn--sm" data-detail="${v.id}">Detalhes</button>
              ${v.status !== "cancelada" ? `<button type="button" class="btn btn--danger btn--sm" data-cancel="${v.id}">Cancelar</button>` : ""}
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => showDetail(btn.dataset.detail));
  });

  tableWrap.querySelectorAll("[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog("Cancelar esta venda? O estoque dos itens será devolvido.", { confirmLabel: "Cancelar venda" });
      if (!ok) return;
      const { error: cancelError } = await supabase.rpc("cancelar_venda", { p_venda_id: btn.dataset.cancel });
      if (cancelError) {
        showToast(friendlyPgError(cancelError), "error");
        return;
      }
      showToast("Venda cancelada e estoque devolvido.");
      loadHistorico(content, state);
    });
  });

  renderHistoricoPagination(content, state, count);
}

function renderHistoricoPagination(content, state, count) {
  const el = content.querySelector("#vendas-pagination");
  const totalPages = Math.max(1, Math.ceil(count / HISTORICO_PAGE_SIZE));

  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="pagination">
      <button type="button" class="btn btn--ghost btn--sm" id="vendas-page-prev" ${state.page === 0 ? "disabled" : ""}>‹ Anterior</button>
      <span class="pagination__label">Página ${state.page + 1} de ${totalPages}</span>
      <button type="button" class="btn btn--ghost btn--sm" id="vendas-page-next" ${state.page >= totalPages - 1 ? "disabled" : ""}>Próxima ›</button>
    </div>
  `;

  el.querySelector("#vendas-page-prev").addEventListener("click", () => {
    state.page = Math.max(0, state.page - 1);
    loadHistorico(content, state);
  });
  el.querySelector("#vendas-page-next").addEventListener("click", () => {
    state.page += 1;
    loadHistorico(content, state);
  });
}

function statusLabel(status) {
  return { confirmada: "Confirmada", orcamento: "Orçamento", cancelada: "Cancelada" }[status] || status;
}

async function showDetail(vendaId) {
  const body = openModal("Detalhes da venda");
  body.innerHTML = `<div class="empty-state">Carregando…</div>`;

  const [{ data: venda }, { data: itens }] = await Promise.all([
    supabase.from("vendas").select("*, cliente:clientes(nome)").eq("id", vendaId).single(),
    supabase.from("venda_itens").select("*, produto:produtos(nome)").eq("venda_id", vendaId),
  ]);

  if (!venda) {
    body.innerHTML = `<div class="empty-state">Venda não encontrada.</div>`;
    return;
  }

  body.innerHTML = `
    <div class="receipt" style="padding: 0;">
      <div class="receipt__row"><span>Nº da venda</span><span>#${venda.numero}</span></div>
      <div class="receipt__row"><span>Data</span><span>${formatDate(venda.data_venda)}</span></div>
      <div class="receipt__row"><span>Cliente</span><span>${escapeHtml(venda.cliente?.nome || "Sem cliente")}</span></div>
      <div class="receipt__row"><span>Pagamento</span><span>${escapeHtml(venda.forma_pagamento || "—")}</span></div>
      <div class="receipt__row"><span>Status</span><span class="status status--${venda.status}">${statusLabel(venda.status)}</span></div>
      ${venda.observacoes ? `<div class="receipt__row"><span>Obs.</span><span>${escapeHtml(venda.observacoes)}</span></div>` : ""}
      <div class="receipt__tear"></div>
      ${(itens || []).map((item) => `
        <div class="receipt__row">
          <span>${item.quantidade}x ${escapeHtml(item.produto?.nome || "Produto")}</span>
          <span>${formatCurrency(item.subtotal)}</span>
        </div>
      `).join("")}
      <div class="receipt__tear"></div>
      <div class="receipt__row"><span>Subtotal</span><span>${formatCurrency(venda.subtotal)}</span></div>
      <div class="receipt__row"><span>Desconto</span><span>${formatCurrency(venda.desconto)}</span></div>
      <div class="receipt__total"><span>Total</span><span>${formatCurrency(venda.total)}</span></div>
      <p class="cell-muted" style="font-size: 0.75rem; margin-top: 1rem;">Registrada em ${formatDateTime(venda.created_at)}</p>
    </div>
  `;
}
