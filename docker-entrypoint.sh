#!/bin/sh
set -e

# Ensure persistent dirs exist before Node starts (host bind mounts often start empty)
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p \
  "$DATA_DIR" \
  "$DATA_DIR/output" \
  "$DATA_DIR/cache" \
  "$DATA_DIR/uploads"

exec "$@"
