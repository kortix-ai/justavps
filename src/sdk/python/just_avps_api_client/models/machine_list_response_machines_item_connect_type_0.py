from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="MachineListResponseMachinesItemConnectType0")


@_attrs_define
class MachineListResponseMachinesItemConnectType0:
    """
    Attributes:
        ssh_command (None | str):
        setup_command (None | str):
        vscode_url (str):
        vscode_password (str):
        cursor_ssh (None | str):
    """

    ssh_command: None | str
    setup_command: None | str
    vscode_url: str
    vscode_password: str
    cursor_ssh: None | str

    def to_dict(self) -> dict[str, Any]:
        ssh_command: None | str
        ssh_command = self.ssh_command

        setup_command: None | str
        setup_command = self.setup_command

        vscode_url = self.vscode_url

        vscode_password = self.vscode_password

        cursor_ssh: None | str
        cursor_ssh = self.cursor_ssh

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ssh_command": ssh_command,
                "setup_command": setup_command,
                "vscode_url": vscode_url,
                "vscode_password": vscode_password,
                "cursor_ssh": cursor_ssh,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_ssh_command(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        ssh_command = _parse_ssh_command(d.pop("ssh_command"))

        def _parse_setup_command(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        setup_command = _parse_setup_command(d.pop("setup_command"))

        vscode_url = d.pop("vscode_url")

        vscode_password = d.pop("vscode_password")

        def _parse_cursor_ssh(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor_ssh = _parse_cursor_ssh(d.pop("cursor_ssh"))

        machine_list_response_machines_item_connect_type_0 = cls(
            ssh_command=ssh_command,
            setup_command=setup_command,
            vscode_url=vscode_url,
            vscode_password=vscode_password,
            cursor_ssh=cursor_ssh,
        )

        return machine_list_response_machines_item_connect_type_0
