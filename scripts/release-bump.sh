#!/usr/bin/env bash
#
# Copyright (c) VA360 LABS S.L.
# SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
#
# Bump de versión para cortar release: pone la versión NUEVA en TODOS los
# sitios del repo que la llevan escrita, y falla si en alguno queda la vieja.
#
# Nació de dos fósiles reales: el README llevaba `alpha.107` en sus ejemplos
# de `docker pull` mientras el resto del repo iba por la 114 (el ritual de
# bump era un sed a mano sobre 10 ficheros y el README no estaba en la lista),
# y release.yml ahora ABORTA si el tag no coincide con package.json — este
# script es la otra mitad de esa guarda.
#
# Uso (desde la raíz del repo):
#   bash scripts/release-bump.sh 0.1.0-beta.2
#   git add -A && git commit -m "chore(release): 0.1.0-beta.2"
#   git tag v0.1.0-beta.2 && git push origin develop v0.1.0-beta.2
set -euo pipefail

NEW="${1:?uso: release-bump.sh <version-nueva, sin 'v'>}"
[[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-(alpha|beta|rc)\.[0-9]+)?$ ]] ||
  { echo "ERROR: '$NEW' no es una versión válida (X.Y.Z[-canal.N])" >&2; exit 1; }

OLD="$(node -p "require('./package.json').version")"
[[ "$OLD" != "$NEW" ]] || { echo "Ya estamos en $NEW; nada que hacer."; exit 0; }

# La lista CERRADA de ficheros que llevan la versión escrita. Si añades uno,
# añádelo aquí: la verificación de abajo es la que impide que se fosilice.
FILES=(
  .github/ISSUE_TEMPLATE/bug.yml
  README.md
  README.en.md
  deploy/coolify/docker-compose.yaml
  deploy/dokploy/docker-compose.yml
  deploy/dokploy/meta.json
  deploy/dokploy/template.toml
  deploy/easypanel/didacta.json
  deploy/easypanel/meta.yaml
  docker-compose.alpha.yml
  install.sh
  package.json
)

echo "Bump ${OLD} → ${NEW}"
ESCAPED_OLD="${OLD//./\\.}"
for f in "${FILES[@]}"; do
  if grep -q "$ESCAPED_OLD" "$f"; then
    sed -i "s/${ESCAPED_OLD}/${NEW}/g" "$f"
    echo "  · $f"
  fi
done

# Ningún fichero versionado puede quedarse con la versión vieja — tampoco los
# que NO están en la lista (así se detecta un sitio nuevo que alguien añadió).
LEFTOVERS="$(git grep -l "$OLD" -- ':!pnpm-lock.yaml' ':!CHANGELOG.md' || true)"
if [[ -n "$LEFTOVERS" ]]; then
  echo "ERROR: la versión vieja ${OLD} sigue apareciendo en:" >&2
  echo "$LEFTOVERS" >&2
  exit 1
fi

echo "Hecho. Revisa el diff, commitea 'chore(release): ${NEW}' y tagea v${NEW}."
