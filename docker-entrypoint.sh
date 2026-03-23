#!/bin/sh
set -e

CONFIG_DIR="${CONFIG_DIR:-/app/config}"

# Copy default configs if not present
for f in config.yaml feeds.yaml targets.yaml filters.yaml; do
  if [ ! -f "$CONFIG_DIR/$f" ]; then
    if [ -f "/app/defaults/$f" ]; then
      cp "/app/defaults/$f" "$CONFIG_DIR/$f"
      echo "[init] Created default $CONFIG_DIR/$f"
    else
      echo "[init] Warning: /app/defaults/$f not found, skipping"
    fi
  fi
done

exec node dist/daemon.js
