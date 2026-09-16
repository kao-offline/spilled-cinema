from __future__ import annotations

import argparse
import logging
import os
import time
import tomllib
from pathlib import Path
from typing import Any

from .protocol import Action, send_command


LOGGER = logging.getLogger("spilled_remote.pi")
DEFAULT_DEVICE_HINTS = ("gpio_ir", "gpio-ir", "ir receiver", "argon")


def load_config(path: Path) -> dict[str, Any]:
    with path.open("rb") as file:
        data = tomllib.load(file)
    receiver = data.get("receiver")
    keys = data.get("keys")
    if not isinstance(receiver, dict) or not isinstance(keys, dict):
        raise ValueError("config requires [receiver] and [keys] tables")
    receiver.setdefault("url", "http://127.0.0.1:8765")
    receiver.setdefault("token", os.environ.get("SPILLED_REMOTE_TOKEN", ""))
    receiver.setdefault("timeout_seconds", 2.0)
    receiver.setdefault("device", "auto")
    receiver.setdefault("device_name_contains", list(DEFAULT_DEVICE_HINTS))
    return data


def normalized_keycode(keycode: str | list[str]) -> str:
    return keycode[0] if isinstance(keycode, list) else keycode


def mapped_action(keys: dict[str, Any], keycode: str | list[str]) -> Action | None:
    value = keys.get(normalized_keycode(keycode))
    if value is None:
        return None
    try:
        return Action(str(value))
    except ValueError as error:
        raise ValueError(f"unsupported action {value!r} for {keycode!r}") from error


def import_evdev() -> Any:
    try:
        import evdev
    except ImportError as error:
        raise SystemExit("evdev is required on the Pi: python -m pip install -e '.[pi]'") from error
    return evdev


def available_devices(evdev: Any) -> list[Any]:
    devices = []
    for path in evdev.list_devices():
        try:
            devices.append(evdev.InputDevice(path))
        except OSError as error:
            LOGGER.warning("cannot inspect %s: %s", path, error)
    return devices


def choose_device(evdev: Any, configured: str, hints: list[str]) -> Any:
    if configured != "auto":
        return evdev.InputDevice(configured)
    devices = available_devices(evdev)
    lowered_hints = tuple(hint.lower() for hint in hints)
    for device in devices:
        description = f"{device.name} {device.phys or ''}".lower()
        if any(hint in description for hint in lowered_hints):
            return device
    found = ", ".join(f"{item.path} ({item.name})" for item in devices) or "none"
    raise RuntimeError(f"no IR input device matched {lowered_hints}; available: {found}")


def run_bridge(config: dict[str, Any], dry_run: bool) -> None:
    evdev = import_evdev()
    receiver = config["receiver"]
    keys = config["keys"]
    device = choose_device(
        evdev,
        str(receiver["device"]),
        [str(item) for item in receiver["device_name_contains"]],
    )
    LOGGER.info("reading %s (%s)", device.path, device.name)
    last_repeat: dict[Action, float] = {}
    repeatable = {Action.UP, Action.DOWN, Action.LEFT, Action.RIGHT, Action.VOLUME_UP, Action.VOLUME_DOWN}

    for event in device.read_loop():
        if event.type != evdev.ecodes.EV_KEY or event.value not in (1, 2):
            continue
        key_event = evdev.categorize(event)
        action = mapped_action(keys, key_event.keycode)
        if action is None:
            if event.value == 1:
                LOGGER.info("unmapped key: %s", normalized_keycode(key_event.keycode))
            continue
        if event.value == 2:
            if action not in repeatable:
                continue
            now = time.monotonic()
            if now - last_repeat.get(action, 0.0) < 0.12:
                continue
            last_repeat[action] = now
        if dry_run:
            LOGGER.info("dry-run: %s -> %s", normalized_keycode(key_event.keycode), action.value)
            continue
        try:
            send_command(
                str(receiver["url"]),
                str(receiver["token"]),
                action,
                f"pi-ir:{device.name}",
                float(receiver["timeout_seconds"]),
            )
            LOGGER.info("sent %s", action.value)
        except (ConnectionError, ValueError) as error:
            LOGGER.error("could not send %s: %s", action.value, error)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Forward Linux IR key events to the prototype receiver")
    parser.add_argument("--config", type=Path, default=Path("pi/config.toml"))
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    evdev = import_evdev()
    if args.list_devices:
        for device in available_devices(evdev):
            print(f"{device.path}\t{device.name}\t{device.phys or ''}")
        return
    config = load_config(args.config)
    if not args.dry_run and not str(config["receiver"]["token"]):
        raise SystemExit("receiver.token or SPILLED_REMOTE_TOKEN is required")
    try:
        run_bridge(config, args.dry_run)
    except (OSError, RuntimeError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
