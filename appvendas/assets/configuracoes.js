// BjjConnect — Administração > Configurações: por empresa, permite trocar o
// nome exibido do app (branding) e esconder itens de menu operacionais que
// aquela empresa não usa. Só admins globais (sem empresa vinculada) acessam
// esta tela — a rota já é bloqueada em app.js (globalAdminOnly), e a RPC
// `atualizar_config_empresa` revalida a mesma regra no banco.

import { supabase } from "./supabaseClient.js";
import { showToast, escapeHtml, friendlyPgError, createSearchSelect, DEFAULT_APP_NAME } from "./app.js";
import { HORARIOS_PADRAO } from "./agenda.js";

const HORARIO_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MENU_ITEMS = [
  { key: "clientes", label: "Clientes" },
  { key: "produtos", label: "Produtos" },
  { key: "fornecedores", label: "Fornecedores" },
  { key: "vendas", label: "Loja" },
  { key: "agenda", label: "Agenda" },
  { key: "estoques", label: "Estoques" },
  { key: "matriculas", label: "Matrículas" },
  { key: "contas-receber", label: "Contas a Receber" },
  { key: "contas-pagar", label: "Contas a Pagar" },
  { key: "relatorios", label: "Visão geral (Relatórios)" },
];

async function loadEmpresasOptions() {
  const { data } = await supabase
    .from("empresas")
    .select("id, nome_fantasia, codigo, ativo")
    .order("nome_fantasia", { ascending: true });
  return (data || []).map((e) => ({ value: e.id, label: e.nome_fantasia, meta: e.ativo ? e.codigo : `${e.codigo} · inativa` }));
}

export async function render(view, actionsEl) {
  actionsEl.innerHTML = "";
  view.innerHTML = `
    <div class="card card-section">
      <p class="section-title">Selecione a empresa</p>
      <p class="field-hint" style="margin: -0.4rem 0 1rem;">Escolha para qual empresa você quer customizar o nome do app e os menus disponíveis.</p>
      <div class="field field--full" style="max-width: 28rem;">
        <div data-mount="f-empresa"></div>
      </div>
    </div>
    <div id="config-form-mount"></div>
  `;

  const empresasOptions = await loadEmpresasOptions();
  const formMount = view.querySelector("#config-form-mount");

  createSearchSelect({
    container: view.querySelector('[data-mount="f-empresa"]'),
    placeholder: "Buscar empresa…",
    options: empresasOptions,
    onChange: async (empresaId) => {
      if (!empresaId) {
        formMount.innerHTML = "";
        return;
      }
      await renderConfigForm(formMount, empresaId);
    },
  });
}

async function renderConfigForm(formMount, empresaId) {
  formMount.innerHTML = `<div class="card card-section"><p class="section-title">Carregando…</p></div>`;

  const { data: empresa, error } = await supabase
    .from("empresas")
    .select("id, nome_fantasia, nome_aplicacao, menus_habilitados, horarios_agenda")
    .eq("id", empresaId)
    .single();

  if (error) {
    formMount.innerHTML = `<div class="empty-state"><p class="empty-state__title">Erro ao carregar configuração</p><p class="empty-state__hint">${escapeHtml(friendlyPgError(error))}</p></div>`;
    return;
  }

  const menus = empresa.menus_habilitados || {};
  const horariosAtuais = (empresa.horarios_agenda || []).join(", ");

  formMount.innerHTML = `
    <form id="config-form">
      <div id="form-error"></div>

      <div class="card card-section">
        <p class="section-title">Nome do aplicativo — ${escapeHtml(empresa.nome_fantasia)}</p>
        <div class="field field--full">
          <label for="f-nome-aplicacao">Nome exibido na sidebar e na aba do navegador</label>
          <input class="input" type="text" id="f-nome-aplicacao" name="nome_aplicacao" value="${escapeHtml(empresa.nome_aplicacao ?? "")}" placeholder="${escapeHtml(DEFAULT_APP_NAME)} (padrão)" maxlength="60" />
          <p class="field-hint">Deixe em branco para usar o nome padrão (${escapeHtml(DEFAULT_APP_NAME)}). Vale só para os usuários vinculados a esta empresa — a tela de login continua mostrando o nome padrão.</p>
        </div>
      </div>

      <div class="card card-section">
        <p class="section-title">Itens de menu visíveis para esta empresa</p>
        <p class="field-hint" style="margin: -0.4rem 0 1rem;">Desmarque para esconder o item do menu de todos os usuários desta empresa (Início e Administração ficam sempre visíveis).</p>
        <div class="form-grid">
          ${MENU_ITEMS.map((item) => `
            <div class="field">
              <label><input type="checkbox" name="menu-${item.key}" ${menus[item.key] === false ? "" : "checked"} /> ${escapeHtml(item.label)}</label>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="card card-section">
        <p class="section-title">Horários da Agenda</p>
        <div class="field field--full">
          <label for="f-horarios-agenda">Horários de atendimento, separados por vírgula</label>
          <input class="input" type="text" id="f-horarios-agenda" name="horarios_agenda" value="${escapeHtml(horariosAtuais)}" placeholder="${escapeHtml(HORARIOS_PADRAO.join(", "))} (padrão)" />
          <p class="field-hint" id="f-horarios-agenda-hint">Formato 24h, "HH:MM" (ex.: 08:00, 08:30, 09:00…). Deixe em branco para usar a grade padrão do sistema.</p>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn--primary">Salvar configurações</button>
      </div>
    </form>
  `;

  formMount.querySelector("#config-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = form.querySelector("#form-error");
    errorEl.innerHTML = "";

    const menusHabilitados = {};
    MENU_ITEMS.forEach((item) => {
      menusHabilitados[item.key] = form.elements[`menu-${item.key}`].checked;
    });

    const horariosRaw = form.elements.horarios_agenda.value.trim();
    let horariosAgenda = null;
    if (horariosRaw) {
      horariosAgenda = horariosRaw.split(",").map((h) => h.trim()).filter(Boolean);
      const invalido = horariosAgenda.find((h) => !HORARIO_RE.test(h));
      if (invalido) {
        errorEl.innerHTML = `<div class="form-error">Horário inválido: "${escapeHtml(invalido)}". Use o formato 24h "HH:MM" (ex.: 08:00), separado por vírgulas.</div>`;
        return;
      }
      horariosAgenda = [...new Set(horariosAgenda)].sort();
    }

    const { error: saveError } = await supabase.rpc("atualizar_config_empresa", {
      p_empresa_id: empresaId,
      p_nome_aplicacao: form.elements.nome_aplicacao.value,
      p_menus_habilitados: menusHabilitados,
      p_horarios_agenda: horariosAgenda,
    });

    if (saveError) {
      errorEl.innerHTML = `<div class="form-error">${escapeHtml(friendlyPgError(saveError))}</div>`;
      return;
    }

    showToast("Configurações salvas.");
  });
}
