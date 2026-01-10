"""Menu widgets for the TUI."""

from typing import TYPE_CHECKING, ClassVar, override

from rich.text import Text
from textual.binding import Binding, BindingType
from textual.containers import Vertical
from textual.message import Message
from textual.reactive import reactive
from textual.widget import Widget
from textual.widgets import Static

if TYPE_CHECKING:
    from textual.app import ComposeResult


class MenuItem(Widget, can_focus=True):
    """Single menu item with keyboard shortcut and label."""

    BINDINGS: ClassVar[list[BindingType]] = [
        Binding("enter", "select", "Select", show=False),
        Binding("space", "select", "Select", show=False),
    ]

    selected: ClassVar[reactive[bool]] = reactive(False)
    highlighted: ClassVar[reactive[bool]] = reactive(False)

    class Selected(Message):
        """Message sent when menu item is selected."""

        item: MenuItem

        def __init__(self, item: MenuItem) -> None:
            self.item = item
            super().__init__()

    def __init__(
        self,
        key: str,
        label: str,
        *,
        is_disabled: bool = False,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.key: str = key
        self.label: str = label
        self._is_disabled: bool = is_disabled

    @override
    def render(self) -> Text:
        """Render the menu item."""
        if self._is_disabled:
            return Text.assemble(
                ("  [", "dim"),
                (self.key, "dim"),
                ("] ", "dim"),
                (self.label, "dim italic"),
            )

        key_style = "bold green" if not self.has_focus else "bold white on green"
        label_style = ""
        if self.has_focus:
            label_style = "bold"

        return Text.assemble(
            ("  [", "dim"),
            (self.key, key_style),
            ("] ", "dim"),
            (self.label, label_style),
        )

    def on_focus(self) -> None:
        """Handle focus event."""
        self.highlighted = True

    def on_blur(self) -> None:
        """Handle blur event."""
        self.highlighted = False

    def action_select(self) -> None:
        """Select this menu item."""
        if not self._is_disabled:
            _ = self.post_message(self.Selected(self))

    def on_click(self) -> None:
        """Handle click event."""
        if not self._is_disabled:
            _ = self.focus()
            _ = self.post_message(self.Selected(self))


class MenuSection(Vertical):
    """Container for a group of menu items with a title."""

    DEFAULT_CSS: ClassVar[str] = """
    MenuSection {
        height: auto;
        margin-bottom: 1;
    }

    MenuSection > Static {
        padding: 0 1;
        margin-bottom: 0;
    }

    MenuSection > MenuItem {
        height: 1;
    }
    """

    section_title: str
    menu_items: list[tuple[str, str]]

    def __init__(
        self,
        title: str,
        items: list[tuple[str, str]],
        *,
        name: str | None = None,
        id: str | None = None,
        classes: str | None = None,
    ) -> None:
        super().__init__(name=name, id=id, classes=classes)
        self.section_title = title
        self.menu_items = items

    @override
    def compose(self) -> ComposeResult:
        """Compose the menu section."""
        yield Static(f"[bold cyan]{self.section_title}[/bold cyan]")
        for key, label in self.menu_items:
            yield MenuItem(key, label, id=f"menu-{key}")
