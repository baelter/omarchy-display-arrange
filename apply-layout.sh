#!/bin/bash
set -euo pipefail

# Persists a monitor's arranged position into monitors.lua. Called by
# Panel.qml after a drag-to-arrange drop; hyprctl already applied the move
# live, this just makes it survive a restart.

name="$1"
x="$2"
y="$3"
mode="$4"
scale="$5"
transform="${6:-0}"
file="$HOME/.config/hypr/monitors.lua"

transform_field=""
if [ "$transform" != "0" ]; then
  transform_field=", transform = $transform"
fi

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
    "$name" "$mode" "$x" "$y" "$scale" "$transform_field" >>"$file"
fi
