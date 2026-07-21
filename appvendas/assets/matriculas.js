// BjjConnect — Movimentações > Matrículas: contratação de um curso/serviço
// por um cliente, com parcelamento. Mesma UX de pagamento da Loja (vendas) —
// tiles de forma de pagamento + fluxo Stripe (QR/link) — mas sem carrinho:
// aqui é sempre um cliente + um curso. Ver supabase/migrations/0015 para o
// racional completo de como as parcelas viram títulos a receber.
//
// Pagamento parcelado + Stripe: o Stripe cobra só a 1ª parcela agora (uma
// Checkout Session é cobrança única, não assinatura recorrente); as demais
// nascem como títulos a receber com vencimento futuro e são recebidas
// manualmente no balcão (ver "Registrar pagamento" no detalhe da matrícula).

import { supabase } from "./supabaseClient.js";
import { showToast, openModal, closeModal, confirmDialog, formatCurrency, formatDate, escapeHtml, createSearchSelect, registerAutoRefresh, consumeMatriculaPrefill, withButtonLock, friendlyPgError } from "./app.js";
import { isAdmin } from "./auth.js";
import { loadClientesAtivos, loadProdutosServicos, loadEmpresasAtivas, clienteSearchOptions, produtoSearchOptions, empresaSearchOptions, produtoMetaPreco } from "./catalogo.js";
import { FORMAS_PAGAMENTO, paytilesHtml, mountPaytiles, chamarCriarCheckoutStripe, mostrarModalStripe } from "./pagamento.js";

let clientesOptions = [];
let produtosOptions = [];
let empresasOptions = [];
// Id do agendamento que originou a matrícula em andamento (fluxo Agenda →
// Matrículas, via setMatriculaPrefill/consumeMatriculaPrefill em app.js).
// Null numa matrícula avulsa.
let agendamentoOrigemId = null;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function render(view, actionsEl) {
  actionsEl.innerHTML = "";
  agendamentoOrigemId = null;

  view.innerHTML = `
    <div class="toolbar" style="margin-bottom: 1.25rem;">
      <div style="display:flex; gap:0.5rem;">
        <button type="button" class="btn btn--primary" id="tab-nova">Nova matrícula</button>
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
    if (tab === "nova") renderNovaMatricula(content);
    else renderHistorico(content);
  }

  tabNova.addEventListener("click", () => activate("nova"));
  tabHistorico.addEventListener("click", () => activate("historico"));

  [clientesOptions, produtosOptions, empresasOptions] = await Promise.all([loadClientesAtivos(), loadProdutosServicos(), loadEmpresasAtivas()]);

  activate("nova");
}

function renderNovaMatricula(content) {
  const prefill = consumeMatriculaPrefill();
  agendamentoOrigemId = prefill?.agendamentoId || null;
  const admin = isAdmin();

  content.innerHTML = `
    <div class="venda-layout">
      <div class="card card-section venda-itens">
        ${prefill ? `
          <div class="form-info">
            Confirmando atendimento de ${escapeHtml(prefill.clienteNome || "cliente sem cadastro")} em ${formatDate(prefill.dataAgendamento)} às ${prefill.horario}. Revise os dados e finalize para registrar a matrícula.
          </div>
        ` : ""}
        ${admin ? `
          <div class="field">
            <label>Empresa<span class="field-required">*</span></label>
            <div data-mount="m-empresa"></div>
          </div>
        ` : ""}
        <div class="venda-meta">
          <div class="field" style="flex: 1 1 auto; min-width: 0;">
            <label>Cliente<span class="field-required">*</span></label>
            <div data-mount="m-cliente"></div>
          </div>
          <div class="field venda-meta__data">
            <label for="m-data">Data da matrícula</label>
            <input class="input" type="date" id="m-data" value="${todayStr()}" />
          </div>
        </div>

        <div class="field">
          <label>Curso / Serviço<span class="field-required">*</span></label>
          <div data-mount="m-produto"></div>
        </div>

        <div class="form-grid" style="grid-template-columns: 1fr 1fr;">
          <div class="field">
            <label for="m-meses">Duração do curso (meses) <span class="field-optional">informativo</span></label>
            <input class="input" type="number" id="m-meses" min="1" step="1" value="1" />
          </div>
          <div class="field">
            <label for="m-parcelas">Número de parcelas<span class="field-required">*</span></label>
            <input class="input" type="number" id="m-parcelas" min="1" step="1" value="1" />
          </div>
        </div>
        <p class="field-hint" style="margin-top: -0.6rem;">A duração não afeta o valor cobrado — é só um registro de quanto tempo dura o curso. Quem define o valor é o preço do curso/serviço escolhido acima, dividido entre as parcelas. A 1ª parcela é paga agora, na forma de pagamento escolhida ao lado; as demais viram títulos a receber com vencimento mensal, cobrados no balcão conforme o aluno for pagando.</p>

        <button type="button" class="venda-obs-toggle" id="m-obs-toggle">+ Adicionar observação</button>
        <div class="field venda-obs" id="m-obs-field" hidden>
          <label for="m-obs">Observações</label>
          <textarea class="input" id="m-obs" rows="2"></textarea>
        </div>
      </div>

      <div class="card receipt">
        <p class="section-title">Fechamento</p>

        <p class="receipt__label">Forma de pagamento</p>
        <div class="paytiles" id="m-forma" role="radiogroup" aria-label="Forma de pagamento">
          ${paytilesHtml()}
        </div>

        <div class="receipt__tear"></div>
        <div class="receipt__row"><span>Valor do curso/serviço</span><span id="r-mensalidade">${formatCurrency(0)}</span></div>
        <div class="receipt__row">
          <span>Desconto</span>
          <input class="input" type="number" id="m-desconto" min="0" step="0.01" value="0" style="width: 110px; text-align:right; font-family: var(--font-mono);" />
        </div>
        <div class="receipt__tear"></div>
        <div class="receipt__total"><span>Total</span><span id="r-total">${formatCurrency(0)}</span></div>
        <p class="cell-muted" id="r-parcelas-info" style="margin-top: 0.5rem;">1x de ${formatCurrency(0)}</p>
        <button type="button" class="btn btn--primary" id="m-finalizar" style="width:100%; justify-content:center; margin-top: 1.25rem;">Finalizar matrícula</button>
        <div id="m-error"></div>
      </div>
    </div>
  `;

  const paytiles = mountPaytiles(content.querySelector("#m-forma"));
  const descontoInput = content.querySelector("#m-desconto");
  const mesesInput = content.querySelector("#m-meses");
  const parcelasInput = content.querySelector("#m-parcelas");

  const obsToggle = content.querySelector("#m-obs-toggle");
  const obsField = content.querySelector("#m-obs-field");
  const obsInput = content.querySelector("#m-obs");
  obsToggle.addEventListener("click", () => {
    obsField.hidden = false;
    obsToggle.hidden = true;
    obsInput.focus();
  });

  if (prefill) {
    obsField.hidden = false;
    obsToggle.hidden = true;
    obsInput.value = `Matrícula referente ao atendimento agendado em ${formatDate(prefill.dataAgendamento)} às ${prefill.horario}.${prefill.observacoes ? ` Obs. do agendamento: ${prefill.observacoes}` : ""}`;
  }

  const empresaSelect = admin
    ? createSearchSelect({
        container: content.querySelector('[data-mount="m-empresa"]'),
        placeholder: "Buscar empresa…",
        options: empresaSearchOptions(empresasOptions),
        allowClear: false,
      })
    : null;

  const clienteSelect = createSearchSelect({
    container: content.querySelector('[data-mount="m-cliente"]'),
    placeholder: "Buscar cliente por nome ou documento…",
    options: clienteSearchOptions(clientesOptions),
    value: prefill?.clienteId || null,
    allowClear: false,
  });

  const produtoSelect = createSearchSelect({
    container: content.querySelector('[data-mount="m-produto"]'),
    placeholder: "Buscar curso/serviço por nome ou SKU…",
    options: produtoSearchOptions(produtosOptions, { meta: produtoMetaPreco }),
    value: prefill?.produtoId || null,
    allowClear: false,
    onChange: () => updateTotals(),
  });

  if (prefill?.produtoId && !produtosOptions.some((p) => p.id === prefill.produtoId)) {
    showToast("Curso/serviço do atendimento não encontrado no catálogo de Matrículas.", "error");
  }

  // Duração (meses) é só um campo informativo — não entra nesta conta.
  // Quem define o valor é o preço do produto (curso/serviço), ver
  // criar_matricula.
  function updateTotals() {
    const produto = produtosOptions.find((p) => p.id === produtoSelect.getValue());
    const valorServico = produto ? Number(produto.preco || 0) : 0;
    const parcelas = Math.max(Number(parcelasInput.value || 0), 1);
    const desconto = Number(descontoInput.value || 0);
    const total = Math.max(valorServico - desconto, 0);
    const valorParcela = total / parcelas;

    content.querySelector("#r-mensalidade").textContent = formatCurrency(valorServico);
    content.querySelector("#r-total").textContent = formatCurrency(total);
    // Cálculo em tela é aproximado (só pra guiar o operador) — o servidor
    // recalcula com arredondamento exato e ajusta a última parcela, ver
    // criar_matricula.
    content.querySelector("#r-parcelas-info").textContent = `${parcelas}x de ${formatCurrency(valorParcela)} (aprox.)`;
  }

  parcelasInput.addEventListener("input", updateTotals);
  descontoInput.addEventListener("input", updateTotals);
  updateTotals();

  content.querySelector("#m-finalizar").addEventListener("click", (e) => withButtonLock(e.currentTarget, async () => {
    const errorEl = content.querySelector("#m-error");
    errorEl.innerHTML = "";

    const clienteId = clienteSelect.getValue();
    if (!clienteId) {
      errorEl.innerHTML = `<div class="form-error">Selecione um cliente.</div>`;
      return;
    }

    const produtoId = produtoSelect.getValue();
    if (!produtoId) {
      errorEl.innerHTML = `<div class="form-error">Selecione um curso/serviço.</div>`;
      return;
    }

    const meses = Number(mesesInput.value || 0);
    if (meses <= 0) {
      errorEl.innerHTML = `<div class="form-error">Informe a duração do curso em meses.</div>`;
      return;
    }

    const parcelas = Number(parcelasInput.value || 0);
    if (parcelas <= 0) {
      errorEl.innerHTML = `<div class="form-error">Informe o número de parcelas.</div>`;
      return;
    }

    if (admin && !empresaSelect.getValue()) {
      errorEl.innerHTML = `<div class="form-error">Selecione uma empresa.</div>`;
      return;
    }

    const payload = {
      p_cliente_id: clienteId,
      p_produto_id: produtoId,
      p_meses: meses,
      p_numero_parcelas: parcelas,
      p_data_matricula: content.querySelector("#m-data").value || null,
      p_desconto: Number(descontoInput.value || 0),
      p_observacoes: content.querySelector("#m-obs").value || null,
    };
    if (admin) payload.p_empresa_id = empresaSelect.getValue();

    const formaPagamento = paytiles.getValue();

    if (formaPagamento === "Stripe") {
      await iniciarPagamentoStripe(payload, errorEl);
      return;
    }

    const { error } = await supabase.rpc("criar_matricula", { ...payload, p_forma_pagamento: formaPagamento });

    if (error) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(friendlyPgError(error))}</div>`;
      return;
    }

    await finalizarComSucesso();
  }));

  async function finalizarComSucesso(mensagemBase = "Matrícula registrada com sucesso.") {
    if (agendamentoOrigemId) {
      const { error: agError } = await supabase.from("agendamentos").update({ status: "atendido" }).eq("id", agendamentoOrigemId);
      showToast(agError ? "Matrícula registrada, mas não foi possível confirmar o atendimento na agenda." : "Matrícula registrada e atendimento confirmado.", agError ? "error" : "success");
    } else {
      showToast(mensagemBase);
    }

    agendamentoOrigemId = null;
    produtosOptions = await loadProdutosServicos();
    renderNovaMatricula(content);
  }

  async function iniciarPagamentoStripe(payload, errorEl) {
    // Base do próprio index.html do appvendas (funciona local ou em qualquer
    // domínio de deploy) — as páginas de retorno vivem ao lado dele.
    const baseUrl = new URL(".", window.location.href).href;

    let data;
    try {
      data = await chamarCriarCheckoutStripe({
        ...payload,
        p_tipo: "matricula",
        success_url: `${baseUrl}pagamento-confirmado.html`,
        cancel_url: `${baseUrl}pagamento-cancelado.html`,
      });
    } catch (err) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(err.message)}</div>`;
      return;
    }

    await mostrarModalStripe({
      title: `Pagamento via Stripe — Matrícula #${data.numero}`,
      id: data.matricula_id,
      table: "matriculas",
      successStatus: "ativa",
      checkoutUrl: data.url,
      onConfirmada: () => finalizarComSucesso("Pagamento confirmado. Matrícula registrada."),
    });
  }

  // Atualiza silenciosamente os catálogos de cliente/curso (novos cadastros)
  // sem perder o que já foi preenchido no formulário nem fechar os campos
  // de busca.
  registerAutoRefresh(async () => {
    const [nextClientes, nextProdutos] = await Promise.all([loadClientesAtivos(), loadProdutosServicos()]);
    clientesOptions = nextClientes;
    produtosOptions = nextProdutos;
    clienteSelect.setOptions(clienteSearchOptions(clientesOptions));
    produtoSelect.setOptions(produtoSearchOptions(produtosOptions, { meta: produtoMetaPreco }));
  }, 15000);
}

const HISTORICO_PAGE_SIZE = 50;

async function renderHistorico(content) {
  content.innerHTML = `<div class="card"><div class="table-wrap" id="matriculas-table">${'<div class="empty-state">Carregando…</div>'}</div></div><div id="matriculas-pagination"></div>`;

  const state = { page: 0 };
  await loadHistorico(content, state);

  registerAutoRefresh(() => loadHistorico(content, state, { silent: true }), 15000);
}

async function loadHistorico(content, state, opts = {}) {
  const { silent = false } = opts;
  const tableWrap = content.querySelector("#matriculas-table");
  if (!silent) tableWrap.innerHTML = `<div class="empty-state">Carregando…</div>`;

  const from = state.page * HISTORICO_PAGE_SIZE;
  const { data, error, count } = await supabase
    .from("matriculas")
    .select("id, numero, data_matricula, status, valor_total, meses, numero_parcelas, forma_pagamento, cliente:clientes(nome), produto:produtos(nome)", { count: "exact" })
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
    tableWrap.innerHTML = `<div class="empty-state"><p class="empty-state__title">Nenhuma matrícula registrada ainda</p></div>`;
    content.querySelector("#matriculas-pagination").innerHTML = "";
    return;
  }

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Curso</th><th>Parcelas</th><th style="text-align:right">Valor total</th><th>Status</th><th></th></tr>
      </thead>
      <tbody>
        ${data.map((m) => `
          <tr>
            <td class="cell-num">#${m.numero}</td>
            <td>${formatDate(m.data_matricula)}</td>
            <td>${escapeHtml(m.cliente?.nome || "—")}</td>
            <td>${escapeHtml(m.produto?.nome || "—")}</td>
            <td class="cell-num">${m.numero_parcelas}x</td>
            <td class="cell-num">${formatCurrency(m.valor_total)}</td>
            <td><span class="status status--${matriculaStatusClass(m.status)}">${matriculaStatusLabel(m.status)}</span></td>
            <td class="cell-actions">
              <button type="button" class="btn btn--ghost btn--sm" data-detail="${m.id}">Detalhes</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  tableWrap.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => showDetail(btn.dataset.detail, () => loadHistorico(content, state, { silent: true })));
  });

  renderHistoricoPagination(content, state, count);
}

function renderHistoricoPagination(content, state, count) {
  const el = content.querySelector("#matriculas-pagination");
  const totalPages = Math.max(1, Math.ceil(count / HISTORICO_PAGE_SIZE));

  if (totalPages <= 1) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = `
    <div class="pagination">
      <button type="button" class="btn btn--ghost btn--sm" id="matriculas-page-prev" ${state.page === 0 ? "disabled" : ""}>‹ Anterior</button>
      <span class="pagination__label">Página ${state.page + 1} de ${totalPages}</span>
      <button type="button" class="btn btn--ghost btn--sm" id="matriculas-page-next" ${state.page >= totalPages - 1 ? "disabled" : ""}>Próxima ›</button>
    </div>
  `;

  el.querySelector("#matriculas-page-prev").addEventListener("click", () => {
    state.page = Math.max(0, state.page - 1);
    loadHistorico(content, state);
  });
  el.querySelector("#matriculas-page-next").addEventListener("click", () => {
    state.page += 1;
    loadHistorico(content, state);
  });
}

function matriculaStatusClass(status) {
  return { ativa: "confirmada", cancelada: "cancelada", aguardando_pagamento: "aguardando_pagamento" }[status] || status;
}

function matriculaStatusLabel(status) {
  return { ativa: "Ativa", cancelada: "Cancelada", aguardando_pagamento: "Aguardando pagamento" }[status] || status;
}

function parcelaStatusClass(status) {
  return { pago: "confirmada", cancelado: "cancelada", pendente: "pendente" }[status] || status;
}

function parcelaStatusLabel(status) {
  return { pago: "Pago", cancelado: "Cancelado", pendente: "Pendente" }[status] || status;
}

// ── Detalhe da matrícula: dados + parcelas (títulos a receber), com ação de
// registrar pagamento por parcela e cancelar a matrícula inteira.
async function showDetail(matriculaId, onChange) {
  const body = openModal("Detalhes da matrícula");
  body.innerHTML = `<div class="empty-state">Carregando…</div>`;

  const [{ data: matricula, error: matriculaError }, { data: parcelasData }] = await Promise.all([
    supabase.from("matriculas").select("*, cliente:clientes(nome), produto:produtos(nome)").eq("id", matriculaId).single(),
    supabase.from("matricula_parcelas").select("*").eq("matricula_id", matriculaId).order("numero_parcela", { ascending: true }),
  ]);

  if (!matricula) {
    body.innerHTML = matriculaError
      ? `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar a matrícula</p><p class="empty-state__hint">${escapeHtml(friendlyPgError(matriculaError))}</p></div>`
      : `<div class="empty-state">Matrícula não encontrada.</div>`;
    return;
  }

  const parcelas = parcelasData || [];

  function renderBody() {
    body.innerHTML = `
      <div class="receipt" style="padding: 0;">
        <div class="receipt__row"><span>Nº da matrícula</span><span>#${matricula.numero}</span></div>
        <div class="receipt__row"><span>Data</span><span>${formatDate(matricula.data_matricula)}</span></div>
        <div class="receipt__row"><span>Cliente</span><span>${escapeHtml(matricula.cliente?.nome || "—")}</span></div>
        <div class="receipt__row"><span>Curso</span><span>${escapeHtml(matricula.produto?.nome || "—")}</span></div>
        <div class="receipt__row"><span>Duração <span class="cell-muted">(informativo)</span></span><span>${matricula.meses} ${matricula.meses === 1 ? "mês" : "meses"}</span></div>
        <div class="receipt__row"><span>Status</span><span class="status status--${matriculaStatusClass(matricula.status)}">${matriculaStatusLabel(matricula.status)}</span></div>
        ${matricula.observacoes ? `<div class="receipt__row"><span>Obs.</span><span>${escapeHtml(matricula.observacoes)}</span></div>` : ""}
        <div class="receipt__tear"></div>
        <div class="receipt__row"><span>Valor do curso/serviço</span><span>${formatCurrency(matricula.valor_servico)}</span></div>
        <div class="receipt__row"><span>Desconto</span><span>${formatCurrency(matricula.desconto)}</span></div>
        <div class="receipt__total"><span>Total</span><span>${formatCurrency(matricula.valor_total)}</span></div>
      </div>

      <p class="section-title" style="margin-top: 1.25rem;">Parcelas (títulos a receber)</p>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Parcela</th><th>Vencimento</th><th style="text-align:right">Valor</th><th>Pagamento</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            ${parcelas.map((p) => `
              <tr>
                <td>${p.numero_parcela}/${matricula.numero_parcelas}</td>
                <td>${formatDate(p.data_vencimento)}</td>
                <td class="cell-num">${formatCurrency(p.valor)}</td>
                <td class="cell-muted">${escapeHtml(p.forma_pagamento || "—")}</td>
                <td><span class="status status--${parcelaStatusClass(p.status)}">${parcelaStatusLabel(p.status)}</span></td>
                <td class="cell-actions">
                  ${p.status === "pendente" && matricula.status === "ativa" ? `<button type="button" class="btn btn--primary btn--sm" data-pagar="${p.id}">Registrar pagamento</button>` : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

      ${matricula.status !== "cancelada" ? `
        <div class="form-actions">
          <button type="button" class="btn btn--danger" id="md-cancelar">Cancelar matrícula</button>
        </div>
      ` : ""}
    `;

    body.querySelectorAll("[data-pagar]").forEach((btn) => {
      btn.addEventListener("click", () => {
        openPagamentoParcelaForm(btn.dataset.pagar, async () => {
          const { data: novasParcelas, error } = await supabase
            .from("matricula_parcelas")
            .select("*")
            .eq("matricula_id", matriculaId)
            .order("numero_parcela", { ascending: true });
          if (error) showToast(friendlyPgError(error), "error");
          parcelas.length = 0;
          parcelas.push(...(novasParcelas || []));
          renderBody();
          if (onChange) onChange();
        });
      });
    });

    const cancelarBtn = body.querySelector("#md-cancelar");
    if (cancelarBtn) {
      cancelarBtn.addEventListener("click", async () => {
        const ok = await confirmDialog("Cancelar esta matrícula? As parcelas ainda pendentes serão canceladas — as já pagas ficam registradas.", { confirmLabel: "Cancelar matrícula" });
        if (!ok) return;
        const { error } = await supabase.rpc("cancelar_matricula", { p_matricula_id: matriculaId });
        if (error) {
          showToast(friendlyPgError(error), "error");
          return;
        }
        showToast("Matrícula cancelada.");
        closeModal();
        if (onChange) onChange();
      });
    }
  }

  renderBody();
}

// ── Modal de registrar pagamento de uma parcela — Stripe fica de fora aqui:
// cobrar via Stripe exige o fluxo de Checkout Session (QR/link), não faz
// sentido como uma opção de um <select> de baixa manual. Exportado: também
// usado em financeiro.js (Contas a Receber lista as parcelas pendentes de
// matrícula ao lado de vendas/recebimentos manuais).
export function openPagamentoParcelaForm(parcelaId, onSaved) {
  const body = openModal("Registrar pagamento da parcela");

  body.innerHTML = `
    <form id="mp-form">
      <div id="mp-form-error"></div>
      <div class="form-grid">
        <div class="field">
          <label for="mp-data">Data do pagamento<span class="field-required">*</span></label>
          <input class="input" type="date" id="mp-data" value="${todayStr()}" required />
        </div>
        <div class="field">
          <label for="mp-forma">Forma de pagamento</label>
          <select class="input" id="mp-forma">
            <option value="">—</option>
            ${FORMAS_PAGAMENTO.filter((f) => f.label !== "Stripe").map((f) => `<option value="${escapeHtml(f.label)}">${escapeHtml(f.label)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="mp-cancel">Cancelar</button>
        <button type="submit" class="btn btn--primary">Confirmar pagamento</button>
      </div>
    </form>
  `;

  body.querySelector("#mp-cancel").addEventListener("click", closeModal);

  body.querySelector("#mp-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withButtonLock(body.querySelector('#mp-form button[type="submit"]'), async () => {
      const errorEl = body.querySelector("#mp-form-error");
      errorEl.innerHTML = "";

      const { error } = await supabase.rpc("registrar_pagamento_parcela_matricula", {
        p_parcela_id: parcelaId,
        p_data_pagamento: body.querySelector("#mp-data").value || null,
        p_forma_pagamento: body.querySelector("#mp-forma").value || null,
      });

      if (error) {
        errorEl.innerHTML = `<div class="form-error">${escapeHtml(friendlyPgError(error))}</div>`;
        return;
      }

      showToast("Pagamento da parcela registrado.");
      closeModal();
      if (onSaved) onSaved();
    });
  });
}
