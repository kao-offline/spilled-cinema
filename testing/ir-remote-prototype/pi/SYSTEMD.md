# Optional systemd installation

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
