#!/bin/zsh
# Registers the memory host for the extension. Usage: host/install.sh <extension-id>
set -e
id=${1:?usage: $0 <extension-id from chrome://extensions>}
script="${0:A:h}/dia_mem.py"
chmod +x "$script"
for dir in "Dia/User Data" "Dia" "Chromium" "Google/Chrome"; do
  target="$HOME/Library/Application Support/$dir/NativeMessagingHosts"
  mkdir -p "$target"
  cat > "$target/com.user.dia_mem.json" <<JSON
{
  "name": "com.user.dia_mem",
  "description": "Dia process memory for Sleep Old Tabs",
  "path": "$script",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$id/"]
}
JSON
done
echo "Registered com.user.dia_mem for $id"
