from __future__ import annotations

import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from remote_control.desktop_receiver import make_handler
from remote_control.protocol import Action, Command, encode_command


class RecordingSink:
    def __init__(self) -> None:
        self.actions: list[Action] = []

    def emit(self, action: Action) -> None:
        self.actions.append(action)


class ReceiverTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sink = RecordingSink()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler("a" * 20, cls.sink))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_health(self) -> None:
        with urlopen(f"{self.base_url}/health", timeout=2) as response:
            self.assertTrue(json.load(response)["ok"])

    def test_authenticated_command_and_replay_guard(self) -> None:
        before = len(self.sink.actions)
        command = Command.create(Action.RIGHT, "test")
        for _ in range(2):
            request = Request(
                f"{self.base_url}/command",
                data=encode_command(command),
                method="POST",
                headers={"X-Spilled-Remote-Token": "a" * 20},
            )
            with urlopen(request, timeout=2) as response:
                self.assertTrue(json.load(response)["ok"])
        self.assertEqual(self.sink.actions[before:], [Action.RIGHT])

    def test_rejects_bad_token(self) -> None:
        request = Request(
            f"{self.base_url}/command",
            data=encode_command(Command.create(Action.UP, "test")),
            method="POST",
            headers={"X-Spilled-Remote-Token": "wrong"},
        )
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=2)
        self.assertEqual(context.exception.code, 401)
        context.exception.close()

    def test_health_echoes_browser_origin(self) -> None:
        # A browser dashboard session fetches /health with an Origin header;
        # without an echoed ACAO header the response is unreadable (CORS).
        request = Request(
            f"{self.base_url}/health",
            method="GET",
            headers={"Origin": "https://spilled.overload.studio"},
        )
        with urlopen(request, timeout=2) as response:
            self.assertTrue(json.load(response)["ok"])
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://spilled.overload.studio")
            self.assertEqual(response.headers.get("Access-Control-Allow-Private-Network"), "true")

    def test_preflight_allows_authenticated_browser_post(self) -> None:
        # Authenticated POSTs carry Content-Type + X-Spilled-Remote-Token, so
        # browsers send an OPTIONS preflight first. It must answer 204 with
        # the matching allow-list or no browser session can ever connect.
        request = Request(
            f"{self.base_url}/command",
            method="OPTIONS",
            headers={
                "Origin": "https://spilled.overload.studio",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-spilled-remote-token",
            },
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 204)
            allow_methods = response.headers.get("Access-Control-Allow-Methods", "")
            allow_headers = response.headers.get("Access-Control-Allow-Headers", "").lower()
            self.assertIn("POST", allow_methods)
            self.assertIn("x-spilled-remote-token", allow_headers)
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "https://spilled.overload.studio")

    def test_command_from_browser_origin_succeeds(self) -> None:
        before = len(self.sink.actions)
        request = Request(
            f"{self.base_url}/command",
            data=encode_command(Command.create(Action.UP, "browser-test")),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Spilled-Remote-Token": "a" * 20,
                "Origin": "http://127.0.0.1:5173",
            },
        )
        with urlopen(request, timeout=2) as response:
            self.assertTrue(json.load(response)["ok"])
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:5173")
        self.assertEqual(self.sink.actions[before:], [Action.UP])

    def test_rejection_stays_readable_to_browsers(self) -> None:
        request = Request(
            f"{self.base_url}/command",
            data=encode_command(Command.create(Action.UP, "test")),
            method="POST",
            headers={"X-Spilled-Remote-Token": "wrong", "Origin": "https://spilled.overload.studio"},
        )
        with self.assertRaises(HTTPError) as context:
            urlopen(request, timeout=2)
        self.assertEqual(context.exception.code, 401)
        self.assertEqual(
            context.exception.headers.get("Access-Control-Allow-Origin"),
            "https://spilled.overload.studio",
        )
        context.exception.close()


if __name__ == "__main__":
    unittest.main()
