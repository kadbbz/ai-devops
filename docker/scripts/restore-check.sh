#!/bin/bash
set -euo pipefail
RESTORE_STARTED=$(date +%s)
BACKUP_DIR="${1:?Usage: restore-check.sh absolute-backup-directory}"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
# 恢复到独立卷和独立 MySQL，避免覆盖正在使用的数据。
RECOVERY_NAME="devops-restore-$(date +%s)"
python3 - "$BACKUP_DIR" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1]); m=json.loads((p/'manifest.json').read_text())
for name,expected in m['files'].items():
 assert hashlib.sha256((p/name).read_bytes()).hexdigest()==expected,name
print('Backup checksums verified')
PY
MYSQL_IMAGE='public.ecr.aws/docker/library/mysql:8.4.6@sha256:869218921e61d6c3c89820955d63cca42971f0e3e6c1e2792247bbd944ebc6e9'
docker run -d --name "$RECOVERY_NAME" --network none -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -v "${RECOVERY_NAME}-mysql:/var/lib/mysql" "$MYSQL_IMAGE" >/dev/null
trap 'docker stop --time 30 "$RECOVERY_NAME" >/dev/null' EXIT
for i in $(seq 1 60); do
  if docker exec "$RECOVERY_NAME" mysqladmin ping -h 127.0.0.1 -u root --silent >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec -i "$RECOVERY_NAME" mysql -u root < "$BACKUP_DIR/mysql.sql"
docker exec "$RECOVERY_NAME" mysql -u root -e 'SELECT COUNT(*) AS restored_projects FROM devops_platform.projects; SELECT COUNT(*) AS restored_runs FROM devops_platform.agent_runs; SELECT COUNT(*) AS restored_git_repositories FROM gitea.repository;'
for VOLUME in platform_files audit_logs git_data git_config; do
  docker run --rm --user root -v "${RECOVERY_NAME}-${VOLUME}:/target" -v "$BACKUP_DIR:/backup:ro" --entrypoint sh ai-devops-platform:local -c "tar -xzf /backup/${VOLUME}.tgz -C /target"
done
printf 'Data restore elapsed seconds: %s\n' "$(( $(date +%s) - RESTORE_STARTED ))"
printf 'Restored isolated volume prefix: %s\n' "$RECOVERY_NAME"
