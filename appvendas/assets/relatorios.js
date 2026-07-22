// ERPConnect — Relatórios > Visão geral: antes só olhava a tabela `vendas`
// dos últimos 90 dias fixos. Agora tem filtro de período (como Financeiro/
// Estoques) e o ranking de produtos/clientes soma as três origens de receita
// do app — vendas confirmadas, parcelas de matrícula pagas e recebimentos
// manuais — mesmo racional do Painel Início (home.js).

import { supabase } from "./supabaseClient.js";
import { formatCurrency, formatDate, escapeHtml, registerAutoRefresh, exportCsv } from "./app.js";

const RELATORIO_DIAS_PADRAO = 90;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function diasAtrasStr(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

export async function render(view, actionsEl) {
  const state = { inicio: diasAtrasStr(RELATORIO_DIAS_PADRAO), fim: todayStr(), movimentacoesTodas: [] };

  actionsEl.innerHTML = `<button type="button" class="btn btn--ghost" id="btn-exportar-csv">Exportar CSV</button>`;
  actionsEl.querySelector("#btn-exportar-csv").addEventListener("click", () => {
    exportCsv(
      `relatorio_${state.inicio}_a_${state.fim}.csv`,
      ["Data", "Origem", "Cliente", "Valor"],
      state.movimentacoesTodas.map((l) => [l.data, l.origem, l.cliente, l.valor.toFixed(2).replace(".", ",")]),
    );
  });

  view.innerHTML = `
    <div class="toolbar financeiro-filtro">
      <div class="field financeiro-filtro__field--date">
        <label for="rel-inicio">De</label>
        <input class="input" type="date" id="rel-inicio" value="${state.inicio}" />
      </div>
      <div class="field financeiro-filtro__field--date">
        <label for="rel-fim">Até</label>
        <input class="input" type="date" id="rel-fim" value="${state.fim}" />
      </div>
      <div class="field financeiro-filtro__field--action">
        <label>&nbsp;</label>
        <button type="button" class="btn btn--ghost" id="rel-filtrar">Filtrar</button>
      </div>
    </div>
    <div id="rel-content"><div class="empty-state">Carregando relatórios…</div></div>
  `;

  view.querySelector("#rel-filtrar").addEventListener("click", () => {
    state.inicio = view.querySelector("#rel-inicio").value || state.inicio;
    state.fim = view.querySelector("#rel-fim").value || state.fim;
    load(view, state);
  });

  await load(view, state);

  registerAutoRefresh(() => load(view, state, { silent: true }), 20000);
}

async function load(view, state, opts = {}) {
  const { silent = false } = opts;
  const content = view.querySelector("#rel-content");
  if (!silent) content.innerHTML = `<div class="empty-state">Carregando relatórios…</div>`;

  const [vendasRes, parcelasRes, recebimentosRes, produtosRes] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, numero, total, status, data_venda, cliente_id, cliente:clientes(nome), itens:venda_itens(produto_id, quantidade, subtotal, produto:produtos(nome))")
      .gte("data_venda", state.inicio)
      .lte("data_venda", state.fim),
    supabase
      .from("matricula_parcelas")
      .select("id, numero_parcela, valor, data_pagamento, cliente_id, cliente:clientes(nome), matricula:matriculas(numero, produto:produtos(id, nome))")
      .eq("status", "pago")
      .gte("data_pagamento", state.inicio)
      .lte("data_pagamento", state.fim),
    supabase
      .from("recebimentos")
      .select("id, quantidade, valor, status, data_recebimento, cliente_id, cliente:clientes(nome), produto:produtos(id, nome)")
      .gte("data_recebimento", state.inicio)
      .lte("data_recebimento", state.fim),
    supabase.from("produtos").select("id, nome, estoque, estoque_minimo, tipo").eq("ativo", true),
  ]);

  const firstError = vendasRes.error || parcelasRes.error || recebimentosRes.error || produtosRes.error;
  if (firstError) {
    content.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar relatórios</p><p class="empty-state__hint">${escapeHtml(firstError.message)}</p></div>`;
    return;
  }

  const vendasConfirmadas = (vendasRes.data || []).filter((v) => v.status === "confirmada");
  const parcelasPagas = parcelasRes.data || [];
  const recebimentosOk = (recebimentosRes.data || []).filter((r) => r.status !== "cancelado");

  const transacoes = vendasConfirmadas.length + parcelasPagas.length + recebimentosOk.length;
  const faturamento = sum(vendasConfirmadas, "total") + sum(parcelasPagas, "valor") + sum(recebimentosOk, "valor");
  const ticketMedio = transacoes ? faturamento / transacoes : 0;
  // Serviço não tem estoque físico — nunca some com o produto (ver
  // migration 0017), então nem entra na checagem de estoque baixo.
  const estoqueBaixo = (produtosRes.data || []).filter((p) => p.tipo === "produto" && p.estoque <= p.estoque_minimo);

  const topProdutos = aggregateProdutos([
    ...vendaItemLinhas(vendasConfirmadas),
    ...parcelaProdutoLinhas(parcelasPagas),
    ...recebimentoProdutoLinhas(recebimentosOk),
  ]);

  const topClientes = aggregateClientes([
    ...vendaClienteLinhas(vendasConfirmadas),
    ...parcelaClienteLinhas(parcelasPagas),
    ...recebimentoClienteLinhas(recebimentosOk),
  ]);

  // Exportação CSV usa a lista inteira do período — só a tela mostra as 10
  // mais recentes.
  const movimentacoesTodas = [
    ...vendasConfirmadas.map((v) => ({ data: v.data_venda, origem: `Venda #${v.numero}`, cliente: v.cliente?.nome || "Sem cliente", valor: Number(v.total || 0) })),
    ...parcelasPagas.map((p) => ({ data: p.data_pagamento, origem: `Matrícula #${p.matricula?.numero ?? "?"} · parcela ${p.numero_parcela}`, cliente: p.cliente?.nome || "Sem cliente", valor: Number(p.valor || 0) })),
    ...recebimentosOk.map((r) => ({ data: r.data_recebimento, origem: "Recebimento manual", cliente: r.cliente?.nome || "Sem cliente", valor: Number(r.valor || 0) })),
  ].sort((a, b) => new Date(b.data) - new Date(a.data));
  state.movimentacoesTodas = movimentacoesTodas;
  const movimentacoes = movimentacoesTodas.slice(0, 10);

  content.innerHTML = `
    <p class="record-count" style="margin: 0 0 1rem;">Vendas, matrículas e recebimentos manuais entre ${formatDate(state.inicio)} e ${formatDate(state.fim)}. Estoque reflete a situação atual.</p>
    <div class="stat-grid">
      ${statCard("Transações no período", transacoes, "var(--accent)")}
      ${statCard("Faturamento no período", formatCurrency(faturamento), "var(--accent-deep)")}
      ${statCard("Ticket médio", formatCurrency(ticketMedio), "var(--amber)")}
      ${statCard("Produtos com estoque baixo", estoqueBaixo.length, estoqueBaixo.length > 0 ? "var(--danger)" : "var(--text-muted)")}
    </div>

    <div class="report-grid">
      <div class="card card-section">
        <p class="section-title">Produtos e serviços mais vendidos</p>
        ${renderRankTable(topProdutos, "Produto / serviço", "Qtd.")}
      </div>
      <div class="card card-section">
        <p class="section-title">Melhores clientes</p>
        ${renderRankTable(topClientes, "Cliente", "Transações")}
      </div>
    </div>

    <div class="card card-section">
      <p class="section-title">Estoque baixo</p>
      ${estoqueBaixo.length === 0
        ? '<div class="empty-state" style="padding: 1.5rem;">Nenhum produto abaixo do estoque mínimo.</div>'
        : `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Produto</th><th style="text-align:right">Estoque</th><th style="text-align:right">Mínimo</th></tr></thead>
            <tbody>
              ${estoqueBaixo.map((p) => `<tr><td>${escapeHtml(p.nome)}</td><td class="cell-num" style="color: var(--danger); font-weight:700;">${p.estoque}</td><td class="cell-num">${p.estoque_minimo}</td></tr>`).join("")}
            </tbody>
          </table></div>`
      }
    </div>

    <div class="card card-section">
      <p class="section-title">Últimas movimentações</p>
      ${renderMovimentacoes(movimentacoes)}
    </div>
  `;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

// ── Ranking de produtos/serviços — mesmas 3 origens do Painel Início ────

function vendaItemLinhas(vendas) {
  const linhas = [];
  for (const v of vendas) {
    for (const it of v.itens || []) {
      linhas.push({ produtoId: it.produto_id, produtoNome: it.produto?.nome || "Produto removido", quantidade: Number(it.quantidade || 0), valor: Number(it.subtotal || 0) });
    }
  }
  return linhas;
}

function parcelaProdutoLinhas(parcelas) {
  return parcelas.map((p) => ({
    produtoId: p.matricula?.produto?.id || `matricula-${p.matricula?.numero ?? "sem-produto"}`,
    produtoNome: p.matricula?.produto?.nome || "Serviço (matrícula)",
    quantidade: 1,
    valor: Number(p.valor || 0),
  }));
}

function recebimentoProdutoLinhas(recebimentos) {
  return recebimentos.map((r) => ({
    produtoId: r.produto?.id || "recebimento-sem-produto",
    produtoNome: r.produto?.nome || "Produto",
    quantidade: Number(r.quantidade || 0),
    valor: Number(r.valor || 0),
  }));
}

function aggregateProdutos(linhas) {
  const map = new Map();
  for (const l of linhas) {
    if (!map.has(l.produtoId)) map.set(l.produtoId, { label: l.produtoNome, quantidade: 0, total: 0 });
    const entry = map.get(l.produtoId);
    entry.quantidade += l.quantidade;
    entry.total += l.valor;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 6);
}

// ── Ranking de clientes — quantidade = nº de transações (venda, parcela
// paga ou recebimento), não unidades ────────────────────────────────────

function vendaClienteLinhas(vendas) {
  return vendas.map((v) => ({ clienteId: v.cliente_id || "sem-cliente", clienteNome: v.cliente?.nome || "Sem cliente identificado", valor: Number(v.total || 0) }));
}

function parcelaClienteLinhas(parcelas) {
  return parcelas.map((p) => ({ clienteId: p.cliente_id || "sem-cliente", clienteNome: p.cliente?.nome || "Sem cliente identificado", valor: Number(p.valor || 0) }));
}

function recebimentoClienteLinhas(recebimentos) {
  return recebimentos.map((r) => ({ clienteId: r.cliente_id || "sem-cliente", clienteNome: r.cliente?.nome || "Sem cliente identificado", valor: Number(r.valor || 0) }));
}

function aggregateClientes(linhas) {
  const map = new Map();
  for (const l of linhas) {
    if (!map.has(l.clienteId)) map.set(l.clienteId, { label: l.clienteNome, quantidade: 0, total: 0 });
    const entry = map.get(l.clienteId);
    entry.quantidade += 1;
    entry.total += l.valor;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 6);
}

function statCard(label, value, tagColor) {
  return `
    <div class="card stat-card" style="--tag-color:${tagColor}">
      <p class="stat-card__label">${escapeHtml(label)}</p>
      <p class="stat-card__value">${value}</p>
    </div>
  `;
}

function renderRankTable(rows, labelHeader, qtyHeader) {
  if (rows.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Sem dados suficientes ainda.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>${escapeHtml(labelHeader)}</th><th style="text-align:right">${escapeHtml(qtyHeader)}</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="cell-num">${r.quantidade}</td><td class="cell-num">${formatCurrency(r.total)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMovimentacoes(linhas) {
  if (linhas.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhuma movimentação neste período.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Data</th><th>Origem</th><th>Cliente</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>
          ${linhas.map((l) => `
            <tr>
              <td>${formatDate(l.data)}</td>
              <td>${escapeHtml(l.origem)}</td>
              <td>${escapeHtml(l.cliente)}</td>
              <td class="cell-num">${formatCurrency(l.valor)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
