from __future__ import annotations

import unittest

from remote_control.pi_ir_bridge import mapped_action, normalized_keycode
from remote_control.protocol import Action


class PiMappingTests(unittest.TestCase):
    def test_maps_configured_key(self) -> None:
        self.assertEqual(mapped_action({"KEY_OK": "enter"}, "KEY_OK"), Action.ENTER)

    def test_accepts_evdev_keycode_list(self) -> None:
        self.assertEqual(normalized_keycode(["KEY_OK", "KEY_ENTER"]), "KEY_OK")

    def test_ignores_unknown_key(self) -> None:
        self.assertIsNone(mapped_action({}, "KEY_POWER"))

    def test_rejects_unknown_action(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported action"):
            mapped_action({"KEY_OK": "dangerous"}, "KEY_OK")


if __name__ == "__main__":
    unittest.main()
