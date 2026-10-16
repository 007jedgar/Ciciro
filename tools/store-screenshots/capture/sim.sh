#!/bin/sh
# Helpers for taking store captures from an already booted iOS simulator.
# They never boot or shut a simulator down: that is the person running them.
#
#   capture/sim.sh status <udid>                      clean status bar (9:41, full bars)
#   capture/sim.sh shot <udid> <name> [form] [locale] screenshot to captures/<locale>/<form>/<name>.png
#   capture/sim.sh open <udid> <url>                  open a deep link, e.g. ciciro://project/<id>/sprint
#   capture/sim.sh push <udid>                        deliver the personalised reminder banner
#   capture/sim.sh theme <udid> light|dark            system appearance
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
cmd=${1:?command}
udid=${2:?simulator udid}

case "$cmd" in
  status)
    xcrun simctl status_bar "$udid" override \
      --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
      --cellularMode active --cellularBars 4 --operatorName "" \
      --batteryState charged --batteryLevel 100
    ;;
  shot)
    name=${3:?capture name}
    form=${4:-phone}
    locale=${5:-en}
    dir="$ROOT/captures/$locale/$form"
    mkdir -p "$dir"
    xcrun simctl io "$udid" screenshot --type=png "$dir/$name.png"
    echo "$dir/$name.png"
    ;;
  open)
    xcrun simctl openurl "$udid" "${3:?url}"
    ;;
  push)
    xcrun simctl push "$udid" app.ciciro.mobile "$HERE/notification.json"
    ;;
  theme)
    xcrun simctl ui "$udid" appearance "${3:?light or dark}"
    ;;
  *)
    echo "unknown command $cmd" >&2
    exit 2
    ;;
esac
