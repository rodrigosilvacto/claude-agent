# claude-agent

## Painel de Reports (`/reports`)

Painel interno para centralizar reports (PDF/DOCX/MD/TXT): upload com
tema/tags, resumo automático via Claude, busca/filtro, compartilhamento por
link e dashboard de indicadores. Stack: HTML/JS estático + Supabase (Auth,
Postgres, Storage, Edge Functions), mesmo padrão do `index.html` na raiz.

Páginas: `reports/login.html` (login por magic link), `reports/index.html`
(painel autenticado) e `reports/share.html` (visualização pública read-only
via link).

### Setup no projeto Supabase (`ClaudeProjects`)

1. Aplicar a migration `supabase/migrations/0002_create_reports_panel.sql`
   (tabelas `reports`/`audit_logs`, RLS, bucket de storage `reports`).
2. Deploy das Edge Functions `supabase/functions/generate-summary` e
   `supabase/functions/share-report`.
3. Configurar o secret `ANTHROPIC_API_KEY` no projeto Supabase (Dashboard →
   Edge Functions → Secrets, ou `supabase secrets set ANTHROPIC_API_KEY=...`).
   Sem essa chave o upload continua funcionando, mas o resumo automático fica
   com status de erro até ser reprocessado.
4. Habilitar magic link (Email OTP) no Supabase Auth, se ainda não estiver
   habilitado.