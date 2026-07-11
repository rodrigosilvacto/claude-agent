// AppVendas — shell: roteamento por hash + utilitários compartilhados
// (toast, modal, confirmação, formatação). Cada módulo de tela expõe
// `render(view)` e monta seu próprio HTML dentro do container recebido.

export const APP_BUILD = "2026-07-11 21:00 -03";

const ROUTES = {
  clientes: {
    breadcrumb: "Cadastros",
    title: "Clientes",
    load: () => import("./clientes.js"),
  },
  produtos: {
    breadcrumb: "Cadastros",
    title: "Produtos",
    load: () => import("./produtos.js"),
  },
  fornecedores: {
    breadcrumb: "Cadastros",
    title: "Fornecedores",
    load: () => import("./fornecedores.js"),
  },
  vendas: {
    breadcrumb: "Vendas",
    title: "Movimentação de Vendas",
    load: () => import("./vendas.js"),
  },
  relatorios: {
    breadcrumb: "Relatórios",
    title: "Visão geral",
    load: () => import("./relatorios.js"),
  },
};

const DEFAULT_ROUTE = "clientes";

const viewEl = document.getElementById("view");
const breadcrumbEl = document.getElementById("breadcrumb");
const titleEl = document.getElementById("page-title");
const topbarActionsEl = document.getElementById("topbar-actions");
const navLinks = Array.from(document.querySelectorAll(".nav-link"));

async function renderRoute() {
  const hash = window.location.hash.replace(/^#\//, "").split("?")[0];
  const routeKey = ROUTES[hash] ? hash : DEFAULT_ROUTE;
  const route = ROUTES[routeKey];

  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.route === routeKey);
  });

  breadcrumbEl.textContent = route.breadcrumb;
  titleEl.textContent = route.title;
  topbarActionsEl.innerHTML = "";
  viewEl.innerHTML = '<div class="empty-state">Carregando…</div>';

  try {
    const mod = await route.load();
    await mod.render(viewEl, topbarActionsEl);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar esta tela</p><p class="empty-state__hint">${escapeHtml(err.message || String(err))}</p></div>`;
  }
}

window.addEventListener("hashchange", renderRoute);
window.addEventListener("DOMContentLoaded", renderRoute);

// ── Toast ───────────────────────────────────────────────────────────

const toastStack = document.getElementById("toast-stack");

export function showToast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastStack.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Modal ───────────────────────────────────────────────────────────

const modalOverlay = document.getElementById("modal-overlay");
const modalTitleEl = document.getElementById("modal-title");
const modalBodyEl = document.getElementById("modal-body");
const modalCloseBtn = document.getElementById("modal-close");

let onModalClose = null;

export function openModal(title, { onClose } = {}) {
  modalTitleEl.textContent = title;
  modalBodyEl.innerHTML = "";
  modalOverlay.hidden = false;
  onModalClose = onClose || null;
  return modalBodyEl;
}

export function closeModal() {
  modalOverlay.hidden = true;
  modalBodyEl.innerHTML = "";
  if (onModalClose) onModalClose();
  onModalClose = null;
}

modalCloseBtn.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalOverlay.hidden) closeModal();
});

export function confirmDialog(message, { confirmLabel = "Confirmar", danger = true } = {}) {
  return new Promise((resolve) => {
    const body = openModal("Confirmar ação", {
      onClose: () => resolve(false),
    });
    body.innerHTML = `
      <p style="margin: 0 0 1.2rem; color: var(--text);">${escapeHtml(message)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-action="cancel">Cancelar</button>
        <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
      </div>
    `;
    body.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      onModalClose = null;
      closeModal();
      resolve(false);
    });
    body.querySelector('[data-action="confirm"]').addEventListener("click", () => {
      onModalClose = null;
      closeModal();
      resolve(true);
    });
  });
}

// ── Formatação ──────────────────────────────────────────────────────

export function formatCurrency(value) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return d.toLocaleDateString("pt-BR");
}

export function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
