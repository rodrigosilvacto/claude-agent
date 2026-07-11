// AppVendas — shell: roteamento por hash + utilitários compartilhados
// (toast, modal, confirmação, formatação). Cada módulo de tela expõe
// `render(view)` e monta seu próprio HTML dentro do container recebido.

import { initAuth, isLoggedIn, isAdmin, getCurrentUsuario, signOut, onAuthChange } from "./auth.js";

export const APP_BUILD = "2026-07-11 22:45 -03";

const ROUTES = {
  home: {
    breadcrumb: "Início",
    title: "Painel do dia",
    load: () => import("./home.js"),
  },
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
  usuarios: {
    breadcrumb: "Administração",
    title: "Usuários",
    load: () => import("./usuarios.js"),
    adminOnly: true,
  },
};

const DEFAULT_ROUTE = "home";

const viewEl = document.getElementById("view");
const breadcrumbEl = document.getElementById("breadcrumb");
const titleEl = document.getElementById("page-title");
const topbarActionsEl = document.getElementById("topbar-actions");
const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const navUsuarios = document.getElementById("nav-usuarios");
const userChipAvatar = document.getElementById("user-chip-avatar");
const userChipName = document.getElementById("user-chip-name");
const userChipMeta = document.getElementById("user-chip-meta");
const logoutBtn = document.getElementById("logout-btn");

function initials(nome) {
  const parts = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function updateAuthUI() {
  const usuario = getCurrentUsuario();
  const logged = isLoggedIn();

  appShell.classList.toggle("is-locked", !logged);
  navUsuarios.hidden = !isAdmin();

  if (usuario) {
    userChipAvatar.textContent = initials(usuario.nome);
    userChipName.textContent = usuario.nome;
    userChipMeta.textContent = usuario.role === "admin" ? "Administrador" : "Caixa";
  } else {
    userChipAvatar.textContent = "–";
    userChipName.textContent = "—";
    userChipMeta.textContent = "—";
  }
}

logoutBtn.addEventListener("click", async () => {
  await signOut();
});

async function renderRoute() {
  if (!isLoggedIn()) {
    stopAutoRefresh();
    breadcrumbEl.textContent = "";
    titleEl.textContent = "Entrar";
    topbarActionsEl.innerHTML = "";
    closeNavDrawer();
    const mod = await import("./login.js");
    mod.render(viewEl);
    return;
  }

  const hash = window.location.hash.replace(/^#\//, "").split("?")[0];
  let routeKey = ROUTES[hash] ? hash : DEFAULT_ROUTE;
  if (ROUTES[routeKey].adminOnly && !isAdmin()) {
    routeKey = DEFAULT_ROUTE;
    window.location.hash = `#/${DEFAULT_ROUTE}`;
  }
  const route = ROUTES[routeKey];

  navLinks.forEach((link) => {
    link.classList.toggle("is-active", link.dataset.route === routeKey);
  });

  stopAutoRefresh();
  breadcrumbEl.textContent = route.breadcrumb;
  titleEl.textContent = route.title;
  topbarActionsEl.innerHTML = "";
  closeNavDrawer();

  // O módulo da rota já pinta seu próprio estado inicial (toolbar +
  // skeleton, abas, etc.) assim que carrega — normalmente em microssegundos,
  // já que o import fica em cache do navegador. Só mostramos este skeleton
  // genérico se o carregamento realmente demorar, para não piscar uma tela
  // "errada" por uma fração de segundo antes da tela real aparecer.
  const loadingTimer = setTimeout(() => {
    viewEl.innerHTML = skeletonTable(4);
  }, 150);

  try {
    const mod = await route.load();
    clearTimeout(loadingTimer);
    await mod.render(viewEl, topbarActionsEl);
  } catch (err) {
    clearTimeout(loadingTimer);
    console.error(err);
    viewEl.innerHTML = `<div class="empty-state"><p class="empty-state__title">Não foi possível carregar esta tela</p><p class="empty-state__hint">${escapeHtml(err.message || String(err))}</p></div>`;
  }
}

window.addEventListener("hashchange", renderRoute);

async function boot() {
  await initAuth();
  onAuthChange(() => {
    updateAuthUI();
    renderRoute();
  });
  updateAuthUI();
  renderRoute();
}

window.addEventListener("DOMContentLoaded", boot);

// ── Menu responsivo (drawer + scrim) ───────────────────────────────

const appShell = document.getElementById("app-shell");
const menuToggle = document.getElementById("menu-toggle");
const sidebarClose = document.getElementById("sidebar-close");
const sidebarScrim = document.getElementById("sidebar-scrim");

function openNavDrawer() {
  appShell.classList.add("is-nav-open");
}

function closeNavDrawer() {
  appShell.classList.remove("is-nav-open");
}

menuToggle.addEventListener("click", openNavDrawer);
sidebarClose.addEventListener("click", closeNavDrawer);
sidebarScrim.addEventListener("click", closeNavDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeNavDrawer();
});

// ── Skeleton (estado de carregamento) ──────────────────────────────

export function skeletonTable(rows = 4) {
  const widths = ["70%", "45%", "60%", "35%"];
  const line = () => `<td><div class="skeleton-bar" style="width:${widths[Math.floor(Math.random() * widths.length)]}"></div></td>`;
  const row = () => `<tr>${line()}${line()}${line()}${line()}</tr>`;
  return `
    <div class="card">
      <div class="table-wrap">
        <table class="data-table skeleton-table"><tbody>${Array.from({ length: rows }, row).join("")}</tbody></table>
      </div>
    </div>
  `;
}

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

// ── Busca dinâmica (substitui <select> combo box) ──────────────────
//
// Campo de texto que filtra uma lista de opções em tela, com navegação
// por teclado. Usado em qualquer vínculo entre cadastros (cliente,
// produto, fornecedor) no lugar de um <select> tradicional.

const SS_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';

function normalizeForSearch(str) {
  return String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function createSearchSelect({
  container,
  placeholder = "Buscar…",
  options = [],
  value = null,
  onChange = () => {},
  allowClear = true,
  emptyText = "Nenhum resultado encontrado",
}) {
  container.classList.add("search-select");
  container.innerHTML = `
    <div class="search-select__control">
      ${SS_ICON}
      <input type="text" class="search-select__input" autocomplete="off" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${escapeHtml(placeholder)}" />
      <button type="button" class="search-select__clear" hidden aria-label="Limpar seleção">&times;</button>
    </div>
    <div class="search-select__panel" role="listbox" hidden></div>
  `;

  const input = container.querySelector(".search-select__input");
  const clearBtn = container.querySelector(".search-select__clear");
  const panel = container.querySelector(".search-select__panel");

  let allOptions = options;
  let filtered = [];
  let highlighted = -1;
  let selected = null;

  function findOption(v) {
    return allOptions.find((o) => String(o.value) === String(v)) || null;
  }

  function optionMatches(opt, term) {
    const haystack = normalizeForSearch(`${opt.label} ${opt.meta || ""}`);
    return haystack.includes(term);
  }

  function openPanel() {
    const term = normalizeForSearch(input.value);
    filtered = term ? allOptions.filter((o) => optionMatches(o, term)) : allOptions.slice(0, 60);
    highlighted = filtered.length ? 0 : -1;
    renderPanel();
    panel.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    panel.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function renderPanel() {
    if (filtered.length === 0) {
      panel.innerHTML = `<div class="search-select__empty">${escapeHtml(emptyText)}</div>`;
      return;
    }
    panel.innerHTML = filtered.map((opt, idx) => `
      <div class="search-select__option ${idx === highlighted ? "is-highlighted" : ""}" role="option" data-idx="${idx}">
        <span class="search-select__option-label">${escapeHtml(opt.label)}</span>
        ${opt.meta ? `<span class="search-select__option-meta">${escapeHtml(opt.meta)}</span>` : ""}
      </div>
    `).join("");
    panel.querySelectorAll(".search-select__option").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(filtered[Number(el.dataset.idx)]);
      });
    });
  }

  function pick(opt) {
    selected = opt || null;
    input.value = opt ? opt.label : "";
    container.classList.toggle("has-value", Boolean(opt));
    clearBtn.hidden = !allowClear || !opt;
    closePanel();
    onChange(opt ? opt.value : null, opt);
  }

  input.addEventListener("focus", openPanel);
  input.addEventListener("input", () => {
    if (selected) {
      selected = null;
      container.classList.remove("has-value");
      clearBtn.hidden = true;
      onChange(null, null);
    }
    openPanel();
  });

  input.addEventListener("keydown", (e) => {
    if (panel.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      openPanel();
      return;
    }
    if (panel.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlighted = Math.min(highlighted + 1, filtered.length - 1);
      renderPanel();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlighted = Math.max(highlighted - 1, 0);
      renderPanel();
    } else if (e.key === "Enter") {
      if (highlighted >= 0 && filtered[highlighted]) {
        e.preventDefault();
        pick(filtered[highlighted]);
      }
    } else if (e.key === "Escape") {
      closePanel();
    }
  });

  clearBtn.addEventListener("click", () => {
    pick(null);
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target)) closePanel();
  });

  if (value != null) {
    const initial = findOption(value);
    if (initial) pick(initial);
  }

  return {
    getValue: () => (selected ? selected.value : null),
    setValue: (v) => pick(v == null ? null : findOption(v)),
    reset: () => pick(null),
    setOptions: (next) => {
      allOptions = next;
      if (selected && !findOption(selected.value)) pick(null);
    },
    focusInput: () => input.focus(),
  };
}

// ── Atualização automática ───────────────────────────────────────────
//
// Em vez de exigir F5, cada tela registra uma função de recarga que é
// chamada em intervalo e sempre que a aba volta a ficar em foco — pausada
// enquanto um modal está aberto ou o campo de busca está com foco, para
// não atrapalhar quem está digitando.

let stopCurrentAutoRefresh = null;

export function registerAutoRefresh(callback, interval = 15000) {
  stopAutoRefresh();

  const isBusy = () => document.hidden || !modalOverlay.hidden || document.activeElement?.classList.contains("search-select__input");
  const tick = () => {
    if (!isBusy()) callback();
  };
  const onFocus = () => {
    if (!isBusy()) callback();
  };

  const id = setInterval(tick, interval);
  window.addEventListener("focus", onFocus);

  stopCurrentAutoRefresh = () => {
    clearInterval(id);
    window.removeEventListener("focus", onFocus);
  };
}

export function stopAutoRefresh() {
  if (stopCurrentAutoRefresh) {
    stopCurrentAutoRefresh();
    stopCurrentAutoRefresh = null;
  }
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
