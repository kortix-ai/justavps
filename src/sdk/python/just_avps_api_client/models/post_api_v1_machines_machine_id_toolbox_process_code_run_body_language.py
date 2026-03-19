from enum import Enum


class PostApiV1MachinesMachineIdToolboxProcessCodeRunBodyLanguage(str, Enum):
    BASH = "bash"
    GO = "go"
    JAVASCRIPT = "javascript"
    NODE = "node"
    PYTHON = "python"
    PYTHON3 = "python3"
    RUBY = "ruby"
    SHELL = "shell"
    TYPESCRIPT = "typescript"

    def __str__(self) -> str:
        return str(self.value)
