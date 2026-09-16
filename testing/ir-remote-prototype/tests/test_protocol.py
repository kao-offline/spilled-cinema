from __future__ import annotations

import json
import time
import unittest
import uuid
from unittest.mock import patch

from remote_control.protocol import Action, Command, decode_command, encode_command


class ProtocolTests(unittest.TestCase):
    def test_round_trip(self) -> None:
        command = Command.create(Action.ENTER, "test")
        self.assertEqual(decode_command(encode_command(command)), command)

    def test_rejects_unknown_action(self) -> None:
        raw = json.dumps(
            {
                "version": 1,
                "action": "launch_missiles",
                "source": "test",
                "message_id": str(uuid.uuid4()),
                "sent_at": time.time(),
            }
        ).encode()
        with self.assertRaisesRegex(ValueError, "invalid"):
            decode_command(raw)

    def test_rejects_stale_command(self) -> None:
        with patch("remote_control.protocol.time.time", return_value=1_000.0):
            command = Command(
                action=Action.UP,
                source="test",
                message_id=str(uuid.uuid4()),
                sent_at=900.0,
            )
            with self.assertRaisesRegex(ValueError, "30 second"):
                decode_command(encode_command(command))

    def test_rejects_oversized_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "1-64"):
            Command.create(Action.DOWN, "x" * 65)


if __name__ == "__main__":
    unittest.main()
