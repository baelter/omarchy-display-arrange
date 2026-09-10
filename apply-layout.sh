#!/bin/bash
set -euo pipefail

# Applies one or more monitor arrangements: live via `hyprctl eval` and
# persisted into monitors.lua so they survive a restart. Args are variadic
# groups of six: <name> <x> <y> <mode> <scale> <transform> [<name2> ...].
# `hyprctl keyword monitor` is rejected under Hyprland's Lua config parser,
# so the live path always goes through `hyprctl eval hl.monitor(...)`.

file="$HOME/.config/hypr/monitors.lua"

if (($# == 0)) || (($# % 6 != 0)); then
  echo "apply-layout.sh: arg count must be a positive multiple of 6" >&2
  exit 1
fi

transform_field() {
  local transform="$1"
  if [[ $transform != "0" ]]; then
    printf ', transform = %s' "$transform"
  fi
}

persist_one() {
  local name="$1" x="$2" y="$3" mode="$4" scale="$5" transform="$6"
  local tf
  tf="$(transform_field "$transform")"

  # Only look at live (non-commented) lines, so a monitor literally named
  # "DP-2" doesn't match Omarchy's commented-out example block.
  if grep -vE '^\s*--' "$file" | grep -qF "output = \"$name\""; then
    NX="$x" NY="$y" perl -i -pe '
      next if /^\s*--/;
      s/(hl\.monitor\(\{[^}]*output\s*=\s*"\Q'"$name"'\E"[^}]*position\s*=\s*")[^"]*(")/
        $1 . $ENV{NX} . "x" . $ENV{NY} . $2/e;
    ' "$file"
  else
    printf '\nhl.monitor({ output = "%s", mode = "%s", position = "%sx%s", scale = %s%s })\n' \
      "$name" "$mode" "$x" "$y" "$scale" "$tf" >>"$file"
  fi
}

# Apply every monitor in one `hyprctl eval` so Hyprland sees the final layout
# in a single step. Applying them one by one lets a transient overlap during
# the transition (e.g. re-anchoring shifts the right monitor into where the
# left one still sits) get rejected, which under `set -e` would abort the
# remaining live and persistence work.
lua=""
args=("$@")
i=0
while ((i < $#)); do
  name="${args[i]}" x="${args[i + 1]}" y="${args[i + 2]}" mode="${args[i + 3]}" scale="${args[i + 4]}" transform="${args[i + 5]}"
  lua+="hl.monitor({ output = \"$name\", mode = \"$mode\", position = \"${x}x${y}\", scale = $scale$(transform_field "$transform") }) "
  i=$((i + 6))
done
hyprctl eval "$lua" >/dev/null

while (($#)); do
  persist_one "$1" "$2" "$3" "$4" "$5" "${6:-0}"
  shift 6
done
