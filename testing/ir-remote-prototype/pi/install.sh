#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run this installer as root (for example: curl ... | sudo bash)." >&2
  exit 1
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
apt-get install -y ir-keytable

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

if compgen -G '/sys/class/rc/rc*' >/dev/null && systemctl start spilled-ir-keymap.service; then
  echo "Argon IR key bindings are active."
else
  echo "The service is installed and will activate after reboot."
fi

echo
echo "Spilled Cinema IR setup is complete."
if [[ $overlay_added -eq 1 ]]; then
  echo "Reboot once with: sudo reboot"
fi
echo "Then open the dashboard, open Search, and use Remote buttons to verify or change bindings."
