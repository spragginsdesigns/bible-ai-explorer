"""The committed SureWord installer layout, written without Finder automation."""
from pathlib import Path

root = Path(defines["root"])
files = [(defines["app"], "SureWord.app")]
symlinks = {"Applications": "/Applications"}
# Setting hide_extensions writes FinderInfo onto the signed app bundle and
# makes codesign --verify --deep --strict reject the mounted installer.
icon = str(root / "macos/dmg/SureWord.icns")
background = str(root / "macos/dmg/background.tiff")
format = "UDZO"
filesystem = "HFS+"
window_rect = ((200, 140), (660, 448))
default_view = "icon-view"
icon_size = 128
text_size = 16
icon_locations = {"SureWord.app": (165, 235), "Applications": (495, 235)}
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
