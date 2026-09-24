#!/bin/sh
# Install / uninstall the opencode prompt-optimizer plugin. Safe to re-run.
#   ./install.sh              symlink this repo into the opencode config dir
#   ./install.sh --uninstall  remove symlink, loader and tui.json entry (keeps prompt-optimizer.jsonc)
# Target dir: $CFG_DIR, else ${XDG_CONFIG_HOME:-$HOME/.config}/opencode
set -eu

REPO=$(cd "$(dirname "$0")" && pwd -P)
CFG=${CFG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}
LINK=$CFG/plugins/prompt-optimizer
LOADER=$CFG/plugins/prompt-optimizer.ts
TUI=$CFG/tui.json
ENTRY=./plugins/prompt-optimizer/src/tui.ts

manual() {
  echo "note: could not edit $TUI automatically. $1 this entry in its \"plugin\" array by hand:" >&2
  echo "  \"$ENTRY\"" >&2
}

# $1 = jq filter; edits tui.json in place (keeps symlinks/permissions), backup in tui.json.bak
edit_tui() {
  command -v jq >/dev/null 2>&1 || return 1
  tmp=$(mktemp)
  if jq --arg e "$ENTRY" "$1" "$TUI" >"$tmp" 2>/dev/null; then
    cp "$TUI" "$TUI.bak"
    cat "$tmp" >"$TUI"
    rm -f "$tmp"
  else
    rm -f "$tmp"
    return 1
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$LOADER"
  [ -L "$LINK" ] && rm -f "$LINK"
  if [ -f "$TUI" ] && grep -qF "$ENTRY" "$TUI"; then
    edit_tui '.plugin |= map(select(. != $e))' || manual "Remove"
  fi
  echo "uninstalled from $CFG (kept $CFG/prompt-optimizer.jsonc)"
  exit 0
fi

if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  echo "error: $LINK exists and is not a symlink; move it away first" >&2
  exit 1
fi

mkdir -p "$CFG/plugins"
ln -sfn "$REPO" "$LINK"
echo 'export { PromptOptimizerPlugin } from "./prompt-optimizer/src/index.ts"' >"$LOADER"
[ -e "$CFG/prompt-optimizer.jsonc" ] || cp "$REPO/examples/prompt-optimizer.jsonc" "$CFG/prompt-optimizer.jsonc"

if [ ! -e "$TUI" ]; then
  printf '{\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": ["%s"]\n}\n' "$ENTRY" >"$TUI"
elif ! grep -qF "$ENTRY" "$TUI"; then
  edit_tui '.plugin = ((.plugin // []) + [$e])' || manual "Add"
fi

echo "installed: $LINK -> $REPO"
echo "config:    $CFG/prompt-optimizer.jsonc (set \"model\"; edits apply live)"
echo "restart opencode to load the plugin"
