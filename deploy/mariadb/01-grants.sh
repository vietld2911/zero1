#!/bin/sh
# Chạy một lần khi khởi tạo volume DB: cấp quyền cho user ứng dụng trên 3 database zero1_*
# (migration tự CREATE DATABASE nếu chưa có).
mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" <<SQL
GRANT ALL PRIVILEGES ON \`zero1\_%\`.* TO '$MARIADB_USER'@'%';
FLUSH PRIVILEGES;
SQL
