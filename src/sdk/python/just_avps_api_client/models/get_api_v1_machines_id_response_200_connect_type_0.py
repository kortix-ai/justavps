from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1MachinesIdResponse200ConnectType0")


@_attrs_define
class GetApiV1MachinesIdResponse200ConnectType0:
    """
    Attributes:
        ssh_command (None | str):
        setup_command (None | str):
        vscode_url (str):
        cursor_ssh (None | str):
    """

    ssh_command: None | str
    setup_command: None | str
    vscode_url: str
    cursor_ssh: None | str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ssh_command: None | str
        ssh_command = self.ssh_command

        setup_command: None | str
        setup_command = self.setup_command

        vscode_url = self.vscode_url

        cursor_ssh: None | str
        cursor_ssh = self.cursor_ssh

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ssh_command": ssh_command,
                "setup_command": setup_command,
                "vscode_url": vscode_url,
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

        def _parse_cursor_ssh(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        cursor_ssh = _parse_cursor_ssh(d.pop("cursor_ssh"))

        get_api_v1_machines_id_response_200_connect_type_0 = cls(
            ssh_command=ssh_command,
            setup_command=setup_command,
            vscode_url=vscode_url,
            cursor_ssh=cursor_ssh,
        )

        get_api_v1_machines_id_response_200_connect_type_0.additional_properties = d
        return get_api_v1_machines_id_response_200_connect_type_0

    @property
    def additional_keys(self) -> list[str]:
        return list(self.additional_properties.keys())

    def __getitem__(self, key: str) -> Any:
        return self.additional_properties[key]

    def __setitem__(self, key: str, value: Any) -> None:
        self.additional_properties[key] = value

    def __delitem__(self, key: str) -> None:
        del self.additional_properties[key]

    def __contains__(self, key: str) -> bool:
        return key in self.additional_properties
