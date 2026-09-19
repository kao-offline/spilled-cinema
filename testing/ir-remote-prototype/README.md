# Spilled IR remote prototype

This is a standalone experiment. It does not import from, register routes in, or
change the SpilledCinema dashboard/server.

It contains two input devices and one small desktop receiver:

```text
Tkinter test pad ─┐
                  ├─ authenticated HTTP on the local network ─> desktop receiver
Argon IR + Pi ────┘                                      └─> normal keyboard keys
                                                               └─> focused browser
```

The current dashboard already understands arrow keys and Enter for spatial
navigation. During playback it also understands Space, Left/Right, `f`, `m`,
and `c`. The receiver emits those same keys through the operating system.

## Safety and prototype limits

- The receiver listens on `127.0.0.1` by default. LAN access must be enabled
  deliberately with `--bind 0.0.0.0`.
- LAN mode requires a shared token. Traffic is not encrypted, so only use it on
  a trusted home network. A production version should use TLS and pairing.
- Keys go to whichever desktop window currently has focus. Focus the Spilled
  dashboard in the browser before testing.
- The Argon remote power button is intentionally ignored. This prototype never
  shuts down, restarts, installs, or reconfigures SpilledCinema.
- No Raspberry Pi changes happen until you copy this folder to the Pi and run
  the documented commands yourself.

## 1. Desktop setup

Python 3.11 or newer is recommended.

```powershell
cd testing/ir-remote-prototype
py -m venv .venv
.venv\Scripts\python -m pip install -e ".[desktop]"
```

Generate a token once:

```powershell
.venv\Scripts\python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Keep that value private. Start the receiver, replacing the example token:

```powershell
.venv\Scripts\spilled-remote-receiver --bind 0.0.0.0 --token "YOUR_TOKEN"
```

Windows may ask whether Python can use the private network. Allow private
networks only. Keep the browser focused after starting the receiver.

## 2. Tkinter controller

On the same PC, open another terminal:

```powershell
cd testing/ir-remote-prototype
.venv\Scripts\spilled-remote-pad --url http://127.0.0.1:8765 --token "YOUR_TOKEN"
```

The on-screen buttons work with a mouse. The controller window also accepts
arrow keys, Enter, Escape, Home, Space, F, M, and C.

For a same-PC protocol test, start the receiver with `--dry-run`; it will log
accepted commands instead of injecting keys. Clicking the Tk window takes focus
away from the browser, so end-to-end key injection should use the Pi, a second
computer running the test pad, or any input device that does not steal desktop
focus.

## 3. Raspberry Pi + Argon case

### One-command local-TV setup

Run this from any directory on Raspberry Pi OS (copy-paste):

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash
```

It verifies Raspberry Pi hardware, installs `ir-keytable`, backs up `config.txt`
before enabling GPIO 23, installs the Argon keymap and a boot service, and loads
the map immediately when the receiver already exists. If it adds the overlay,
reboot once. This direct mode makes the remote a Linux input device, so Chromium
and the dashboard receive the buttons without the Python network relay.

The installer enables the keymap service for startup and verifies it with
`systemctl is-enabled`, so the remote keeps working after a reboot.

### One-command same-Pi TV setup

When the Pi runs the media server, the browser, and the remote together
(the TV case), add `--same-pi`. On top of the direct setup it installs a
key-injection-free receiver status service (so the dashboard's Remote buttons
screen reports **Connected**) and then verifies every layer the dashboard
checks — keymap, receiver, server, and the server's own view of the receiver:

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash -s -- --same-pi
```

Open the dashboard on the Pi afterward: Search → **Remote buttons** should show
`Connected on :8765`. If the server line warns it cannot see the receiver while
the receiver itself answers, the server is almost certainly in Docker — set
`SPILLED_REMOTE_RECEIVER_URL=http://host.docker.internal:8765` on it
(`docker-compose.node.yml` already does) and restart it.

### Powering the Pi on/off with the remote

Power control is a case-hardware feature, not software: our stack deliberately
ignores the remote's power button. On Argon cases with a built-in IR receiver
(ONE V2/M.2/V3 — the original V1 has no IR receiver), leave the official power
supply plugged in and press the remote's power button: the case microcontroller
powers the Pi on from standby and cuts power on long-press, with no OS or
dashboard involvement. Keep the case jumper in its default manual-boot position
(press-to-boot after power loss) rather than always-on mode. On V3, `argonone-ir`
configures which IR signal toggles power.

### One-command bridge setup (Pi forwards to a desktop over the LAN/web)

If the dashboard runs on another computer, install the bridge as well (copy-paste, replacing the address and token). It is
enabled for startup and the installer probes the receiver's `/health`
endpoint to confirm the Pi can reach it:

```bash
curl -fsSL https://raw.githubusercontent.com/kao-offline/spilled-cinema/master/testing/ir-remote-prototype/pi/install.sh | sudo bash -s -- --with-bridge --receiver-url http://192.168.1.50:8765 --token "YOUR_TOKEN"
```

Use the LAN address of the PC running
`spilled-remote-receiver --bind 0.0.0.0 --token "YOUR_TOKEN"` and the same
token. Add `--dashboard-url https://spilled.overload.studio` to also verify
the Pi can reach the hosted dashboard (useful for a Pi-as-TV kiosk).

The remote's arrows, OK, Home, Back, volume buttons, and menu/captions button
receive sensible defaults. Open the dashboard Search menu and choose **Remote
buttons** to capture different buttons or correct a revision-specific layout.

### Manual/development setup

Argon40 documents the case IR receiver on BCM GPIO 23 (physical pin 16). See
the [Argon40 case hardware reference](https://github.com/Argon40Tech/Argon40case)
and [Argon ONE I2C/GPIO reference](https://github.com/Argon40Tech/Argon-ONE-i2c-Codes).
On
current Raspberry Pi OS, enable the kernel IR receiver by adding this line to
`/boot/firmware/config.txt` (older images may use `/boot/config.txt`):

```ini
dtoverlay=gpio-ir,gpio_pin=23
```

Then reboot and install the standard input tools:

```bash
sudo apt update
sudo apt install -y python3-venv ir-keytable
```

Copy this whole prototype folder to the Pi, then install it in a venv:

```bash
cd ir-remote-prototype
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[pi]'
```

Discover the receiver and inspect raw button codes before loading any map:

```bash
ir-keytable
sudo ir-keytable -t
```

The included `pi/argon-spilled.toml` contains a commonly reported Argon remote
NEC map. Remote/case revisions can differ, so treat it as a starting point. If
the values printed by `ir-keytable -t` differ, edit the scancodes in that file.
Load it temporarily (replace `rc0` if discovery showed another receiver):

```bash
sudo ir-keytable -s rc0 -p nec -w pi/argon-spilled.toml
.venv/bin/spilled-ir-bridge --list-devices
```

Create a local config from the example and set the desktop PC's LAN address and
the same token:

```bash
cp pi/config.example.toml pi/config.toml
nano pi/config.toml
.venv/bin/spilled-ir-bridge --config pi/config.toml --dry-run
```

`--dry-run` prints mapped actions without sending them. Remove it when the
mapping looks correct:

```bash
.venv/bin/spilled-ir-bridge --config pi/config.toml
```

For boot startup, see [pi/SYSTEMD.md](pi/SYSTEMD.md). The provided units are
templates and are not installed automatically.

## Button framework

| Action | Desktop key | Typical Argon button |
| --- | --- | --- |
| up/down/left/right | Arrow keys | Direction pad |
| enter | Enter | OK |
| back | Escape | Back/Menu Back |
| home | Home | Home |
| play_pause | Space | Play/Pause or OK in player |
| fullscreen | F | Menu/Info: enters browser fullscreen on TV surfaces, exits back to the windowed browser on the next press (toggles the player surface inside the player) |
| mute | M | configurable |
| captions | C | configurable |
| volume_up/down | OS media volume | Volume buttons |

Mappings live in `pi/config.toml`, so another remote or extra buttons can be
supported without modifying Python. Unknown buttons are logged and ignored.

## Checks

The core tests need no GUI, Pi, or optional packages:

```bash
python -m unittest discover -s tests -v
python -m compileall -q remote_control tests
```
