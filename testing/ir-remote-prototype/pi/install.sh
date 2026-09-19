#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'USAGE'
Spilled Cinema Argon IR setup (Raspberry Pi OS).

Usage:
  curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash
  curl -fsSL .../install.sh | sudo bash -s -- --with-bridge --receiver-url http://192.168.1.50:8765 --token "YOUR_TOKEN"

Direct (local-TV) mode is the default: the remote becomes a Linux input
device, key bindings load at boot, and Chromium/the dashboard receives the
buttons with no network involved.

Options:
  --same-pi                same-Pi TV setup: everything above, plus a local
                           receiver status service and a full end-to-end check,
                           so the dashboard's Remote buttons screen shows
                           "Connected". Use when the Pi runs the media server,
                           the browser, and the remote together.
  --with-bridge            also install the network bridge so this Pi forwards
                           IR presses to a desktop receiver over your LAN/web.
                           Startup is enabled automatically. Cannot be combined
                           with --same-pi (that mode controls the local TV
                           directly through the kernel keymap instead).
  --receiver-url URL       desktop receiver base URL (required with --with-bridge).
  --token TOKEN            shared receiver token (or set SPILLED_REMOTE_TOKEN).
  --dashboard-url URL      optional dashboard URL to verify web reachability
                           (Pi-as-TV kiosk check, e.g. https://spilled.overload.studio).
  -h, --help               show this help.
USAGE
}

RECEIVER_URL="${RECEIVER_URL:-}"
RECEIVER_TOKEN="${SPILLED_REMOTE_TOKEN:-}"
WITH_BRIDGE=0
SAME_PI=0
DASHBOARD_URL="${DASHBOARD_URL:-}"
# Single parser handling both --opt=value and --opt value forms (the script
# is usually piped via `curl | sudo bash -s -- <flags>`).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-bridge) WITH_BRIDGE=1; shift ;;
    --same-pi) SAME_PI=1; shift ;;
    --receiver-url=*) RECEIVER_URL="${1#*=}"; shift ;;
    --receiver-url) RECEIVER_URL="${2:-}"; shift 2 ;;
    --token=*) RECEIVER_TOKEN="${1#*=}"; shift ;;
    --token) RECEIVER_TOKEN="${2:-}"; shift 2 ;;
    --dashboard-url=*) DASHBOARD_URL="${1#*=}"; shift ;;
    --dashboard-url) DASHBOARD_URL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)." >&2; exit 1 ;;
  esac
done

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root (for example: curl ... | sudo bash)." >&2
  exit 1
fi

if [[ $WITH_BRIDGE -eq 1 && $SAME_PI -eq 1 ]]; then
  echo "Pick one: --same-pi controls this Pi's own TV through the kernel keymap;" >&2
  echo "--with-bridge forwards presses to a receiver on another computer." >&2
  exit 1
fi

if [[ $WITH_BRIDGE -eq 1 ]]; then
  if [[ -z "$RECEIVER_URL" ]]; then
    echo "Missing --receiver-url (the desktop receiver base URL, e.g. http://192.168.1.50:8765)." >&2
    exit 1
  fi
  if [[ ${#RECEIVER_TOKEN} -lt 20 ]]; then
    echo "Missing --token (or SPILLED_REMOTE_TOKEN): the same long token used on the desktop receiver." >&2
    exit 1
  fi
fi

if [[ ! -r /proc/device-tree/model ]] || ! tr -d '\0' </proc/device-tree/model | grep -qi "raspberry pi"; then
  echo "This installer only supports Raspberry Pi OS on Raspberry Pi hardware." >&2
  exit 1
fi

BOOT_CONFIG=""
for candidate in /boot/firmware/config.txt /boot/config.txt; do
  if [[ -f "$candidate" ]]; then
    BOOT_CONFIG="$candidate"
    break
  fi
done
if [[ -z "$BOOT_CONFIG" ]]; then
  echo "Could not find the Raspberry Pi config.txt file." >&2
  exit 1
fi

active_ir_overlays=$(sed 's/[[:space:]]*#.*$//' "$BOOT_CONFIG" | grep -E '^dtoverlay=gpio-ir([,[:space:]]|$)' || true)
if [[ -n "$active_ir_overlays" ]] && ! grep -Eq '^dtoverlay=gpio-ir(,.*)?gpio_pin=23([,[:space:]]|$)' <<<"$active_ir_overlays"; then
  echo "An active gpio-ir overlay already uses a different configuration:" >&2
  echo "$active_ir_overlays" >&2
  echo "Resolve that GPIO conflict manually before installing the Argon receiver on GPIO 23." >&2
  exit 1
fi

echo "Installing the standard Linux IR tools..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ir-keytable curl ca-certificates
if [[ $WITH_BRIDGE -eq 1 ]]; then
  apt-get install -y python3-venv git
fi

install -d -m 0755 /etc/rc_keymaps /usr/local/libexec

cat >/etc/rc_keymaps/argon-spilled.toml <<'KEYMAP'
[[protocols]]
name = "argon-spilled"
protocol = "nec"

[protocols.scancodes]
0xff53ac = "KEY_UP"
0xff4bb4 = "KEY_DOWN"
0xff9966 = "KEY_LEFT"
0xff837c = "KEY_RIGHT"
0xff738c = "KEY_ENTER"
0xffd32c = "KEY_HOME"
0xffb946 = "KEY_C"
0xff09f6 = "KEY_ESC"
0xff01fe = "KEY_VOLUMEUP"
0xff817e = "KEY_VOLUMEDOWN"
# Fullscreen toggle (Menu/Info): capture the real scancode with
# `sudo ir-keytable -t`, then add e.g. 0x........ = "KEY_MENU".
KEYMAP

cat >/usr/local/libexec/spilled-ir-load-keymap <<'LOADER'
#!/usr/bin/env bash
set -Eeuo pipefail

for attempt in {1..20}; do
  for rc_path in /sys/class/rc/rc*; do
    [[ -e "$rc_path" ]] || continue
    rc_name=$(basename "$rc_path")
    device_path=$(readlink -f "$rc_path/device" || true)
    driver_path=$(readlink -f "$rc_path/device/driver" || true)
    description="$device_path $driver_path"
    if [[ "$description" == *gpio_ir_recv* ]] || [[ "$description" == *gpio-ir* ]]; then
      exec /usr/bin/ir-keytable -s "$rc_name" -p nec -D 350 -P 120 -w /etc/rc_keymaps/argon-spilled.toml
    fi
  done
  sleep 0.5
done

echo "The gpio-ir receiver did not appear under /sys/class/rc." >&2
echo "Check the Argon case revision and run: ir-keytable" >&2
exit 1
LOADER
chmod 0755 /usr/local/libexec/spilled-ir-load-keymap

cat >/etc/systemd/system/spilled-ir-keymap.service <<'UNIT'
[Unit]
Description=Spilled Cinema Argon IR key bindings
After=systemd-udev-settle.service
Wants=systemd-udev-settle.service

[Service]
Type=oneshot
ExecStart=/usr/local/libexec/spilled-ir-load-keymap
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

overlay_added=0
if ! sed 's/[[:space:]]*#.*$//' "$BOOT_CONFIG" | grep -Eq '^dtoverlay=gpio-ir(,.*)?gpio_pin=23([,[:space:]]|$)'; then
  backup_path="${BOOT_CONFIG}.spilled-ir-backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp --preserve=mode,ownership,timestamps "$BOOT_CONFIG" "$backup_path"
  {
    printf '\n# Spilled Cinema Argon IR receiver\n'
    printf 'dtoverlay=gpio-ir,gpio_pin=23\n'
  } >>"$BOOT_CONFIG"
  overlay_added=1
  echo "Enabled GPIO 23 IR input. Backup: $backup_path"
else
  echo "GPIO 23 IR input was already enabled."
fi

systemctl daemon-reload
systemctl enable spilled-ir-keymap.service

# Startup check: the keymap must survive reboots or the remote dies on boot.
if ! systemctl is-enabled --quiet spilled-ir-keymap.service; then
  echo "FAILED: spilled-ir-keymap.service is not enabled for startup." >&2
  exit 1
fi
echo "Startup: spilled-ir-keymap.service is enabled."

BRIDGE_OK=0
if [[ $WITH_BRIDGE -eq 1 ]]; then
  echo "Installing the network bridge (Pi forwards IR presses to the desktop receiver)..."

  if ! id spilledremote >/dev/null 2>&1; then
    useradd --system --user-group --home /opt/spilled-ir-remote-prototype --shell /usr/sbin/nologin spilledremote
  fi
  usermod -a -G input spilledremote
  install -d -m 0755 -o spilledremote -g spilledremote /opt/spilled-ir-remote-prototype
  install -d -m 0755 /etc/spilled-ir-remote

  if [[ ! -d /opt/spilled-ir-remote-prototype/remote_control ]]; then
    rm -rf /opt/spilled-ir-remote-prototype/src
    git clone --depth 1 https://github.com/kao-offline/spilled-cinema.git /opt/spilled-ir-remote-prototype/src
    cp -R /opt/spilled-ir-remote-prototype/src/testing/ir-remote-prototype/remote_control \
      /opt/spilled-ir-remote-prototype/src/testing/ir-remote-prototype/pyproject.toml \
      /opt/spilled-ir-remote-prototype/
    rm -rf /opt/spilled-ir-remote-prototype/src
    chown -R spilledremote:spilledremote /opt/spilled-ir-remote-prototype
  fi
  if [[ ! -d /opt/spilled-ir-remote-prototype/.venv ]]; then
    sudo -u spilledremote python3 -m venv /opt/spilled-ir-remote-prototype/.venv
    sudo -u spilledremote /opt/spilled-ir-remote-prototype/.venv/bin/python -m pip install --upgrade pip
    sudo -u spilledremote /opt/spilled-ir-remote-prototype/.venv/bin/python -m pip install '/opt/spilled-ir-remote-prototype[pi]'
  fi

  trimmed_url="${RECEIVER_URL%/}"
  cat >/etc/spilled-ir-remote/config.toml <<BRIDGE_CONFIG
[receiver]
# Desktop PC running: spilled-remote-receiver --bind 0.0.0.0 --token "…"
url = "$trimmed_url"
token = "$RECEIVER_TOKEN"
timeout_seconds = 2.0

device = "auto"
device_name_contains = ["gpio_ir", "gpio-ir", "ir receiver", "argon"]

[keys]
KEY_UP = "up"
KEY_DOWN = "down"
KEY_LEFT = "left"
KEY_RIGHT = "right"
KEY_OK = "enter"
KEY_ENTER = "enter"
KEY_BACK = "back"
KEY_ESC = "back"
KEY_HOME = "home"
KEY_HOMEPAGE = "home"
KEY_PLAYPAUSE = "play_pause"
KEY_PLAY = "play_pause"
KEY_C = "captions"
KEY_VOLUMEUP = "volume_up"
KEY_VOLUMEDOWN = "volume_down"
# Fullscreen toggle: enters browser fullscreen on TV surfaces, exits back to
# the windowed browser on the next press (player surface inside the player).
KEY_MENU = "fullscreen"
KEY_INFO = "fullscreen"
BRIDGE_CONFIG
  chown root:spilledremote /etc/spilled-ir-remote/config.toml
  chmod 640 /etc/spilled-ir-remote/config.toml

  cat >/etc/systemd/system/spilled-ir-remote.service <<'UNIT'
[Unit]
Description=Spilled IR remote prototype bridge
After=network-online.target spilled-ir-keymap.service
Wants=network-online.target spilled-ir-keymap.service

[Service]
Type=simple
User=spilledremote
Group=spilledremote
SupplementaryGroups=input
WorkingDirectory=/opt/spilled-ir-remote-prototype
EnvironmentFile=-/etc/spilled-ir-remote/environment
ExecStart=/opt/spilled-ir-remote-prototype/.venv/bin/spilled-ir-bridge --config /etc/spilled-ir-remote/config.toml
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable spilled-ir-remote.service
  if ! systemctl is-enabled --quiet spilled-ir-remote.service; then
    echo "FAILED: spilled-ir-remote.service is not enabled for startup." >&2
    exit 1
  fi
  echo "Startup: spilled-ir-remote.service is enabled."

  # Web check: the Pi must reach the desktop receiver over the LAN/web.
  echo "Checking receiver web reachability: ${trimmed_url}/health ..."
  if curl -fsS --max-time 8 "${trimmed_url}/health" | grep -q '"ok"'; then
    echo "Web: receiver answered — bridge traffic can flow."
    BRIDGE_OK=1
  else
    echo "WARNING: the receiver did not answer at ${trimmed_url}/health." >&2
    echo "Start it on the desktop first: spilled-remote-receiver --bind 0.0.0.0 --token \"…\"" >&2
    echo "The bridge service is still enabled and will retry at boot." >&2
  fi
  systemctl restart spilled-ir-remote.service || systemctl start spilled-ir-remote.service || true
fi

if [[ $SAME_PI -eq 1 ]]; then
  echo "Setting up the same-Pi TV receiver (status endpoint for the dashboard)..."
  echo "Button presses keep flowing through the kernel keymap above, so this"
  echo "service runs key-injection-free: it only answers the dashboard's"
  echo "health check and never double-presses."

  if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)'; then
    echo "Python 3.11 or newer is required (Raspberry Pi OS Bookworm or newer)." >&2
    exit 1
  fi
  apt-get install -y git

  install -d -m 0755 /opt/spilled-ir-receiver /etc/spilled-ir-receiver
  if [[ ! -f /opt/spilled-ir-receiver/remote_control/desktop_receiver.py ]]; then
    rm -rf /opt/spilled-ir-receiver/src
    git clone --depth 1 https://github.com/kao-offline/spilled-cinema.git /opt/spilled-ir-receiver/src
    cp -R /opt/spilled-ir-receiver/src/testing/ir-remote-prototype/remote_control \
      /opt/spilled-ir-receiver/src/testing/ir-remote-prototype/pyproject.toml \
      /opt/spilled-ir-receiver/
    rm -rf /opt/spilled-ir-receiver/src
  fi
  if [[ ! -f /etc/spilled-ir-receiver/receiver.env ]]; then
    receiver_token=$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')
    printf 'SPILLED_REMOTE_TOKEN=%s\n' "$receiver_token" >/etc/spilled-ir-receiver/receiver.env
    chmod 600 /etc/spilled-ir-receiver/receiver.env
    echo "Generated a receiver token in /etc/spilled-ir-receiver/receiver.env."
  fi

  cat >/etc/systemd/system/spilled-ir-receiver.service <<'UNIT'
[Unit]
Description=Spilled Cinema IR receiver (dashboard status endpoint)
After=network.target

[Service]
Type=simple
User=nobody
Group=nogroup
WorkingDirectory=/opt/spilled-ir-receiver
EnvironmentFile=/etc/spilled-ir-receiver/receiver.env
ExecStart=/usr/bin/python3 -m remote_control.desktop_receiver --bind 127.0.0.1 --port 8765 --dry-run
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable spilled-ir-receiver.service
  if ! systemctl is-enabled --quiet spilled-ir-receiver.service; then
    echo "FAILED: spilled-ir-receiver.service is not enabled for startup." >&2
    exit 1
  fi
  systemctl restart spilled-ir-receiver.service || systemctl start spilled-ir-receiver.service || true
  sleep 2

  echo "Verifying every layer the dashboard checks..."
  if curl -fsS --max-time 8 http://127.0.0.1:8765/health | grep -q '"ok"'; then
    echo "  receiver :8765 ............ OK"
  else
    echo "FAILED: the receiver does not answer at http://127.0.0.1:8765/health." >&2
    echo "Check: sudo systemctl status spilled-ir-receiver.service" >&2
    exit 1
  fi

  # This is the exact criterion behind "Connected" in Remote buttons: the
  # server on this Pi must see the receiver. A missing server or a server in
  # Docker (own loopback namespace) are the two usual causes here.
  remote_info=$(curl -fsS --max-time 8 http://127.0.0.1:8787/api/remote/info || true)
  if [[ -z "$remote_info" ]]; then
    echo "WARNING: no Spilled server answers at http://127.0.0.1:8787." >&2
    echo "Start your media server on this Pi first, then re-run with --same-pi." >&2
  else
    receiver_seen=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("receiver", {}).get("reachable", False))' <<<"$remote_info")
    receiver_port=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read()).get("receiver", {}).get("port", 8765))' <<<"$remote_info")
    if [[ "$receiver_seen" == "True" ]]; then
      echo "  server sees receiver :$receiver_port ... OK — Remote buttons will show Connected."
    else
      echo "WARNING: the receiver answers locally, but the server cannot see it." >&2
      echo "If the server runs in Docker, point its probe at this host with" >&2
      echo "SPILLED_REMOTE_RECEIVER_URL=http://host.docker.internal:8765" >&2
      echo "(docker-compose.node.yml already sets this by default), then restart it." >&2
    fi
  fi
fi

if [[ -n "$DASHBOARD_URL" ]]; then
  trimmed_dashboard="${DASHBOARD_URL%/}"
  echo "Checking dashboard web reachability: $trimmed_dashboard ..."
  if curl -fsS --max-time 10 -o /dev/null "$trimmed_dashboard"; then
    echo "Web: dashboard answered."
  else
    echo "WARNING: the dashboard did not answer at $trimmed_dashboard." >&2
  fi
fi

if compgen -G '/sys/class/rc/rc*' >/dev/null && systemctl start spilled-ir-keymap.service; then
  echo "Argon IR key bindings are active."
else
  echo "The service is installed and will activate after reboot."
fi

echo
echo "Spilled Cinema IR setup is complete."
echo "Startup state:"
systemctl is-enabled spilled-ir-keymap.service | sed 's/^/  keymap (IR buttons at boot): /'
if [[ $SAME_PI -eq 1 ]]; then
  systemctl is-enabled spilled-ir-receiver.service | sed 's/^/  receiver (dashboard status): /'
  echo "Open the dashboard on this Pi, enable TV mode, then open Search -> Remote buttons:"
  echo "the Local IR receiver row should say Connected."
fi
if [[ $WITH_BRIDGE -eq 1 ]]; then
  systemctl is-enabled spilled-ir-remote.service | sed 's/^/  bridge (forwards to receiver): /'
  if [[ $BRIDGE_OK -eq 1 ]]; then
    echo "Receiver web check: passed."
  else
    echo "Receiver web check: pending — start the desktop receiver, then run:"
    echo "  curl -fsS ${RECEIVER_URL%/}/health"
    echo "  sudo systemctl status spilled-ir-remote.service"
  fi
fi
if [[ $overlay_added -eq 1 ]]; then
  echo "Reboot once with: sudo reboot"
fi
echo "Then open the dashboard, open Search, and use Remote buttons to verify or change bindings."
