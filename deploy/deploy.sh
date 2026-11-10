#!/usr/bin/env bash
# Copia il progetto sulla VPS e (ri)avvia il container.
# Uso: deploy/deploy.sh utente@ip-vps [dominio]
set -euo pipefail
TARGET="${1:?Uso: deploy/deploy.sh utente@ip-vps [dominio]}"
DOMAIN="${2:-bwt.sbagiuzza.it}"
DEST=/opt/bwt-wrestling
# chiave SSH dedicata alla VPS, se presente (altrimenti quella predefinita / password)
KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_vps}"
SSH=(ssh)
[ -f "$KEY" ] && SSH=(ssh -i "$KEY")
cd "$(dirname "$0")/.."

"${SSH[@]}" "$TARGET" "sudo mkdir -p $DEST && sudo chown \$(id -u):\$(id -g) $DEST"
rsync -az --delete -e "${SSH[*]}" \
  --exclude node_modules --exclude dist --exclude .git --exclude .claude --exclude .env --exclude "*.fbx" \
  ./ "$TARGET:$DEST/"
"${SSH[@]}" "$TARGET" "cd $DEST && printf 'DOMAIN=%s\n' $DOMAIN > .env && docker compose -f docker-compose.vps.yml up -d --build && docker ps --filter name=bwt-wrestling --format '{{.Names}} {{.Status}}'"
echo "Fatto: https://$DOMAIN (il certificato può richiedere un minuto la prima volta)"
