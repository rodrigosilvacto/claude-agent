# claude-agent

## Painel de Reports (`/reports`)

Painel interno para centralizar reports (PDF/DOCX/MD/TXT): upload com
tema/tags, resumo automático via Claude, busca/filtro, compartilhamento por
link e dashboard de indicadores. Stack: HTML/JS estático + Supabase (Auth,
Postgres, Storage, Edge Functions), mesmo padrão do `index.html` na raiz.

Páginas: `reports/index.html` (painel principal) e `reports/share.html`
(visualização pública read-only via link). `reports/login.html` fica com um
aviso apontando direto para o painel — **login está temporariamente
desabilitado**, ver abaixo.

> **Login desabilitado (temporário):** por padrão o painel exigia sessão via
> magic link. Isso foi desligado (migration `0003_disable_auth_requirement.sql`)
> para simplificar o teste inicial — o acesso está aberto para quem tiver a
> URL, sem exigir autenticação, e todo upload é registrado como
> "Anônimo (login desabilitado)". Antes de expor o painel além do piloto
> interno, reavaliar e reverter para as políticas autenticadas da migration
> `0002` (requisito de LGPD/segurança do PRD).

### Setup no projeto Supabase (`ClaudeProjects`)

1. Aplicar as migrations, em ordem:
   - `supabase/migrations/0002_create_reports_panel.sql` (tabelas
     `reports`/`audit_logs`, RLS, bucket de storage `reports`)
   - `supabase/migrations/0003_disable_auth_requirement.sql` (abre o acesso
     para o anon key — só aplicar se realmente quiser o painel sem login)
2. Deploy das Edge Functions `supabase/functions/generate-summary` e
   `supabase/functions/share-report`.
3. Configurar o secret `ANTHROPIC_API_KEY` no projeto Supabase (Dashboard →
   Edge Functions → Secrets, ou `supabase secrets set ANTHROPIC_API_KEY=...`).
   Sem essa chave o upload continua funcionando, mas o resumo automático fica
   com status de erro até ser reprocessado.
4. Magic link (Email OTP) no Supabase Auth pode continuar habilitado sem
   problema — o painel simplesmente não exige mais uma sessão para funcionar.