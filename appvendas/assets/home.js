import { supabase } from "./supabaseClient.js";
import { formatCurrency, formatDate, escapeHtml, registerAutoRefresh } from "./app.js";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
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
  const mesInicio = `${hoje.slice(0, 7)}-01`;

  const [vendasMesRes, ultimasRes, produtosRes] = await Promise.all([
    supabase.from("vendas").select("id, total, status, data_venda").gte("data_venda", mesInicio),
    supabase.from("vendas").select("id, numero, data_venda, status, total, cliente:clientes(nome)").order("numero", { ascending: false }).limit(6),
    supabase.from("produtos").select("id, nome, estoque, estoque_minimo").eq("ativo", true),
  ]);

  if (vendasMesRes.error || ultimasRes.error || produtosRes.error) {
    const err = vendasMesRes.error || ultimasRes.error || produtosRes.error;
    view.innerHTML = `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar o painel</p><p class="empty-state__hint">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const vendasMesConfirmadas = (vendasMesRes.data || []).filter((v) => v.status === "confirmada");
  const vendasHoje = vendasMesConfirmadas.filter((v) => v.data_venda === hoje);
  const faturamentoHoje = vendasHoje.reduce((sum, v) => sum + Number(v.total || 0), 0);
  const faturamentoMes = vendasMesConfirmadas.reduce((sum, v) => sum + Number(v.total || 0), 0);
  const estoqueBaixo = (produtosRes.data || []).filter((p) => p.estoque <= p.estoque_minimo).sort((a, b) => a.estoque - b.estoque);

  view.innerHTML = `
    <div class="home-hero">
      <p class="home-hero__eyebrow">${greeting()}, equipe comercial</p>
      <h2 class="home-hero__title">${formatFullDate(hoje)}</h2>
    </div>

    <div class="quick-actions">
      <a class="quick-action" href="#/vendas">
        <span class="quick-action__title">+ Nova venda</span>
        <span class="quick-action__hint">Registrar uma venda no caixa</span>
      </a>
      <a class="quick-action" href="#/clientes">
        <span class="quick-action__title">Clientes</span>
        <span class="quick-action__hint">Consultar ou cadastrar clientes</span>
      </a>
      <a class="quick-action" href="#/produtos">
        <span class="quick-action__title">Produtos</span>
        <span class="quick-action__hint">Preços, estoque e categorias</span>
      </a>
      <a class="quick-action" href="#/relatorios">
        <span class="quick-action__title">Relatórios completos</span>
        <span class="quick-action__hint">Ranking de produtos e clientes</span>
      </a>
    </div>

    <div class="stat-grid">
      ${statCard("Vendas hoje", vendasHoje.length, "var(--accent)")}
      ${statCard("Faturamento hoje", formatCurrency(faturamentoHoje), "var(--accent-deep)")}
      ${statCard("Faturamento do mês", formatCurrency(faturamentoMes), "var(--amber)")}
      ${statCard("Produtos com estoque baixo", estoqueBaixo.length, "var(--danger)")}
    </div>

    <div class="report-grid">
      <div class="card card-section">
        <p class="section-title">Últimas vendas</p>
        ${renderUltimasVendas(ultimasRes.data || [])}
      </div>
      <div class="card card-section">
        <p class="section-title">Estoque baixo</p>
        ${renderEstoqueBaixo(estoqueBaixo)}
      </div>
    </div>
  `;
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

function statusLabel(status) {
  return { confirmada: "Confirmada", orcamento: "Orçamento", cancelada: "Cancelada" }[status] || status;
}

function renderUltimasVendas(vendas) {
  if (vendas.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhuma venda registrada ainda.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
        <tbody>
          ${vendas.map((v) => `
            <tr>
              <td class="cell-num">#${v.numero}</td>
              <td>${formatDate(v.data_venda)}</td>
              <td>${escapeHtml(v.cliente?.nome || "Sem cliente")}</td>
              <td class="cell-num">${formatCurrency(v.total)}</td>
              <td><span class="status status--${v.status}">${statusLabel(v.status)}</span></td>
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
          ${estoqueBaixo.slice(0, 5).map((p) => `
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
