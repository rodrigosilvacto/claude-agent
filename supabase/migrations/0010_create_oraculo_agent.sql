-- Agente Oráculo: conselhos pessoais e profissionais via WhatsApp (Z-API),
-- respondidos pela API da Anthropic. Histórico de conversa persistido por
-- telefone para dar contexto ao longo do tempo.
--
-- Estas tabelas só são tocadas pela edge function `oraculo-webhook`
-- (service role) — quem chama o webhook é o Z-API, não um usuário logado no
-- Supabase Auth. Por isso RLS fica habilitada sem nenhuma policy: nem
-- `anon` nem `authenticated` enxergam essas tabelas, só a service role
-- (que ignora RLS).

create table public.oraculo_conversas (
  id uuid primary key default gen_random_uuid(),
  telefone text not null unique,
  nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table public.oraculo_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.oraculo_conversas(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  conteudo text not null,
  -- id da mensagem no Z-API, usado para dedup quando o webhook reentrega a
  -- mesma mensagem (retry). Nulo para mensagens do assistente.
  zapi_message_id text,
  criado_em timestamptz not null default now()
);

create index oraculo_mensagens_conversa_id_idx on public.oraculo_mensagens (conversa_id, criado_em);

create unique index oraculo_mensagens_zapi_message_id_idx
  on public.oraculo_mensagens (zapi_message_id)
  where zapi_message_id is not null;

alter table public.oraculo_conversas enable row level security;
alter table public.oraculo_mensagens enable row level security;
