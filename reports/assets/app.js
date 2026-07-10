import { supabase } from "./supabaseClient.js?v=5";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_EXTENSIONS = ["pdf", "docx", "md", "txt", "html", "htm"];

const ANONYMOUS_AUTHOR = "Anônimo (login desabilitado)";
let allReports = [];

const els = {
  statTotal: document.getElementById("stat-total"),
  themeChart: document.getElementById("theme-chart"),
  freqChart: document.getElementById("freq-chart"),
  searchInput: document.getElementById("search-input"),
  themeFilter: document.getElementById("theme-filter"),
  tagFilter: document.getElementById("tag-filter"),
  dateFrom: document.getElementById("date-from"),
  dateTo: document.getElementById("date-to"),
  refreshBtn: document.getElementById("refresh-btn"),
  uploadBtn: document.getElementById("upload-btn"),
  grid: document.getElementById("reports-grid"),
  uploadModal: document.getElementById("upload-modal"),
  uploadForm: document.getElementById("upload-form"),
  fileInput: document.getElementById("file-input"),
  titleInput: document.getElementById("title-input"),
  themeInput: document.getElementById("theme-input"),
  themeOptions: document.getElementById("theme-options"),
  tagsInput: document.getElementById("tags-input"),
  uploadMessage: document.getElementById("upload-message"),
  cancelUpload: document.getElementById("cancel-upload"),
  submitUpload: document.getElementById("submit-upload"),
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString("pt-BR", { year: "numeric", month: "short", day: "numeric" });
}

// Login está temporariamente desabilitado (ver migration 0003): o painel
// roda aberto, sem sessão, então não há guarda de autenticação aqui.

// ---- Data loading ----
async function loadReports() {
  els.grid.innerHTML = '<p class="spinner-text">Carregando reports...</p>';
  const { data, error } = await supabase
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    els.grid.innerHTML = `<div class="card empty-state">Erro ao carregar reports: ${escapeHtml(error.message)}</div>`;
    return;
  }

  allReports = data || [];
  populateThemeOptions();
  renderDashboard();
  applyFilters();
}

function populateThemeOptions() {
  const themes = [...new Set(allReports.map((r) => r.theme).filter(Boolean))].sort();
  const currentFilterValue = els.themeFilter.value;
  els.themeFilter.innerHTML = '<option value="">Todos os temas</option>' +
    themes.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
  els.themeFilter.value = themes.includes(currentFilterValue) ? currentFilterValue : "";
  els.themeOptions.innerHTML = themes.map((t) => `<option value="${escapeHtml(t)}"></option>`).join("");
}

// ---- Dashboard ----
function renderDashboard() {
  els.statTotal.textContent = allReports.length;

  const byTheme = new Map();
  for (const r of allReports) {
    byTheme.set(r.theme, (byTheme.get(r.theme) || 0) + 1);
  }
  const sortedThemes = [...byTheme.entries()].sort((a, b) => b[1] - a[1]);
  const maxThemeCount = sortedThemes[0]?.[1] || 1;

  els.themeChart.innerHTML = sortedThemes.length
    ? sortedThemes.map(([theme, count]) => `
        <div class="bar-row">
          <span title="${escapeHtml(theme)}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(theme)}</span>
          <div class="track"><div class="fill" style="width:${(count / maxThemeCount) * 100}%; background: var(--accent);"></div></div>
          <span>${count}</span>
        </div>
      `).join("")
    : '<p class="hint">Sem dados ainda.</p>';

  // Frequency: last 12 ISO weeks
  const weekBuckets = [];
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setHours(0, 0, 0, 0);
  startOfThisWeek.setDate(startOfThisWeek.getDate() - startOfThisWeek.getDay());

  for (let i = 11; i >= 0; i--) {
    const weekStart = new Date(startOfThisWeek);
    weekStart.setDate(weekStart.getDate() - i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    weekBuckets.push({ start: weekStart, end: weekEnd, count: 0 });
  }

  for (const r of allReports) {
    const created = new Date(r.created_at);
    const bucket = weekBuckets.find((b) => created >= b.start && created < b.end);
    if (bucket) bucket.count += 1;
  }

  const maxWeekCount = Math.max(...weekBuckets.map((b) => b.count), 1);
  els.freqChart.innerHTML = weekBuckets.map((b) => `
    <div class="col">
      <div class="bar" style="height:${(b.count / maxWeekCount) * 100}%;" title="${b.count} report(s)"></div>
      <span class="tick">${b.start.getDate()}/${b.start.getMonth() + 1}</span>
    </div>
  `).join("");
}

// ---- Filtering & grid ----
function applyFilters() {
  const q = els.searchInput.value.trim().toLowerCase();
  const theme = els.themeFilter.value;
  const tag = els.tagFilter.value.trim().toLowerCase();
  const from = els.dateFrom.value ? new Date(els.dateFrom.value + "T00:00:00") : null;
  const to = els.dateTo.value ? new Date(els.dateTo.value + "T23:59:59") : null;

  const filtered = allReports.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q)) return false;
    if (theme && r.theme !== theme) return false;
    if (tag && !(r.tags || []).some((t) => t.toLowerCase().includes(tag))) return false;
    const created = new Date(r.created_at);
    if (from && created < from) return false;
    if (to && created > to) return false;
    return true;
  });

  renderGrid(filtered);
}

[els.searchInput, els.themeFilter, els.tagFilter, els.dateFrom, els.dateTo].forEach((el) => {
  el.addEventListener("input", applyFilters);
  el.addEventListener("change", applyFilters);
});

els.refreshBtn.addEventListener("click", loadReports);

function renderGrid(reports) {
  if (!reports.length) {
    els.grid.innerHTML = '<div class="card empty-state">Nenhum report encontrado com os filtros atuais.</div>';
    return;
  }

  els.grid.innerHTML = reports.map((r) => {
    const tagsHtml = (r.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("");
    return `
      <div class="card report-card" data-id="${r.id}">
        <span class="badge">${escapeHtml(r.theme)}</span>
        <h3>${escapeHtml(r.title)}</h3>
        <div class="tags">${tagsHtml}</div>
        <div class="meta" style="margin-top: auto;">
          <span>${escapeHtml(r.author_email)}</span>
          <span>${formatDate(r.created_at)}</span>
        </div>
        <div class="card-actions">
          <button class="secondary small" data-action="view">👁 Abrir arquivo</button>
          <button class="secondary small" data-action="share">${r.share_enabled ? "🔗 Copiar link" : "Compartilhar"}</button>
          <button class="danger small" data-action="delete">Excluir</button>
        </div>
      </div>
    `;
  }).join("");
}

els.grid.addEventListener("click", async (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const card = event.target.closest(".report-card");
  const reportId = card.dataset.id;
  const report = allReports.find((r) => r.id === reportId);
  if (!report) return;

  if (btn.dataset.action === "view") {
    await handleView(report, btn);
  } else if (btn.dataset.action === "share") {
    await handleShare(report, btn);
  } else if (btn.dataset.action === "delete") {
    await handleDelete(report, btn);
  }
});

async function handleView(report, btn) {
  btn.disabled = true;
  try {
    const { data, error } = await supabase.storage
      .from("reports")
      .createSignedUrl(report.file_path, 300);
    if (error || !data?.signedUrl) throw error || new Error("Não foi possível gerar o link do arquivo.");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  } catch (err) {
    alert("Erro ao abrir arquivo: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function handleShare(report, btn) {
  btn.disabled = true;
  try {
    if (!report.share_enabled) {
      const { error } = await supabase
        .from("reports")
        .update({ share_enabled: true })
        .eq("id", report.id);
      if (error) throw error;
      report.share_enabled = true;
    }
    const link = new URL(`./share.html?token=${report.share_token}`, window.location.href).toString();
    await copyToClipboard(link);
    btn.textContent = "✓ Link copiado";
    setTimeout(() => { btn.textContent = "🔗 Copiar link"; }, 2000);
  } catch (err) {
    alert("Erro ao gerar link: " + err.message);
  } finally {
    btn.disabled = false;
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    window.prompt("Copie o link:", text);
  }
}

async function handleDelete(report, btn) {
  if (!confirm(`Excluir o report "${report.title}"? Esta ação não pode ser desfeita.`)) return;
  btn.disabled = true;
  try {
    await supabase.storage.from("reports").remove([report.file_path]);
    const { error } = await supabase.from("reports").delete().eq("id", report.id);
    if (error) throw error;
    await loadReports();
  } catch (err) {
    alert("Erro ao excluir: " + err.message);
    btn.disabled = false;
  }
}

// ---- Upload modal ----
els.uploadBtn.addEventListener("click", () => {
  els.uploadForm.reset();
  els.uploadMessage.textContent = "";
  els.uploadModal.style.display = "flex";
});

els.cancelUpload.addEventListener("click", () => {
  els.uploadModal.style.display = "none";
});

els.uploadModal.addEventListener("click", (event) => {
  if (event.target === els.uploadModal) els.uploadModal.style.display = "none";
});

els.uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.uploadMessage.textContent = "";
  els.uploadMessage.className = "message";
  els.submitUpload.disabled = true;

  try {
    const file = els.fileInput.files[0];
    if (!file) throw new Error("Selecione um arquivo.");

    const ext = file.name.split(".").pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error("Formato não suportado. Envie PDF, DOCX, MD, TXT ou HTML.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Arquivo maior que 20MB.");
    }

    const title = els.titleInput.value.trim();
    const theme = els.themeInput.value.trim();
    const tags = els.tagsInput.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const reportId = crypto.randomUUID();
    const safeFileName = file.name.replace(/[^\w.\-]/g, "_");
    const filePath = `anonymous/${reportId}/${safeFileName}`;

    els.uploadMessage.textContent = "Enviando arquivo...";

    const { error: uploadError } = await supabase.storage
      .from("reports")
      .upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("reports").insert({
      id: reportId,
      title,
      author_email: ANONYMOUS_AUTHOR,
      file_path: filePath,
      file_name: file.name,
      file_type: ext,
      file_size: file.size,
      theme,
      tags,
    });
    if (insertError) throw insertError;

    els.uploadMessage.textContent = "Report enviado!";
    els.uploadMessage.className = "message success";

    await loadReports();
    els.uploadModal.style.display = "none";
  } catch (err) {
    els.uploadMessage.textContent = "Erro: " + err.message;
    els.uploadMessage.className = "message error";
  } finally {
    els.submitUpload.disabled = false;
  }
});

loadReports();
