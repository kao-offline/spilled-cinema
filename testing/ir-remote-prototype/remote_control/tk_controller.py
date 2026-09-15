from __future__ import annotations

import argparse
import os
import threading
import tkinter as tk
from tkinter import ttk

from .protocol import Action, send_command


BUTTONS: tuple[tuple[str, Action, int, int], ...] = (
    ("↑", Action.UP, 0, 1),
    ("←", Action.LEFT, 1, 0),
    ("OK", Action.ENTER, 1, 1),
    ("→", Action.RIGHT, 1, 2),
    ("↓", Action.DOWN, 2, 1),
    ("Back", Action.BACK, 3, 0),
    ("Home", Action.HOME, 3, 1),
    ("Play / Pause", Action.PLAY_PAUSE, 3, 2),
    ("Volume −", Action.VOLUME_DOWN, 4, 0),
    ("Mute", Action.MUTE, 4, 1),
    ("Volume +", Action.VOLUME_UP, 4, 2),
    ("Captions", Action.CAPTIONS, 5, 0),
    ("Fullscreen", Action.FULLSCREEN, 5, 2),
)

KEY_ACTIONS = {
    "Up": Action.UP,
    "Down": Action.DOWN,
    "Left": Action.LEFT,
    "Right": Action.RIGHT,
    "Return": Action.ENTER,
    "Escape": Action.BACK,
    "Home": Action.HOME,
    "space": Action.PLAY_PAUSE,
    "f": Action.FULLSCREEN,
    "m": Action.MUTE,
    "c": Action.CAPTIONS,
}


class RemotePad(ttk.Frame):
    def __init__(self, root: tk.Tk, url: str, token: str) -> None:
        super().__init__(root, padding=18)
        self.url = url
        self.token = token
        self.status = tk.StringVar(value="Ready")
        self.grid(sticky="nsew")
        root.title("Spilled remote prototype")
        root.minsize(430, 520)
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        for column in range(3):
            self.columnconfigure(column, weight=1)
        for row in range(6):
            self.rowconfigure(row, weight=1)

        title = ttk.Label(self, text="REMOTE TEST PAD", font=("Segoe UI", 18, "bold"))
        title.grid(row=0, column=0, columnspan=3, pady=(0, 12), sticky="n")

        for label, action, row, column in BUTTONS:
            button = ttk.Button(self, text=label, command=lambda selected=action: self.send(selected))
            button.grid(row=row + 1, column=column, padx=5, pady=5, ipadx=8, ipady=13, sticky="nsew")

        status = ttk.Label(self, textvariable=self.status, anchor="center")
        status.grid(row=7, column=0, columnspan=3, pady=(12, 0), sticky="ew")
        root.bind("<KeyPress>", self.on_key)

    def on_key(self, event: tk.Event) -> str | None:
        action = KEY_ACTIONS.get(event.keysym)
        if action is None:
            return None
        self.send(action)
        return "break"

    def send(self, action: Action) -> None:
        self.status.set(f"Sending {action.value}…")
        threading.Thread(target=self._send_in_background, args=(action,), daemon=True).start()

    def _send_in_background(self, action: Action) -> None:
        try:
            send_command(self.url, self.token, action, "tkinter-pad")
        except (ConnectionError, ValueError) as error:
            self.after(0, self.status.set, f"Error: {error}")
        else:
            self.after(0, self.status.set, f"Sent: {action.value}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Open the prototype arrow/Enter test pad")
    parser.add_argument("--url", default=os.environ.get("SPILLED_REMOTE_URL", "http://127.0.0.1:8765"))
    parser.add_argument("--token", default=os.environ.get("SPILLED_REMOTE_TOKEN", ""))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.token:
        raise SystemExit("--token or SPILLED_REMOTE_TOKEN is required")
    root = tk.Tk()
    RemotePad(root, args.url, args.token)
    root.mainloop()


if __name__ == "__main__":
    main()
