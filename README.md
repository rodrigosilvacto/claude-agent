# claude-agent

## Gerador de post para LinkedIn (`/linkedin`)

Página com um formulário (tema + tom) que chama a Edge Function
`generate-linkedin-post` (agente 1, escritor), a qual usa a API da Anthropic
(modelo `claude-opus-4-8`) para gerar o texto do post. Mesmo padrão do
`index.html` na raiz: HTML/JS estático + Supabase.

**Dois agentes em cadeia:** depois de gerar o texto, `generate-linkedin-post`
chama internamente (via HTTP, function-to-function) a Edge Function
`grade-linkedin-post` (agente 2, avaliador), que classifica o post em uma de
quatro categorias e devolve o resultado junto com o texto:
- `executivo` — texto executivo bem formatado, com nota de 1 a 10
- `tecnico` — texto técnico bem formatado, com nota de 1 a 10
- `pessimo` — texto péssimo (sem nota)
- `reescrever` — precisa de revisão antes de publicar (sem nota)

A nota aparece na tela logo abaixo do texto gerado. Se a chamada ao agente
avaliador falhar, o post ainda é exibido normalmente (a nota só some da
tela).

**Feedback iterativo:** abaixo da nota há um campo para o usuário pedir
ajustes (ex: "deixe mais curto"). Ao clicar em "Gerar novo texto com esse
feedback", o front-end chama `generate-linkedin-post` de novo enviando
`feedback` + o texto atual (`previousPost`); o agente escritor reescreve o
post em cima disso (em vez de partir do zero) e o agente avaliador roda de
novo sobre o texto revisado. Pode repetir quantas vezes quiser.

> **Requer a secret `ANTHROPIC_API_KEY`** configurada no projeto Supabase
> (`ClaudeProjects`) para as duas Edge Functions funcionarem — configure com
> `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...` (via CLI, com o projeto
> linkado) ou pelo dashboard do Supabase em Project Settings → Edge Functions
> → Secrets. Sem essa secret, as functions respondem com erro 502.

## Painel de Reports (`/reports`)

Painel interno para centralizar dashboards em HTML gerados pelo Claude:
upload com tema/tags, visualização renderizada (o HTML/JS é executado em
tela, não só linkado), busca/filtro, compartilhamento por link e dashboard
de indicadores. Stack: HTML/JS estático + Supabase (Auth, Postgres,
Storage, Edge Functions), mesmo padrão do `index.html` na raiz.

> **Só HTML (`.html`/`.htm`):** o upload aceita exclusivamente arquivos
> HTML — PDF/DOCX/MD/TXT foram removidos do escopo. O caso de uso é anexar
> dashboards que o Claude gera, então "visualizar" precisa executar o
> arquivo na tela (iframe), o que só faz sentido para HTML.

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
   link de compartilhamento). **No projeto atual ela está deployada sob o
   slug `rapid-worker`** (o slug é fixado na criação e não pode ser
   renomeado depois) — por isso `reports/share.html` chama
   `supabase.functions.invoke("rapid-worker", ...)` em vez de
   `"share-report"`. Se você recriar essa function do zero com o nome
   correto, atualize a constante `SHARE_FUNCTION_NAME` em `share.html`.
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

O topo do painel (`reports/index.html`) também mostra dois horários de
"deploy": um fixo no HTML (`index.html`) e outro escrito via JS
(`APP_JS_BUILD`, em `assets/app.js`). Servem para diagnosticar cache: se o
que aparece na tela estiver desatualizado em relação ao último commit, é
cache do CDN/navegador, não bug de código. **Sempre que alterar `index.html`
ou `app.js`, atualize esses dois timestamps também** (mesma lógica do `?v=N`).