# claude-agent

## Painel de Reports (`/reports`)

Painel interno para centralizar reports (PDF/DOCX/MD/TXT/HTML, incluindo
dashboards gerados pelo Claude): upload com tema/tags, busca/filtro,
compartilhamento por link e dashboard de indicadores. Stack: HTML/JS
estático + Supabase (Auth, Postgres, Storage, Edge Functions), mesmo padrão
do `index.html` na raiz.

> **Sem resumo automático (removido):** a geração de resumo via Claude foi
> removida do MVP por depender de deploy de edge function + secret da
> Anthropic, o que estava travando o fluxo de upload. As colunas
> `summary`/`summary_status` continuam na tabela `reports` mas não são mais
> usadas pelo frontend. Se quiser reativar, a lógica original está no
> histórico do git (função `generate-summary` e botão "Reprocessar").

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
2. Deploy da Edge Function `supabase/functions/share-report` (usada pelo
   link de compartilhamento).
3. Magic link (Email OTP) no Supabase Auth pode continuar habilitado sem
   problema — o painel simplesmente não exige mais uma sessão para funcionar.

### Hospedagem (GitHub Pages) e cache

O painel é servido via GitHub Pages a partir deste repositório. `styles.css`,
`app.js` e `supabaseClient.js` são referenciados com `?v=N` (ex:
`./assets/app.js?v=3`) para forçar o navegador a buscar a versão nova depois
de cada deploy — sem isso, o CDN do GitHub Pages e o cache do navegador podem
continuar servindo a versão antiga por vários minutos mesmo depois do merge.
**Sempre que alterar `styles.css`, `app.js` ou `supabaseClient.js`, incremente
esse número em todos os arquivos que os referenciam** (`index.html`,
`login.html`, `share.html`, e o `import` dentro do próprio `app.js`).