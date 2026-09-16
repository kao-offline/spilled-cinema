from __future__ import annotations

import argparse
import hmac
import json
import logging
import os
import threading
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Protocol

from .protocol import MAX_MESSAGE_BYTES, Action, Command, decode_command


LOGGER = logging.getLogger("spilled_remote.receiver")


class ActionSink(Protocol):
    def emit(self, action: Action) -> None: ...


class LoggingSink:
    def emit(self, action: Action) -> None:
        LOGGER.info("dry-run key: %s", action.value)


class KeyboardSink:
    def __init__(self) -> None:
        try:
            from pynput.keyboard import Controller, Key
        except ImportError as error:
            raise RuntimeError('pynput is required: python -m pip install -e ".[desktop]"') from error
        self._controller = Controller()
        self._keys = {
            Action.UP: Key.up,
            Action.DOWN: Key.down,
            Action.LEFT: Key.left,
            Action.RIGHT: Key.right,
            Action.ENTER: Key.enter,
            Action.BACK: Key.esc,
            Action.HOME: Key.home,
            Action.PLAY_PAUSE: Key.space,
            Action.FULLSCREEN: "f",
            Action.MUTE: "m",
            Action.CAPTIONS: "c",
            Action.VOLUME_UP: Key.media_volume_up,
            Action.VOLUME_DOWN: Key.media_volume_down,
        }
        self._lock = threading.Lock()

    def emit(self, action: Action) -> None:
        with self._lock:
            self._controller.tap(self._keys[action])


class ReplayGuard:
    def __init__(self, capacity: int = 256) -> None:
        self._ids: set[str] = set()
        self._order: deque[str] = deque()
        self._capacity = capacity
        self._lock = threading.Lock()

    def accept(self, message_id: str) -> bool:
        with self._lock:
            if message_id in self._ids:
                return False
            self._ids.add(message_id)
            self._order.append(message_id)
            while len(self._order) > self._capacity:
                self._ids.remove(self._order.popleft())
            return True


def make_handler(token: str, sink: ActionSink) -> type[BaseHTTPRequestHandler]:
    guard = ReplayGuard()

    class RemoteHandler(BaseHTTPRequestHandler):
        server_version = "SpilledRemotePrototype/0.1"

        def do_GET(self) -> None:  # noqa: N802
            if self.path != "/health":
                self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            self._json(HTTPStatus.OK, {"ok": True, "prototype": True})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/command":
                self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return
            supplied = self.headers.get("X-Spilled-Remote-Token", "")
            if not hmac.compare_digest(supplied, token):
                self._json(HTTPStatus.UNAUTHORIZED, {"error": "invalid token"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid content length"})
                return
            if length <= 0 or length > MAX_MESSAGE_BYTES:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid message size"})
                return
            try:
                command: Command = decode_command(self.rfile.read(length))
            except ValueError as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
                return
            if guard.accept(command.message_id):
                sink.emit(command.action)
                LOGGER.info("%s from %s", command.action.value, command.source)
            self._json(
                HTTPStatus.OK,
                {"ok": True, "message_id": command.message_id, "action": command.action.value},
            )

        def log_message(self, message_format: str, *args: object) -> None:
            LOGGER.debug(message_format, *args)

        def _json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    return RemoteHandler


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Translate prototype remote commands into desktop keys")
    parser.add_argument("--bind", default="127.0.0.1", help="listen address; use 0.0.0.0 for trusted LAN")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("SPILLED_REMOTE_TOKEN", ""))
    parser.add_argument("--dry-run", action="store_true", help="log accepted commands without pressing keys")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if len(args.token) < 20:
        raise SystemExit("--token or SPILLED_REMOTE_TOKEN must contain at least 20 characters")
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    sink: ActionSink = LoggingSink() if args.dry_run else KeyboardSink()
    server = ThreadingHTTPServer((args.bind, args.port), make_handler(args.token, sink))
    LOGGER.info("prototype receiver listening on http://%s:%d", args.bind, args.port)
    LOGGER.info("focus the Spilled dashboard; Ctrl+C stops the receiver")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
