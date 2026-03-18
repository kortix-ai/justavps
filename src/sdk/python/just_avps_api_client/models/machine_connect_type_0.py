from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MachineConnectType0")


@_attrs_define
class MachineConnectType0:
    """
    Attributes:
        ssh_command (None | str | Unset):  Example: ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4.
        setup_command (None | str | Unset): One-liner to save SSH key and connect
        vscode_url (str | Unset):  Example: https://abc123.kortix.cloud.
        vscode_password (str | Unset):  Example: randompassword123.
        cursor_ssh (None | str | Unset):  Example: ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4.
    """

    ssh_command: None | str | Unset = UNSET
    setup_command: None | str | Unset = UNSET
    vscode_url: str | Unset = UNSET
    vscode_password: str | Unset = UNSET
    cursor_ssh: None | str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ssh_command: None | str | Unset
        if isinstance(self.ssh_command, Unset):
            ssh_command = UNSET
        else:
            ssh_command = self.ssh_command

        setup_command: None | str | Unset
        if isinstance(self.setup_command, Unset):
            setup_command = UNSET
        else:
            setup_command = self.setup_command

        vscode_url = self.vscode_url

        vscode_password = self.vscode_password

        cursor_ssh: None | str | Unset
        if isinstance(self.cursor_ssh, Unset):
            cursor_ssh = UNSET
        else:
            cursor_ssh = self.cursor_ssh

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if ssh_command is not UNSET:
            field_dict["ssh_command"] = ssh_command
        if setup_command is not UNSET:
            field_dict["setup_command"] = setup_command
        if vscode_url is not UNSET:
            field_dict["vscode_url"] = vscode_url
        if vscode_password is not UNSET:
            field_dict["vscode_password"] = vscode_password
        if cursor_ssh is not UNSET:
            field_dict["cursor_ssh"] = cursor_ssh

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_ssh_command(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        ssh_command = _parse_ssh_command(d.pop("ssh_command", UNSET))

        def _parse_setup_command(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        setup_command = _parse_setup_command(d.pop("setup_command", UNSET))

        vscode_url = d.pop("vscode_url", UNSET)

        vscode_password = d.pop("vscode_password", UNSET)

        def _parse_cursor_ssh(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        cursor_ssh = _parse_cursor_ssh(d.pop("cursor_ssh", UNSET))

        machine_connect_type_0 = cls(
            ssh_command=ssh_command,
            setup_command=setup_command,
            vscode_url=vscode_url,
            vscode_password=vscode_password,
            cursor_ssh=cursor_ssh,
        )

        machine_connect_type_0.additional_properties = d
        return machine_connect_type_0

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
