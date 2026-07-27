"""File tools via LangChain FileManagementToolkit (root_dir sandbox)."""

from __future__ import annotations

from functools import lru_cache

from langchain_community.agent_toolkits import FileManagementToolkit
from langchain_core.tools import BaseTool

from backend.app.agents.tools.base import workspace_root

# LangChain selected_tools names (also used as our registry tool ids)
READ_FILE = "read_file"
WRITE_FILE = "write_file"
LIST_DIRECTORY = "list_directory"
COPY_FILE = "copy_file"
MOVE_FILE = "move_file"
FILE_SEARCH = "file_search"
FILE_DELETE = "file_delete"

_FILE_TOOL_NAMES = (
    READ_FILE,
    WRITE_FILE,
    LIST_DIRECTORY,
    COPY_FILE,
    MOVE_FILE,
    FILE_SEARCH,
    FILE_DELETE,
)


@lru_cache
def _file_toolkit() -> FileManagementToolkit:
    """Toolkit rooted at AGENT_WORKSPACE_DIR — prevents path escape outside sandbox."""
    return FileManagementToolkit(
        root_dir=str(workspace_root()),
        selected_tools=list(_FILE_TOOL_NAMES),
    )


def _tool_by_name(name: str) -> BaseTool:
    for tool in _file_toolkit().get_tools():
        if tool.name == name:
            return tool
    raise KeyError(f"FileManagementToolkit missing tool: {name}")


def build_read_file_tool() -> BaseTool:
    return _tool_by_name(READ_FILE)


def build_write_file_tool() -> BaseTool:
    return _tool_by_name(WRITE_FILE)


def build_list_directory_tool() -> BaseTool:
    return _tool_by_name(LIST_DIRECTORY)


def build_copy_file_tool() -> BaseTool:
    return _tool_by_name(COPY_FILE)


def build_move_file_tool() -> BaseTool:
    return _tool_by_name(MOVE_FILE)


def build_file_search_tool() -> BaseTool:
    return _tool_by_name(FILE_SEARCH)


def build_file_delete_tool() -> BaseTool:
    return _tool_by_name(FILE_DELETE)


def clear_file_toolkit_cache() -> None:
    """Call after AGENT_WORKSPACE_DIR changes in tests."""
    _file_toolkit.cache_clear()
