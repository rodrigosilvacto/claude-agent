import { supabase } from "./supabaseClient.js";
import { formatCurrency, formatDate, escapeHtml } from "./app.js";

export async function render(view, actionsEl) {
  actionsEl.innerHTML = "";
  view.innerHTML = `<div class="empty-state">Carregando relatórios…</div>`;

  const [vendasRes, produtosRes, itensRes] = await Promise.all([
    supabase.from("vendas").select("id, total, status, data_venda, cliente_id, cliente:clientes(nome)"),
    supabase.from("produtos").select("id, nome, estoque, estoque_minimo").eq("ativo", true),
    supabase.from("venda_itens").select("produto_id, quantidade, subtotal, produto:produtos(nome), venda:vendas(status)"),
  ]);

  if (vendasRes.error || produtosRes.error || itensRes.error) {
    view.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar relatórios</p><p class="empty-state__hint">${escapeHtml((vendasRes.error || produtosRes.error || itensRes.error).message)}</p></div>`;
    return;
  }

  const vendasConfirmadas = (vendasRes.data || []).filter((v) => v.status === "confirmada");
  const faturamento = vendasConfirmadas.reduce((sum, v) => sum + Number(v.total || 0), 0);
  const ticketMedio = vendasConfirmadas.length ? faturamento / vendasConfirmadas.length : 0;
  const estoqueBaixo = (produtosRes.data || []).filter((p) => p.estoque <= p.estoque_minimo);

  const topProdutos = aggregate(
    (itensRes.data || []).filter((i) => i.venda?.status === "confirmada"),
    (i) => i.produto_id,
    (i) => i.produto?.nome || "Produto removido",
    (i) => ({ quantidade: i.quantidade, total: Number(i.subtotal || 0) }),
  );

  const topClientes = aggregate(
    vendasConfirmadas,
    (v) => v.cliente_id || "sem-cliente",
    (v) => v.cliente?.nome || "Sem cliente identificado",
    (v) => ({ quantidade: 1, total: Number(v.total || 0) }),
  );

  view.innerHTML = `
    <div class="stat-grid">
      ${statCard("Vendas confirmadas", vendasConfirmadas.length)}
      ${statCard("Faturamento total", formatCurrency(faturamento))}
      ${statCard("Ticket médio", formatCurrency(ticketMedio))}
      ${statCard("Produtos com estoque baixo", estoqueBaixo.length)}
    </div>

    <div class="report-grid">
      <div class="card card-section">
        <p class="section-title">Produtos mais vendidos</p>
        ${renderRankTable(topProdutos, "Produto", "Qtd.")}
      </div>
      <div class="card card-section">
        <p class="section-title">Melhores clientes</p>
        ${renderRankTable(topClientes, "Cliente", "Compras")}
      </div>
    </div>

    <div class="card card-section">
      <p class="section-title">Estoque baixo</p>
      ${estoqueBaixo.length === 0
        ? '<div class="empty-state" style="padding: 1.5rem;">Nenhum produto abaixo do estoque mínimo.</div>'
        : `<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Produto</th><th style="text-align:right">Estoque</th><th style="text-align:right">Mínimo</th></tr></thead>
            <tbody>
              ${estoqueBaixo.map((p) => `<tr><td>${escapeHtml(p.nome)}</td><td class="cell-num" style="color: var(--red); font-weight:600;">${p.estoque}</td><td class="cell-num">${p.estoque_minimo}</td></tr>`).join("")}
            </tbody>
          </table></div>`
      }
    </div>

    <div class="card card-section">
      <p class="section-title">Últimas vendas</p>
      ${renderUltimasVendas(vendasRes.data || [])}
    </div>
  `;
}

function aggregate(rows, keyFn, labelFn, valueFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const value = valueFn(row);
    if (!map.has(key)) map.set(key, { label: labelFn(row), quantidade: 0, total: 0 });
    const entry = map.get(key);
    entry.quantidade += value.quantidade;
    entry.total += value.total;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5);
}

function statCard(label, value) {
  return `
    <div class="card stat-card">
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

function renderUltimasVendas(vendas) {
  const rows = [...vendas].sort((a, b) => new Date(b.data_venda) - new Date(a.data_venda)).slice(0, 8);
  if (rows.length === 0) {
    return '<div class="empty-state" style="padding: 1.5rem;">Nenhuma venda registrada ainda.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Data</th><th>Cliente</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
        <tbody>
          ${rows.map((v) => `
            <tr>
              <td>${formatDate(v.data_venda)}</td>
              <td>${escapeHtml(v.cliente?.nome || "Sem cliente")}</td>
              <td class="cell-num">${formatCurrency(v.total)}</td>
              <td><span class="status status--${v.status}">${{ confirmada: "Confirmada", orcamento: "Orçamento", cancelada: "Cancelada" }[v.status] || v.status}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
