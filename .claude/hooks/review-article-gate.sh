#!/usr/bin/env bash
# PostToolUse hook (Write|Edit): whenever a file under posts/ or a root-level
# *.md file (excluding README.md) is written/edited, inject a reminder telling
# Claude to run the revisor-cto subagent before committing/pushing/opening a PR.
set -euo pipefail

input="$(cat)"
file_path="$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' <<<"$input")"
[ -z "$file_path" ] && exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && exit 0

rel_path="$(python3 -c "
import os, sys
try:
    print(os.path.relpath(sys.argv[1], sys.argv[2]))
except Exception:
    print('')
" "$file_path" "$repo_root")"
[ -z "$rel_path" ] && exit 0

is_article=0
case "$rel_path" in
  posts/*.md)
    is_article=1
    ;;
  README.md)
    is_article=0
    ;;
  *.md)
    case "$rel_path" in
      */*) is_article=0 ;;
      *)   is_article=1 ;;
    esac
    ;;
esac

[ "$is_article" -eq 0 ] && exit 0

reason="O arquivo '$rel_path' é um artigo/post. Antes de prosseguir: (1) invoque o subagente 'revisor-cto' (Agent tool, subagent_type=revisor-cto) passando o caminho deste arquivo, para revisão de texto, escrita, ortografia e formatação sob a ótica de um CTO/CIO; (2) se o veredito for APROVADO, faça commit, push e abra a Pull Request automaticamente, sem pedir confirmação ao usuário; (3) se o veredito for MUDANÇAS_NECESSÁRIAS, aplique as correções e repita a revisão antes de abrir qualquer PR."

jq -n --arg reason "$reason" '{
  "systemMessage": "Artigo detectado — revisão automática (revisor-cto) necessária antes do commit/PR.",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $reason
  }
}'
