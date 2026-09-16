# Startup on the Pi

The one-command installer (`pi/install.sh`) already enables everything for
boot and verifies it:

- `spilled-ir-keymap.service` — loads the Argon keymap at startup
  (auto-detects the gpio-ir receiver, so no hardcoded `rc0`).
- With `--with-bridge`: `spilled-ir-remote.service` — forwards IR presses to
  the desktop receiver over the LAN/web, also enabled at startup.
- After enabling, the installer runs `systemctl is-enabled` on each unit and
  probes the receiver's `/health` endpoint, so a failed startup install or an
  unreachable receiver is reported immediately instead of after a reboot.

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash -s -- --with-bridge --receiver-url http://192.168.1.50:8765 --token "YOUR_TOKEN"
```

Verify after a reboot:

```bash
systemctl is-enabled spilled-ir-keymap.service spilled-ir-remote.service
systemctl status spilled-ir-keymap.service spilled-ir-remote.service
journalctl -u spilled-ir-remote.service -f
curl -fsS http://192.168.1.50:8765/health
```

## Optional manual installation

Do this only after the bridge works interactively. These commands affect the Pi,
not the SpilledCinema application or server.

From the copied prototype directory:

```bash
sudo useradd --system --user-group --home /opt/spilled-ir-remote-prototype --shell /usr/sbin/nologin spilledremote
sudo usermod -a -G input spilledremote
sudo mkdir -p /opt/spilled-ir-remote-prototype /etc/spilled-ir-remote /etc/rc_keymaps
sudo cp -R remote_control pyproject.toml /opt/spilled-ir-remote-prototype/
sudo cp pi/argon-spilled.toml /etc/rc_keymaps/argon-spilled.toml
sudo cp pi/config.example.toml /etc/spilled-ir-remote/config.toml
sudo chown -R spilledremote:spilledremote /opt/spilled-ir-remote-prototype
sudo chown root:spilledremote /etc/spilled-ir-remote/config.toml
sudo chmod 640 /etc/spilled-ir-remote/config.toml
sudo -u spilledremote python3 -m venv /opt/spilled-ir-remote-prototype/.venv
sudo -u spilledremote /opt/spilled-ir-remote-prototype/.venv/bin/python -m pip install '/opt/spilled-ir-remote-prototype[pi]'
sudo cp pi/spilled-ir-keymap.service pi/spilled-ir-remote.service /etc/systemd/system/
```

Edit `/etc/spilled-ir-remote/config.toml` with `sudo` and set the receiver
URL/token. Check
the receiver name and key mapping again, then enable both units:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now spilled-ir-keymap.service spilled-ir-remote.service
systemctl status spilled-ir-keymap.service spilled-ir-remote.service
journalctl -u spilled-ir-remote.service -f
```

Rollback is limited to the prototype files and user:

```bash
sudo systemctl disable --now spilled-ir-remote.service spilled-ir-keymap.service
```

After disabling, the files can be removed manually if desired. Do not remove or
change the Argon fan/power service; this prototype does not own it.
