#!/bin/bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${1:?Usage: backup.sh absolute-backup-directory}"
mkdir -p "$BACKUP_DIR"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"
chmod 700 "$BACKUP_DIR"
compose() { docker compose --env-file "$REPO_ROOT/docker/.env" -f "$REPO_ROOT/docker/docker-compose.yml" "$@"; }
# 停写后备份数据库及四类文件，退出时恢复服务；不删除任何数据卷。
compose stop devops-app devops-worker git-service
trap 'compose start git-service devops-worker devops-app >/dev/null' EXIT
compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -u root --single-transaction --routines --events --databases devops_platform gitea' > "$BACKUP_DIR/mysql.sql"
for VOLUME in platform_files audit_logs git_data git_config; do
  docker run --rm --user root -v "ai-devops_${VOLUME}:/source:ro" -v "$BACKUP_DIR:/backup" --entrypoint sh ai-devops-platform:local -c "tar -czf /backup/${VOLUME}.tgz -C /source ."
done
python3 - "$BACKUP_DIR" <<'PY'
import hashlib,json,pathlib,datetime,sys
root=pathlib.Path(sys.argv[1]); manifest={'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':{}}
for file in root.iterdir():
 if file.name!='manifest.json': manifest['files'][file.name]=hashlib.sha256(file.read_bytes()).hexdigest()
(root/'manifest.json').write_text(json.dumps(manifest,indent=2))
PY
chmod 600 "$BACKUP_DIR"/*
