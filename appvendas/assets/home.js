// BjjConnect — Início > Painel do dia: visão financeira consolidada da
// empresa. Antes só olhava a tabela `vendas`; agora soma toda entrada
// (vendas confirmadas, parcelas de matrícula pagas, recebimentos manuais) e
// toda saída (contas a pagar já pagas), e cruza produtos + serviços vendidos
// num único ranking — este é o painel que dá o resumo do "como estamos
// indo", os detalhes por origem continuam nas telas específicas (Loja,
// Matrículas, Financeiro).

import { supabase } from "./supabaseClient.js";
import { formatCurrency, formatDate, escapeHtml, registerAutoRefresh } from "./app.js";
import { getCurrentEmpresaId } from "./auth.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfMonthStr() {
  return `${todayStr().slice(0, 7)}-01`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

export async function render(view, actionsEl) {
  actionsEl.innerHTML = "";
  await load(view);
  registerAutoRefresh(() => load(view, { silent: true }), 20000);
}

async function load(view, opts = {}) {
  const { silent = false } = opts;
  if (!silent) view.innerHTML = `<div class="empty-state">Carregando painel…</div>`;

  const hoje = todayStr();
  const mesInicio = firstDayOfMonthStr();
  const empresaId = getCurrentEmpresaId();

  const [vendasRes, parcelasRes, recebimentosRes, contasPagarRes, produtosRes, empresaRes] = await Promise.all([
    supabase
      .from("vendas")
      .select("id, numero, total, status, data_venda, cliente:clientes(nome), itens:venda_itens(produto_id, quantidade, subtotal, produto:produtos(nome))")
      .gte("data_venda", mesInicio),
    // Entrada de matrícula é o pagamento de cada parcela, não a data da
    // matrícula em si — uma parcela paga este mês pode ser de uma matrícula
    // feita há vários meses (ver financeiro.js, mesmo racional).
    supabase
      .from("matricula_parcelas")
      .select("id, numero_parcela, valor, data_pagamento, cliente:clientes(nome), matricula:matriculas(numero, produto:produtos(id, nome))")
      .eq("status", "pago")
      .gte("data_pagamento", mesInicio),
    supabase
      .from("recebimentos")
      .select("id, quantidade, valor, status, data_recebimento, cliente:clientes(nome), produto:produtos(id, nome)")
      .gte("data_recebimento", mesInicio),
    supabase
      .from("contas_pagar")
      .select("id, descricao, valor, data_pagamento, fornecedor:fornecedores(nome)")
      .eq("status", "pago")
      .gte("data_pagamento", mesInicio),
    supabase.from("produtos").select("id, nome, estoque, estoque_minimo").eq("ativo", true),
    empresaId
      ? supabase.from("empresas").select("nome_fantasia").eq("id", empresaId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const firstError = vendasRes.error || parcelasRes.error || recebimentosRes.error || contasPagarRes.error || produtosRes.error;
  if (firstError) {
    view.innerHTML = `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar o painel</p><p class="empty-state__hint">${escapeHtml(firstError.message)}</p></div>`;
    return;
  }

  const vendasConfirmadas = (vendasRes.data || []).filter((v) => v.status === "confirmada");
  const vendasHoje = vendasConfirmadas.filter((v) => v.data_venda === hoje);

  const parcelasPagas = parcelasRes.data || [];
  const parcelasHoje = parcelasPagas.filter((p) => p.data_pagamento === hoje);

  const recebimentosOk = (recebimentosRes.data || []).filter((r) => r.status !== "cancelado");
  const recebimentosHoje = recebimentosOk.filter((r) => r.data_recebimento === hoje);

  const contasPagas = contasPagarRes.data || [];
  const contasPagasHoje = contasPagas.filter((c) => c.data_pagamento === hoje);

  const entradasHoje = sum(vendasHoje, "total") + sum(parcelasHoje, "valor") + sum(recebimentosHoje, "valor");
  const entradasMes = sum(vendasConfirmadas, "total") + sum(parcelasPagas, "valor") + sum(recebimentosOk, "valor");
  const saidasHoje = sum(contasPagasHoje, "valor");
  const saidasMes = sum(contasPagas, "valor");
  const saldoMes = entradasMes - saidasMes;

  const estoqueBaixo = (produtosRes.data || []).filter((p) => p.estoque <= p.estoque_minimo).sort((a, b) => a.estoque - b.estoque);
  const nomeFantasia = empresaRes?.data?.nome_fantasia || "";

  const topProdutosServicos = aggregateProdutos([
    ...vendaItemLinhas(vendasConfirmadas),
    ...parcelaLinhas(parcelasPagas),
    ...recebimentoLinhas(recebimentosOk),
  ]);

  const linhasMovimentacoes = movimentacoes(vendasConfirmadas, parcelasPagas, recebimentosOk, contasPagas);

  view.innerHTML = `
    <div class="home-hero">
      <p class="home-hero__eyebrow">${greeting()}, equipe comercial</p>
      <h2 class="home-hero__title">${formatFullDate(hoje)}</h2>
      ${nomeFantasia ? `<p class="home-hero__empresa">${escapeHtml(nomeFantasia)}</p>` : ""}
    </div>

    <div class="quick-actions">
      <a class="quick-action" href="#/vendas">
        <span class="quick-action__title">+ Nova venda</span>
        <span class="quick-action__hint">Registrar uma venda no caixa</span>
      </a>
      <a class="quick-action" href="#/matriculas">
        <span class="quick-action__title">+ Nova matrícula</span>
        <span class="quick-action__hint">Contratar um curso ou serviço</span>
      </a>
      <a class="quick-action" href="#/clientes">
        <span class="quick-action__title">Clientes</span>
        <span class="quick-action__hint">Consultar ou cadastrar clientes</span>
      </a>
      <a class="quick-action" href="#/relatorios">
        <span class="quick-action__title">Relatórios completos</span>
        <span class="quick-action__hint">Ranking de produtos e clientes</span>
      </a>
    </div>

    <p class="record-count" style="margin: 0 0 0.4rem;">Hoje: ${formatCurrency(entradasHoje)} em entradas${saidasHoje > 0 ? ` · ${formatCurrency(saidasHoje)} em saídas` : ""}. Totais abaixo somam vendas, matrículas, recebimentos manuais e contas a pagar do mês.</p>
    <div class="stat-grid">
      ${statCard("Entradas do mês", formatCurrency(entradasMes), "var(--accent-deep)")}
      ${statCard("Saídas do mês", formatCurrency(saidasMes), "var(--danger)")}
      ${statCard("Saldo do mês", formatCurrency(saldoMes), saldoMes >= 0 ? "var(--accent)" : "var(--danger)")}
      ${statCard("Produtos com estoque baixo", estoqueBaixo.length, estoqueBaixo.length > 0 ? "var(--amber)" : "var(--text-muted)")}
    </div>

    <div class="report-grid">
      <div class="card card-section">
        <p class="section-title">Produtos e serviços mais vendidos (mês)</p>
        ${renderRankTable(topProdutosServicos)}
      </div>
      <div class="card card-section">
        <p class="section-title">Estoque baixo</p>
        ${renderEstoqueBaixo(estoqueBaixo)}
      </div>
    </div>

    <div class="card card-section">
      <p class="section-title">Últimas movimentações</p>
      ${renderMovimentacoes(linhasMovimentacoes)}
    </div>
  `;
}

// ── Ranking "produtos e serviços vendidos" — junta 3 origens diferentes
// (item de venda física, parcela de matrícula paga, recebimento manual) num
// único ranking por produto/serviço, pela chave do produto.

function vendaItemLinhas(vendas) {
  const linhas = [];
  for (const v of vendas) {
    for (const it of v.itens || []) {
      linhas.push({
        produtoId: it.produto_id,
        produtoNome: it.produto?.nome || "Produto removido",
        quantidade: Number(it.quantidade || 0),
        valor: Number(it.subtotal || 0),
      });
    }
  }
  return linhas;
}

function parcelaLinhas(parcelas) {
  return parcelas.map((p) => ({
    produtoId: p.matricula?.produto?.id || `matricula-${p.matricula?.numero ?? "sem-produto"}`,
    produtoNome: p.matricula?.produto?.nome || "Serviço (matrícula)",
    quantidade: 1,
    valor: Number(p.valor || 0),
  }));
}

function recebimentoLinhas(recebimentos) {
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

// ── Extrato unificado "Últimas movimentações" — entradas (venda, matrícula,
// recebimento manual) e saídas (conta a pagar paga) numa linha do tempo só.

function movimentacoes(vendas, parcelas, recebimentos, contasPagar) {
  const linhas = [
    ...vendas.map((v) => ({
      data: v.data_venda,
      tipo: "entrada",
      origem: `Venda #${v.numero}`,
      quem: v.cliente?.nome || "Sem cliente",
      valor: Number(v.total || 0),
    })),
    ...parcelas.map((p) => ({
      data: p.data_pagamento,
      tipo: "entrada",
      origem: `Matrícula #${p.matricula?.numero ?? "?"} · parcela ${p.numero_parcela}`,
      quem: p.cliente?.nome || "Sem cliente",
      valor: Number(p.valor || 0),
    })),
    ...recebimentos.map((r) => ({
      data: r.data_recebimento,
      tipo: "entrada",
      origem: "Recebimento manual",
      quem: r.cliente?.nome || "Sem cliente",
      valor: Number(r.valor || 0),
    })),
    ...contasPagar.map((c) => ({
      data: c.data_pagamento,
      tipo: "saida",
      origem: c.descricao || "Conta a pagar",
      quem: c.fornecedor?.nome || "—",
      valor: Number(c.valor || 0),
    })),
  ];
  return linhas.sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, 8);
}

function statCard(label, value, tagColor) {
  return `
    <div class="card stat-card" style="--tag-color:${tagColor}">
      <p class="stat-card__label">${escapeHtml(label)}</p>
      <p class="stat-card__value">${value}</p>
    </div>
  `;
}

function formatFullDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  const text = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderRankTable(rows) {
  if (rows.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nada vendido ainda este mês.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Produto / serviço</th><th style="text-align:right">Qtd.</th><th style="text-align:right">Total</th></tr></thead>
        <tbody>
          ${rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="cell-num">${r.quantidade}</td><td class="cell-num">${formatCurrency(r.total)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMovimentacoes(linhas) {
  if (linhas.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhuma movimentação neste mês.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Data</th><th>Tipo</th><th>Origem</th><th>Quem</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>
          ${linhas.map((l) => `
            <tr>
              <td>${formatDate(l.data)}</td>
              <td><span class="status status--${l.tipo}">${l.tipo === "entrada" ? "Entrada" : "Saída"}</span></td>
              <td>${escapeHtml(l.origem)}</td>
              <td>${escapeHtml(l.quem)}</td>
              <td class="cell-num" style="color: ${l.tipo === "entrada" ? "var(--accent-deep)" : "var(--danger-deep)"}; font-weight:600;">${l.tipo === "entrada" ? "+" : "−"} ${formatCurrency(l.valor)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderEstoqueBaixo(estoqueBaixo) {
  if (estoqueBaixo.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhum produto abaixo do estoque mínimo.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Produto</th><th style="text-align:right">Estoque</th><th style="text-align:right">Mínimo</th></tr></thead>
        <tbody>
          ${estoqueBaixo.slice(0, 6).map((p) => `
            <tr>
              <td>${escapeHtml(p.nome)}</td>
              <td class="cell-num" style="color: var(--danger); font-weight:700;">${p.estoque}</td>
              <td class="cell-num">${p.estoque_minimo}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
