-- Suíte mínima de testes (pgTAP) para as RPCs financeiras (vendas,
-- recebimentos manuais, contas a pagar) e o conflito de horário da agenda —
-- a lógica mais sensível do AppVendas e, até aqui, só validada manualmente
-- (ver backlog "Introduzir suíte mínima de teste para RPCs financeiras e
-- conflito de agenda").
--
-- Como rodar:
--   supabase test db
-- (roda contra a stack local do `supabase start`, nunca contra produção —
-- este arquivo não deve ser executado com execute_sql/apply_migration no
-- projeto real.)
--
-- Cada bloco de teste simula um usuário autenticado ajustando o claim JWT
-- que auth.uid() lê, já que criar_venda/criar_recebimento_manual/etc. são
-- SECURITY DEFINER e decidem a empresa a partir de current_empresa_id().
begin;

select plan(23);

create schema if not exists tests;

-- grant a public (sem security definer): "role" não pode ser alterado de
-- dentro de uma função security definer (Postgres bloqueia isso de
-- propósito, para uma função privilegiada não conseguir assumir outra role
-- por conta própria). Sem o grant, a primeira troca de role para
-- authenticated impediria a PRÓPRIA sessão de chamar tests.set_auth() de
-- novo (authenticated não teria USAGE no schema tests nem EXECUTE aqui).
create or replace function tests.set_auth(p_user_id uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- "reset role" (em vez de forçar role=postgres) volta para a role da
-- própria sessão (postgres, superusuário) sem exigir que "authenticated"
-- seja membro de "postgres" — o que ela nunca é, nem deveria ser.
create or replace function tests.clear_auth() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  reset role;
end;
$$;

grant usage on schema tests to public;
grant execute on function tests.set_auth(uuid) to public;
grant execute on function tests.clear_auth() to public;

-- ── Fixtures ────────────────────────────────────────────────────────────
-- Duas empresas, um caixa em cada uma, um produto e um cliente por empresa.
-- auth.users precisa da linha porque usuarios.id referencia auth.users(id).

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'caixa.a@teste.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'caixa.b@teste.local');

insert into public.empresas (id, codigo, nome_fantasia, razao_social) values
  ('00000000-0000-0000-0000-00000000ea01', 'TESTE-A', 'Empresa Teste A', 'Empresa Teste A Ltda'),
  ('00000000-0000-0000-0000-00000000ea02', 'TESTE-B', 'Empresa Teste B', 'Empresa Teste B Ltda');

insert into public.usuarios (id, nome, login, role, ativo, empresa_id) values
  ('00000000-0000-0000-0000-0000000000a1', 'Caixa A', 'caixa.a.teste', 'caixa', true, '00000000-0000-0000-0000-00000000ea01'),
  ('00000000-0000-0000-0000-0000000000b1', 'Caixa B', 'caixa.b.teste', 'caixa', true, '00000000-0000-0000-0000-00000000ea02');

insert into public.produtos (id, nome, sku, preco, estoque, empresa_id) values
  ('00000000-0000-0000-0000-0000000ea1a1', 'Produto A', 'SKU-A', 10.00, 5, '00000000-0000-0000-0000-00000000ea01'),
  ('00000000-0000-0000-0000-0000000ea1b1', 'Produto B', 'SKU-B', 20.00, 3, '00000000-0000-0000-0000-00000000ea02');

insert into public.clientes (id, nome, documento, empresa_id, status_cadastro) values
  ('00000000-0000-0000-0000-0000000ecaa1', 'Cliente A', '11111111111', '00000000-0000-0000-0000-00000000ea01', 'aprovado'),
  ('00000000-0000-0000-0000-0000000ecab1', 'Cliente B', '22222222222', '00000000-0000-0000-0000-00000000ea02', 'aprovado');

insert into public.fornecedores (id, nome, empresa_id) values
  ('00000000-0000-0000-0000-0000000ef0a1', 'Fornecedor A', '00000000-0000-0000-0000-00000000ea01'),
  ('00000000-0000-0000-0000-0000000ef0b1', 'Fornecedor B', '00000000-0000-0000-0000-00000000ea02');

-- ── criar_venda: baixa de estoque e total ────────────────────────────────

select tests.set_auth('00000000-0000-0000-0000-0000000000a1');

select lives_ok(
  $$ select public.criar_venda(
       '00000000-0000-0000-0000-0000000ecaa1', current_date, 'Dinheiro', null, 0,
       jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000ea1a1', 'quantidade', 2, 'preco_unitario', 10.00))
     ) $$,
  'criar_venda: venda com estoque suficiente deve ser aceita'
);

select is(
  (select estoque from public.produtos where id = '00000000-0000-0000-0000-0000000ea1a1'),
  3,
  'criar_venda: estoque do produto é decrementado pela quantidade vendida'
);

select is(
  (select total from public.vendas where cliente_id = '00000000-0000-0000-0000-0000000ecaa1'),
  20.00,
  'criar_venda: total da venda bate com quantidade x preço unitário'
);

select throws_ok(
  $$ select public.criar_venda(
       '00000000-0000-0000-0000-0000000ecaa1', current_date, 'Dinheiro', null, 0,
       jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000ea1a1', 'quantidade', 999, 'preco_unitario', 10.00))
     ) $$,
  null,
  'criar_venda: rejeita item com quantidade maior que o estoque disponível'
);

select throws_ok(
  $$ select public.criar_venda(
       '00000000-0000-0000-0000-0000000ecab1', current_date, 'Dinheiro', null, 0,
       jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000ea1a1', 'quantidade', 1, 'preco_unitario', 10.00))
     ) $$,
  null,
  'criar_venda: rejeita cliente de outra empresa (isolamento multiempresa)'
);

-- ── cancelar_venda: devolução de estoque e idempotência ──────────────────

select tests.set_auth('00000000-0000-0000-0000-0000000000a1');

select public.criar_venda(
  '00000000-0000-0000-0000-0000000ecaa1', current_date, 'Pix', null, 0,
  jsonb_build_array(jsonb_build_object('produto_id', '00000000-0000-0000-0000-0000000ea1a1', 'quantidade', 1, 'preco_unitario', 10.00))
) \gset venda_
-- ("venda_criar_venda" é o nome de coluna gerado pelo \gset acima)

select lives_ok(
  format('select public.cancelar_venda(%L)', :'venda_criar_venda'),
  'cancelar_venda: cancela uma venda confirmada da própria empresa'
);

select is(
  (select estoque from public.produtos where id = '00000000-0000-0000-0000-0000000ea1a1'),
  3,
  'cancelar_venda: devolve a quantidade da venda cancelada ao estoque'
);

select lives_ok(
  format('select public.cancelar_venda(%L)', :'venda_criar_venda'),
  'cancelar_venda: chamar de novo numa venda já cancelada não faz nada (idempotente)'
);

select is(
  (select estoque from public.produtos where id = '00000000-0000-0000-0000-0000000ea1a1'),
  3,
  'cancelar_venda: idempotência não devolve estoque em dobro'
);

select tests.set_auth('00000000-0000-0000-0000-0000000000b1');

select throws_ok(
  format('select public.cancelar_venda(%L)', :'venda_criar_venda'),
  null,
  'cancelar_venda: caixa de outra empresa não pode cancelar a venda'
);

-- ── criar_recebimento_manual / cancelar_recebimento_manual ───────────────

select tests.set_auth('00000000-0000-0000-0000-0000000000b1');

select public.criar_recebimento_manual(
  '00000000-0000-0000-0000-0000000ea1b1', 1, 20.00
) \gset receb_

select is(
  (select estoque from public.produtos where id = '00000000-0000-0000-0000-0000000ea1b1'),
  2,
  'criar_recebimento_manual: decrementa o estoque do produto recebido'
);

select lives_ok(
  format('select public.cancelar_recebimento_manual(%L)', :'receb_criar_recebimento_manual'),
  'cancelar_recebimento_manual: cancela um recebimento manual da própria empresa'
);

select is(
  (select estoque from public.produtos where id = '00000000-0000-0000-0000-0000000ea1b1'),
  3,
  'cancelar_recebimento_manual: devolve o estoque ao cancelar'
);

-- ── Agenda: slot único por empresa, não globalmente ──────────────────────

select tests.clear_auth();

insert into public.agendamentos (produto_id, data_agendamento, horario, empresa_id)
values ('00000000-0000-0000-0000-0000000ea1a1', current_date + 7, '09:00', '00000000-0000-0000-0000-00000000ea01');

select throws_ok(
  $$ insert into public.agendamentos (produto_id, data_agendamento, horario, empresa_id)
     values ('00000000-0000-0000-0000-0000000ea1a1', current_date + 7, '09:00', '00000000-0000-0000-0000-00000000ea01') $$,
  null,
  'agendamentos: mesmo horário no mesmo dia na MESMA empresa é rejeitado (slot único)'
);

select lives_ok(
  $$ insert into public.agendamentos (produto_id, data_agendamento, horario, empresa_id)
     values ('00000000-0000-0000-0000-0000000ea1b1', current_date + 7, '09:00', '00000000-0000-0000-0000-00000000ea02') $$,
  'agendamentos: o mesmo horário no mesmo dia em OUTRA empresa é permitido'
);

-- ── criar_conta_pagar / registrar_pagamento_conta_pagar / cancelar_conta_pagar

select tests.set_auth('00000000-0000-0000-0000-0000000000a1');

select public.criar_conta_pagar(
  '00000000-0000-0000-0000-0000000ef0a1', 'Compra de mercadorias', 500.00, current_date + 15
) \gset cp_

select is(
  (select status from public.contas_pagar where id = :'cp_criar_conta_pagar'),
  'pendente',
  'criar_conta_pagar: conta nasce com status pendente'
);

select throws_ok(
  $$ select public.criar_conta_pagar(
       '00000000-0000-0000-0000-0000000ef0b1', 'Fornecedor de outra empresa', 100.00, current_date + 10
     ) $$,
  null,
  'criar_conta_pagar: rejeita fornecedor de outra empresa (isolamento multiempresa)'
);

select lives_ok(
  format('select public.registrar_pagamento_conta_pagar(%L)', :'cp_criar_conta_pagar'),
  'registrar_pagamento_conta_pagar: registra o pagamento de uma conta pendente'
);

select is(
  (select status from public.contas_pagar where id = :'cp_criar_conta_pagar'),
  'pago',
  'registrar_pagamento_conta_pagar: status vira pago'
);

select throws_ok(
  format('select public.registrar_pagamento_conta_pagar(%L)', :'cp_criar_conta_pagar'),
  null,
  'registrar_pagamento_conta_pagar: rejeita pagar uma conta que já foi paga'
);

select public.criar_conta_pagar(
  '00000000-0000-0000-0000-0000000ef0a1', 'Segunda conta', 200.00, current_date + 20
) \gset cp2_

select lives_ok(
  format('select public.cancelar_conta_pagar(%L)', :'cp2_criar_conta_pagar'),
  'cancelar_conta_pagar: cancela uma conta pendente da própria empresa'
);

select lives_ok(
  format('select public.cancelar_conta_pagar(%L)', :'cp2_criar_conta_pagar'),
  'cancelar_conta_pagar: chamar de novo numa conta já cancelada não faz nada (idempotente)'
);

select tests.set_auth('00000000-0000-0000-0000-0000000000b1');

select throws_ok(
  format('select public.cancelar_conta_pagar(%L)', :'cp2_criar_conta_pagar'),
  null,
  'cancelar_conta_pagar: caixa de outra empresa não pode cancelar a conta'
);

select * from finish();

rollback;
