from __future__ import annotations

import json
import time
import uuid
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 2_048


class Action(StrEnum):
    UP = "up"
    DOWN = "down"
    LEFT = "left"
    RIGHT = "right"
    ENTER = "enter"
    BACK = "back"
    HOME = "home"
    PLAY_PAUSE = "play_pause"
    FULLSCREEN = "fullscreen"
    MUTE = "mute"
    CAPTIONS = "captions"
    VOLUME_UP = "volume_up"
    VOLUME_DOWN = "volume_down"


@dataclass(frozen=True, slots=True)
class Command:
    action: Action
    source: str
    message_id: str
    sent_at: float
    version: int = PROTOCOL_VERSION

    @classmethod
    def create(cls, action: Action, source: str) -> "Command":
        clean_source = source.strip()
        if not clean_source or len(clean_source) > 64:
            raise ValueError("source must contain 1-64 characters")
        return cls(
            action=action,
            source=clean_source,
            message_id=str(uuid.uuid4()),
            sent_at=time.time(),
        )


def encode_command(command: Command) -> bytes:
    payload = asdict(command)
    payload["action"] = command.action.value
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def decode_command(raw: bytes) -> Command:
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ValueError("command is too large")
    try:
        data: Any = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("command must be valid UTF-8 JSON") from error
    if not isinstance(data, dict):
        raise ValueError("command must be a JSON object")
    if data.get("version") != PROTOCOL_VERSION:
        raise ValueError("unsupported protocol version")
    try:
        action = Action(data["action"])
        source = str(data["source"]).strip()
        message_id = str(uuid.UUID(str(data["message_id"])))
        sent_at = float(data["sent_at"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("command fields are invalid") from error
    if not source or len(source) > 64:
        raise ValueError("source must contain 1-64 characters")
    if abs(time.time() - sent_at) > 30:
        raise ValueError("command timestamp is outside the 30 second window")
    return Command(
        action=action,
        source=source,
        message_id=message_id,
        sent_at=sent_at,
    )


def send_command(
    base_url: str,
    token: str,
    action: Action,
    source: str,
    timeout: float = 2.0,
) -> str:
    if not token:
        raise ValueError("a shared token is required")
    command = Command.create(action, source)
    request = Request(
        f"{base_url.rstrip('/')}/command",
        data=encode_command(command),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Spilled-Remote-Token": token,
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise ConnectionError(f"receiver rejected command ({error.code}): {detail}") from error
    except URLError as error:
        raise ConnectionError(f"receiver is unavailable: {error.reason}") from error
    if result.get("message_id") != command.message_id:
        raise ConnectionError("receiver acknowledgement did not match the command")
    return command.message_id
