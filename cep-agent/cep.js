#!/usr/bin/env node

function normalizeCep(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length !== 8) {
    throw new Error(`CEP inválido: "${input}". Informe 8 dígitos, ex: 01001000 ou 01001-000.`);
  }
  return digits;
}

async function consultarCep(cep) {
  const cepLimpo = normalizeCep(cep);
  const url = `https://viacep.com.br/ws/${cepLimpo}/json/`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Falha na requisição ao ViaCEP (status ${res.status}).`);
  }

  const data = await res.json();
  if (data.erro) {
    throw new Error(`CEP ${cepLimpo} não encontrado.`);
  }

  return data;
}

function formatarEndereco(data) {
  return [
    `CEP:          ${data.cep}`,
    `Logradouro:   ${data.logradouro || "-"}`,
    `Complemento:  ${data.complemento || "-"}`,
    `Bairro:       ${data.bairro || "-"}`,
    `Cidade:       ${data.localidade || "-"}`,
    `UF:           ${data.uf || "-"}`,
    `IBGE:         ${data.ibge || "-"}`,
    `DDD:          ${data.ddd || "-"}`,
  ].join("\n");
}

async function main() {
  const cep = process.argv[2];
  if (!cep) {
    console.error("Uso: node cep.js <CEP>");
    console.error("Exemplo: node cep.js 01001000");
    process.exit(1);
  }

  try {
    const data = await consultarCep(cep);
    console.log(formatarEndereco(data));
  } catch (err) {
    console.error(`Erro: ${err.message}`);
    process.exit(1);
  }
}

main();
