"""Editable local notes/to-do list: add, toggle done, delete, persisted to
a JSON file next to config.toml. Unlike Panel/LivePanel in base.py, this
isn't periodically refreshed or network-backed - it loads once on mount
and writes synchronously on every edit, so it deliberately skips the
refresh-worker scaffolding those use.
"""

from __future__ import annotations

import json
from pathlib import Path

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.widgets import Input, Label, ListItem, ListView

HERE = Path(__file__).resolve().parent.parent
NOTES_PATH = HERE / "notes.json"


class NotesPanel(Container):
    """A titled box: a navigable ListView of items plus a hidden-by-default
    Input used for adding a new one."""

    BINDINGS = [
        Binding("a", "add_item", "Add"),
        Binding("space", "toggle_item", "Toggle"),
        Binding("d", "delete_item", "Delete"),
        Binding("escape", "cancel_add", "Cancel", show=False),
    ]

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.border_title = "Notes"
        self._items: list[dict] = []

    def compose(self) -> ComposeResult:
        yield ListView(id="notes_list")
        yield Input(placeholder="New item...", id="notes_input", classes="hidden")

    def on_mount(self) -> None:
        self._items = self._load()
        self._rebuild_list()

    # -- persistence --------------------------------------------------

    def _load(self) -> list[dict]:
        try:
            raw = json.loads(NOTES_PATH.read_text())
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(raw, list):
            return []
        return [
            {"text": str(d["text"]), "done": bool(d.get("done", False))}
            for d in raw
            if isinstance(d, dict) and d.get("text")
        ]

    def _save(self) -> None:
        try:
            NOTES_PATH.write_text(json.dumps(self._items, indent=2))
        except OSError:
            pass  # best-effort; a failed write shouldn't crash the dashboard

    # -- rendering ------------------------------------------------------

    def _rebuild_list(self) -> None:
        list_view = self.query_one("#notes_list", ListView)
        keep_index = list_view.index
        list_view.clear()
        for item in self._items:
            prefix = "[x] " if item["done"] else "[ ] "
            list_view.append(ListItem(Label(prefix + item["text"], markup=False)))
        if self._items:
            list_view.index = min(keep_index or 0, len(self._items) - 1)

    # -- actions (local BINDINGS, fire when a descendant has focus) -----

    def action_add_item(self) -> None:
        input_widget = self.query_one("#notes_input", Input)
        input_widget.remove_class("hidden")
        input_widget.focus()

    def action_cancel_add(self) -> None:
        input_widget = self.query_one("#notes_input", Input)
        input_widget.value = ""
        input_widget.add_class("hidden")
        self.query_one("#notes_list", ListView).focus()

    def action_toggle_item(self) -> None:
        index = self.query_one("#notes_list", ListView).index
        if index is None:
            return
        self._items[index]["done"] = not self._items[index]["done"]
        self._save()
        self._rebuild_list()

    def action_delete_item(self) -> None:
        index = self.query_one("#notes_list", ListView).index
        if index is None:
            return
        del self._items[index]
        self._save()
        self._rebuild_list()

    # -- Input submission (Input.Submitted bubbles up from #notes_input) -

    def on_input_submitted(self, event: Input.Submitted) -> None:
        event.stop()
        text = event.value.strip()
        event.input.value = ""
        event.input.add_class("hidden")
        list_view = self.query_one("#notes_list", ListView)
        list_view.focus()
        if text:
            self._items.append({"text": text, "done": False})
            self._save()
            self._rebuild_list()
            list_view.index = len(self._items) - 1
