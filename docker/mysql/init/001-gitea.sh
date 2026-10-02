#!/bin/bash
set -euo pipefail
# 限制初始化密码字符，避免 SQL 拼接转义歧义；建议使用随机十六进制值。
[[ "$GITEA_DB_PASSWORD" =~ ^[a-zA-Z0-9_-]{16,}$ ]] || { echo 'GITEA_DB_PASSWORD must contain at least 16 safe characters'; exit 1; }
MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -u root <<SQL
CREATE DATABASE IF NOT EXISTS gitea CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'gitea'@'%' IDENTIFIED BY '$GITEA_DB_PASSWORD';
GRANT ALL PRIVILEGES ON gitea.* TO 'gitea'@'%';
SQL
