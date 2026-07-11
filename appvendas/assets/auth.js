// AppVendas — sessão, login/logout e checagem de permissões.
//
// Login é feito com "usuário" (não e-mail): mapeamos para um e-mail interno
// fictício (usuario@appvendas.local) porque o Supabase Auth exige e-mail —
// a mesma conversão é feita no back-end (edge function manage-usuarios) na
// hora de criar a conta, então login e senha continuam sendo o único dado
// que a pessoa realmente digita.

import { supabase } from "./supabaseClient.js";

const EMAIL_DOMAIN = "appvendas.local";
const DIACRITICS_RE = /[̀-ͯ]/g;

export function sanitizeLogin(raw) {
  return String(raw || "")
    .normalize("NFD")
    .replace(DIACRITICS_RE, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
}

let currentSession = null;
let currentUsuario = null;
let ready = false;
const listeners = new Set();

async function loadUsuario(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from("usuarios")
    .select("id, nome, login, role, ativo")
    .eq("id", userId)
    .maybeSingle();
  return data || null;
}

async function refresh(session) {
  currentSession = session || null;
  currentUsuario = currentSession ? await loadUsuario(currentSession.user.id) : null;
  listeners.forEach((fn) => fn());
}

export function onAuthChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

let initPromise = null;

export function initAuth() {
  if (!initPromise) {
    initPromise = (async () => {
      const { data } = await supabase.auth.getSession();
      await refresh(data.session);
      ready = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        refresh(session);
      });
    })();
  }
  return initPromise;
}

export function isAuthReady() {
  return ready;
}

export function getCurrentUsuario() {
  return currentUsuario;
}

export function isLoggedIn() {
  return Boolean(currentSession && currentUsuario && currentUsuario.ativo);
}

export function isAdmin() {
  return Boolean(currentUsuario && currentUsuario.role === "admin" && currentUsuario.ativo);
}

export async function signIn(login, senha) {
  const email = `${sanitizeLogin(login)}@${EMAIL_DOMAIN}`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha });

  if (error) {
    const message = /invalid login credentials/i.test(error.message)
      ? "Usuário ou senha inválidos."
      : error.message;
    throw new Error(message);
  }

  await refresh(data.session);

  if (!currentUsuario || !currentUsuario.ativo) {
    await supabase.auth.signOut();
    await refresh(null);
    throw new Error("Este usuário está desativado. Fale com um administrador.");
  }

  return currentUsuario;
}

export async function signOut() {
  await supabase.auth.signOut();
  await refresh(null);
}

export async function callManageUsuarios(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("manage-usuarios", {
    body: { action, ...payload },
  });

  if (error) {
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body?.error) message = body.error;
    } catch {
      // resposta não era JSON — mantém a mensagem original do erro de rede
    }
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}
