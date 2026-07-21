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

> Esta seção é específica do Reports Panel — não confundir com o AppVendas
> logo abaixo, que segue uma regra diferente e mais restrita (ver "Cache do
> `app.js`" na seção AppVendas): lá, só `styles.css` é versionado com
> `?v=N`; o entry point e os imports internos (`app.js`, `supabaseClient.js`)
> não podem ser, sob pena de duplicar a instância do módulo.

## AppVendas (`/appvendas`)

Aplicação corporativa de gestão de vendas: menu lateral com **Cadastros**
(Clientes, Produtos, Fornecedores), **Movimentações** (Vendas e
Agendamento) e **Relatórios**. Mesmo padrão do resto do repo: HTML/JS
estático + Supabase, sem build, no projeto `ClaudeProjects`.

- `appvendas/index.html` — shell com sidebar, roteamento por hash
  (`#/clientes`, `#/produtos`, `#/fornecedores`, `#/vendas`, `#/agenda`,
  `#/relatorios`).
- `appvendas/assets/cadastro.js` — motor genérico de CRUD (listar, buscar,
  criar/editar via modal, excluir) reaproveitado por `clientes.js`,
  `produtos.js` e `fornecedores.js`, que só configuram campos e colunas.
- `appvendas/assets/vendas.js` — tela de "Vendas" (grupo Movimentações):
  monta o carrinho (produto + quantidade), finaliza a venda via RPC
  `criar_venda` e lista o histórico com detalhe (recibo) e cancelamento
  (RPC `cancelar_venda`).
- `appvendas/assets/agenda.js` — tela de "Agendamento" (item próprio no
  menu, dentro do grupo Movimentações, fora da tela de Vendas): agenda
  de atendimentos por cliente/produto com visão dia/semana/mês sobre a
  tabela `agendamentos`
  (`data_agendamento`, `horario`, `status` "agendado"/"atendido",
  `cliente_id`, `produto_id`, `observacoes`).
- `appvendas/assets/relatorios.js` — faturamento, ticket médio, produtos
  mais vendidos, melhores clientes e estoque baixo.

**Banco (migration `0004_create_appvendas_schema.sql`, já aplicada no
projeto `ClaudeProjects`):** tabelas `clientes`, `fornecedores`, `produtos`,
`vendas`, `venda_itens`. A baixa e devolução de estoque acontecem dentro
de funções Postgres (`criar_venda`/`cancelar_venda`, `security definer`)
para garantir atomicidade: se algum item não tiver estoque suficiente, a
venda inteira é revertida. A tabela `agendamentos` (usada por `agenda.js`)
**não tem migration correspondente neste repositório** — foi criada
diretamente no projeto Supabase; vale registrar essa migration
retroativamente se mexer no schema de novo.

> **Login real desde a migration `0005`** (esta seção descrevia "sem
> login/RLS pública" — isso valia só para o schema inicial da `0004` e
> ficou desatualizado). Hoje o acesso exige sessão (usuário/senha, ver
> `auth.js`) e RLS multiempresa por `empresa_id`: um usuário normal só
> enxerga/edita dados da própria empresa; `role = 'admin'` **sem**
> `empresa_id` (admin "global") enxerga todas. A migration `0020` fechou um
> escalonamento de privilégio em que um admin vinculado a uma única empresa
> conseguia se promover a admin global ou mexer em usuários/empresas de
> fora da própria — ver `supabase/functions/manage-usuarios/index.ts` e as
> policies de `usuarios`/`empresas`. Por isso a tela **Empresas** (menu
> Administração) passou a exigir admin global, mesmo racional que já valia
> para **Configurações**.

> **Criação do primeiro admin exige um segredo de bootstrap:** com a
> tabela `usuarios` vazia, `manage-usuarios` aceita criar o primeiro
> administrador sem sessão (ninguém consegue estar logado ainda) — mas só
> se o payload incluir `bootstrap_secret` batendo com a secret
> `APPVENDAS_BOOTSTRAP_SECRET` do projeto Supabase. Configure com
> `supabase secrets set APPVENDAS_BOOTSTRAP_SECRET=<string aleatória sua>`
> **antes** de fazer o setup inicial, e chame a function uma vez (ex. via
> `curl`) com esse valor. Sem a secret configurada, a criação do primeiro
> admin é sempre rejeitada.

> **Conta de teste (role `caixa`):** existe uma conta de teste (`qa.appvendas`)
> usada para validar telas end-to-end (Vendas, Agendamento) sem usar uma
> conta pessoal — a senha está no gerenciador de senhas interno, não neste
> arquivo. Rotacionar/remover antes de abrir o app além do piloto interno.

### Lembretes e cobranças (`supabase/functions/appvendas-lembretes`)

Comunicação proativa com o aluno — antes o app era 100% reativo (nada
avisava ninguém fora de alguém abrir o painel). Dois lembretes automáticos:

- **Lembrete de aula:** no dia anterior, para agendamentos com status
  `agendado` e cliente vinculado (tabela `agendamentos`, coluna
  `lembrete_enviado_em` controla que cada agendamento só recebe um lembrete).
- **Cobrança de parcela vencida:** para parcelas de matrícula `pendente`
  com vencimento no passado, reenviada a cada 3 dias enquanto continuar em
  aberto (`matricula_parcelas.cobranca_enviada_em`).

Cada lembrete tenta WhatsApp primeiro (se o cliente tiver telefone) e cai
para e-mail (se tiver e-mail); sem nenhum dos dois, só marca como
processado para não ficar reprocessando.

> **Reaproveita a infra do Oráculo (Z-API/Resend), de propósito:** não são
> secrets novas — é o mesmo número de WhatsApp já conectado
> (`ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`) e a mesma conta
> Resend (`RESEND_API_KEY`) usados pelo `oraculo-webhook`. Isso foi uma
> escolha deliberada — o roadmap já descrevia essa infra como "pronta,
> ociosa" para o AppVendas — não uma obrigação: se fizer mais sentido ter um
> número de WhatsApp Business dedicado ao AppVendas (separado do Oráculo,
> que dá conselhos pessoais a quem escrever), basta apontar
> `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN` para uma instância própria nas secrets do
> projeto.

**Setup:**

1. Aplicar a migration `supabase/migrations/0021_faixa_roxa_comunicacao_e_presenca.sql`.
2. Deploy sem verificação de JWT (quem chama é o scheduler, não um cliente
   Supabase autenticado — mesmo racional de `oraculo-webhook`):
   ```
   supabase functions deploy appvendas-lembretes --no-verify-jwt
   ```
3. Configurar a secret própria do endpoint (além das já existentes
   `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`/`RESEND_API_KEY`, que
   provavelmente já estão configuradas para o Oráculo):
   ```
   supabase secrets set APPVENDAS_LEMBRETES_SECRET=<string aleatória sua>
   ```
4. **Agendar a chamada — a function não tem cron embutido, só processa o
   que encontrar quando é chamada.** Duas opções:
   - Supabase Cron (Database → Cron Jobs no painel, usa `pg_cron` +
     `pg_net`): agendar um `POST`/`GET` diário para
     `https://<seu-projeto>.supabase.co/functions/v1/appvendas-lembretes?secret=<APPVENDAS_LEMBRETES_SECRET>`.
   - Um scheduler externo (cron-job.org, GitHub Actions com `schedule`,
     etc.) apontando pra essa mesma URL 1x por dia.

### Badges de pendência no menu, renovar matrícula e check-in de presença

- **Badges no menu** (`app.js`, `refreshPendencyBadges`): contador de
  parcelas vencidas ao lado de "Contas a Receber" e de produtos com estoque
  baixo ao lado de "Estoques", atualizados a cada minuto — antes só
  apareciam abrindo o painel Início.
- **Renovar matrícula** (`matriculas.js`, botão no detalhe): pré-preenche
  uma nova matrícula com cliente, curso, duração, parcelas e forma de
  pagamento da matrícula original, reaproveitando o mesmo mecanismo de
  prefill já usado no fluxo Agenda → Matrículas.
- **Check-in de presença** (`agenda.js`, coluna
  `agendamentos.presenca_confirmada`): registro de frequência do aluno
  independente do status agendado/atendido — que hoje só muda quando o
  atendimento vira venda ou matrícula.

> **"Estoque baixo" contava serviço (bug corrigido):** as telas de Início,
> Estoques e o badge do menu comparavam `estoque <= estoque_minimo` para
> **todos** os produtos ativos, sem excluir `tipo = 'servico'` (curso/
> mensalidade — nunca recebe entrada de estoque, ver migration 0017). Um
> serviço com `estoque` zerado por padrão ficava marcado como "baixo" pra
> sempre. `relatorios.js` já filtrava certo (`tipo === "produto"`); as
> outras três telas foram corrigidas para o mesmo filtro.

### Agendamento público (`appvendas/agendamento-publico.html`)

Segunda via de marcar um atendimento na Agenda, além de um funcionário
criar direto na tela interna: um link público (sem login) que qualquer
pessoa com acesso pode usar para agendar um **serviço** (curso/mensalidade
— nunca produto físico) sozinha. Botão "Link de agendamento" na tela
Agenda abre o link numa nova aba (e tenta copiar pra área de transferência).

- `appvendas/agendamento-publico.html` / `appvendas/assets/agendamento-publico.js`
  — mesmo padrão de `pre-cadastro.html`: HTML/JS isolado, sem `app.js`/
  `auth.js`, com honeypot + tempo mínimo de preenchimento contra spam.
- **Banco (migration `0022_agendamento_publico.sql`):** três RPCs
  `security definer` liberadas para `anon` — `agenda_publica_info`
  (nome da empresa, grade de horários, catálogo de serviços),
  `horarios_ocupados_publico` (pra desabilitar horário já tomado antes de
  enviar) e `agendar_publico` (cria o agendamento e, se o CPF/CNPJ ainda
  não existir na base, um cliente novo com `status_cadastro = 'pendente'`
  — mesmo fluxo de revisão do pré-cadastro). Valida servidor-side que o
  horário está na grade configurada da empresa e que o produto é
  `tipo = 'servico'`; limite de 30 agendamentos por empresa a cada 10
  minutos contra abuso (mesmo racional de `pre_cadastro_cliente`, mas mais
  crítico aqui — spam nesta rota ocupa horários de verdade, não só cria
  cadastros pendentes).
- Testado manualmente ponta a ponta como papel `anon` num Postgres local:
  código de empresa inválido, produto físico rejeitado, conflito de
  horário rejeitado, horário fora da grade rejeitado, e reagendar com o
  mesmo documento reaproveita o cliente em vez de duplicar.

### Cache do `app.js` — NÃO adicione `?v=N` no `<script>` de entrada

Ao contrário do Reports Panel (ver seção seguinte), o `<script>` de entrada
de `appvendas/index.html` **não pode** ter um especificador versionado
(`./assets/app.js?v=N`). Todo o resto do app importa `app.js` sem versão
(`import { ... } from "./app.js"` em `vendas.js`, `agenda.js`, `clientes.js`,
`login.js` etc.) — o ES modules identifica um módulo pela URL exata do
import, então um entry point com `?v=` cria uma **segunda instância**
separada do módulo, com seus próprios efeitos colaterais de topo (listener
de `hashchange`, `boot()`) rodando em paralelo com estado independente.
Isso já causou fetches/renders duplicados (corrigido no commit `e4f8448`) e
foi reintroduzido e revertido de novo em `3659424`/`e75bd3a` — se a ideia de
versionar o entry point voltar a parecer boa, é armadilha, não melhoria.

Para diagnosticar cache antigo sem versionar o script: a sidebar mostra
`build <APP_BUILD>` (constante em `assets/app.js`, exibida via
`#sidebar-build` em `index.html`). Se a data não bater com o timestamp do
último commit em `app.js`, é cache do navegador/CDN do GitHub Pages — peça
um hard refresh (Ctrl+Shift+R), não mexa no `<script src>`.

## Oráculo — conselhos via WhatsApp (`supabase/functions/oraculo-webhook`)

Agente que dá conselhos pessoais e profissionais por WhatsApp. Sem painel
web — a interface é a própria conversa no WhatsApp. Fluxo: Z-API recebe a
mensagem no número conectado e chama o webhook (Edge Function
`oraculo-webhook`); a function busca o histórico da conversa, chama a API
da Anthropic (`claude-sonnet-5`) para gerar a resposta, salva o histórico e
manda a resposta de volta pelo Z-API.

- **Banco (migration `0010_create_oraculo_agent.sql`):** tabelas
  `oraculo_conversas` (uma linha por telefone) e `oraculo_mensagens`
  (histórico, `role` `user`/`assistant`). RLS habilitada **sem nenhuma
  policy** — só a service role (usada dentro da function) acessa; nem
  `anon` nem `authenticated` enxergam essas tabelas.
- **Aberto a qualquer número** que mandar mensagem para o WhatsApp
  conectado (não há allowlist). Para conter custo/abuso da API paga da
  Anthropic, há rate limit de **20 mensagens por conversa a cada 15
  minutos** — acima disso o Oráculo responde pedindo para aguardar, sem
  chamar a Anthropic.
- **Texto e voz:** mensagem de texto gera resposta em texto. Mensagem de
  áudio é transcrita pela API de speech-to-text da ElevenLabs (`scribe_v2`)
  antes de entrar no fluxo normal, e a resposta é sintetizada de volta em
  áudio pela API de text-to-speech da ElevenLabs (`eleven_multilingual_v2`,
  mp3) e enviada como voice note pelo Z-API. Se a transcrição falhar, o
  Oráculo pede para gravar de novo ou escrever; se a síntese/envio de voz
  falhar, a resposta cai para texto em vez de se perder. Imagem e documento
  ainda não são processados — geram uma resposta automática pedindo texto
  ou áudio.
- **Idempotência:** o `messageId` do Z-API é gravado em
  `zapi_message_id` (unique index parcial); se o Z-API reentregar a mesma
  mensagem (retry), o insert é rejeitado e nada é reprocessado nem
  reenviado ao usuário.
- **Resumo por e-mail a pedido do usuário:** a Anthropic tem a ferramenta
  `enviar_resumo_admin` disponível em toda mensagem, mas só a chama quando o
  usuário pede explicitamente para mandar um resumo/relatório da conversa
  para o administrador (ex: "manda um resumo disso pro suporte"). Não há
  envio automático nem periódico — é sempre a pedido, dentro da própria
  conversa. Quando chamada, a function busca o histórico completo daquela
  conversa (não só a janela de `HISTORICO_LIMITE`) e pede à Anthropic, numa
  chamada separada, para **separar a conversa por assunto** (ex: carreira,
  relacionamento, finanças) — cada assunto identificado entra no e-mail com
  seu próprio resumo + conclusão sobre o desfecho. Uma conversa de assunto
  único gera só um bloco. O e-mail é mandado via Resend para
  `ORACULO_RESUMO_EMAIL`. Se falhar em qualquer etapa, o Oráculo avisa o
  usuário em vez de fingir que enviou.
  > **Entregabilidade:** o remetente usado é o sandbox `onboarding@resend.dev`
  > (sem domínio próprio verificado). A Resend confirma entrega
  > (`last_event: "delivered"`), mas provedores como Hotmail/Outlook podem
  > descartar ou filtrar silenciosamente e-mails desse remetente sem
  > reputação de domínio própria — se o e-mail não aparecer nem no Spam,
  > isso é o motivo mais provável. Verificar um domínio próprio no Resend e
  > trocar a constante `RESEND_FROM` resolve isso definitivamente.

### Setup

1. Aplicar a migration `supabase/migrations/0010_create_oraculo_agent.sql`.
2. Deploy da function **sem verificação de JWT** (quem chama é o Z-API, não
   um cliente Supabase autenticado — mesmo racional de `mcp-cep` e
   `share-report`):
   ```
   supabase functions deploy oraculo-webhook --no-verify-jwt
   ```
3. Configurar as secrets no projeto Supabase (`ClaudeProjects`):
   ```
   supabase secrets set \
     ANTHROPIC_API_KEY=sk-ant-... \
     ZAPI_INSTANCE_ID=... \
     ZAPI_TOKEN=... \
     ZAPI_CLIENT_TOKEN=... \
     ORACULO_WEBHOOK_SECRET=<string aleatória sua> \
     ELEVENLABS_API_KEY=... \
     ELEVENLABS_VOICE_ID=<id da voz escolhida na sua conta ElevenLabs> \
     RESEND_API_KEY=re_... \
     ORACULO_RESUMO_EMAIL=rodrigosilvapmp@hotmail.com
   ```
   `ANTHROPIC_API_KEY` provavelmente já existe (usada pelo gerador de
   LinkedIn) — só falta configurar as demais se ainda não existirem.
   `ELEVENLABS_VOICE_ID` é o id de uma voz da sua biblioteca na ElevenLabs
   (painel ElevenLabs → Voices → copiar o Voice ID). O remetente do e-mail
   usado no código é o sandbox `onboarding@resend.dev`, que só entrega para
   o e-mail cadastrado na própria conta Resend — por isso `ORACULO_RESUMO_EMAIL`
   precisa ser esse mesmo e-mail, a menos que um domínio próprio seja
   verificado no Resend (nesse caso, troque a constante `RESEND_FROM` em
   `supabase/functions/oraculo-webhook/index.ts`).
4. No painel do Z-API, configurar a URL de webhook "ao receber mensagem"
   apontando para:
   ```
   https://<seu-projeto>.supabase.co/functions/v1/oraculo-webhook?secret=<ORACULO_WEBHOOK_SECRET>
   ```
   O `?secret=` é a única camada de autenticação do endpoint (Z-API não
   assina o payload) — sem ele batendo com `ORACULO_WEBHOOK_SECRET`, a
   function responde `401` e não processa nada.

> **Custo:** o endpoint está aberto para qualquer número que mandar
> mensagem para o WhatsApp conectado, e cada resposta consome créditos da
> API da Anthropic — e, quando a conversa é por voz, também créditos de
> speech-to-text e text-to-speech da ElevenLabs. Pedir repetidamente o envio
> de resumo (`enviar_resumo_admin`) soma mais uma chamada à Anthropic e um
> envio pelo Resend por pedido — mesmo rate limit por conversa cobre esse
> caso. O rate limit por conversa é a única mitigação no MVP — se o volume
> crescer, vale revisitar (allowlist, captcha, limite global).