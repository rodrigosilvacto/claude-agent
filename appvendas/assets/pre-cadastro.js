// Página pública de pré-cadastro — sem login, sem app-shell. Roda isolada
// de app.js/auth.js de propósito: é a única tela do AppVendas pensada para
// ser aberta por alguém que não é da equipe.

import { supabase } from "./supabaseClient.js";
import { consultarCep } from "./cep.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

const form = document.getElementById("precadastro-form");
const errorEl = document.getElementById("precadastro-error");
const submitBtn = document.getElementById("precadastro-submit");
const successEl = document.getElementById("precadastro-success");

const cepInput = document.getElementById("pc-cep");
const cepHint = document.getElementById("pc-cep-hint");

cepInput.addEventListener("blur", async () => {
  const digits = cepInput.value.replace(/\D/g, "");
  if (!digits) {
    cepHint.hidden = true;
    return;
  }

  cepHint.hidden = false;
  cepHint.className = "field-hint";
  cepHint.textContent = "Buscando endereço…";

  try {
    const endereco = await consultarCep(digits);
    cepHint.hidden = true;
    if (endereco.logradouro) form.elements.endereco.value = endereco.logradouro;
    if (endereco.localidade) form.elements.cidade.value = endereco.localidade;
    if (endereco.uf) form.elements.uf.value = endereco.uf;
  } catch (err) {
    cepHint.hidden = false;
    cepHint.className = "field-hint field-hint--error";
    cepHint.textContent = err.message;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.innerHTML = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Enviando…";

  const payload = {
    p_nome: form.elements.nome.value,
    p_documento: form.elements.documento.value,
    p_email: form.elements.email.value || null,
    p_telefone: form.elements.telefone.value || null,
    p_cep: form.elements.cep.value || null,
    p_cidade: form.elements.cidade.value || null,
    p_uf: form.elements.uf.value || null,
    p_endereco: form.elements.endereco.value || null,
    p_empresa_codigo: new URLSearchParams(window.location.search).get("empresa") || null,
  };

  const { data, error } = await supabase.rpc("pre_cadastro_cliente", payload);

  if (error) {
    errorEl.innerHTML = `<div class="form-error">${escapeHtml(error.message)}</div>`;
    submitBtn.disabled = false;
    submitBtn.textContent = "Enviar cadastro";
    return;
  }

  const nome = data?.[0]?.nome || form.elements.nome.value;
  form.hidden = true;
  successEl.hidden = false;
  successEl.innerHTML = `
    <div class="precadastro-success">
      <div class="precadastro-success__icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
      </div>
      <p class="precadastro-success__title">Cadastro recebido, ${escapeHtml(nome)}!</p>
      <p class="precadastro-success__hint">Nossa equipe vai analisar seus dados. Assim que aprovado, você já passa a fazer parte da nossa base de clientes.</p>
    </div>
  `;
});
