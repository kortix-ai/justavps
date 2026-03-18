from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="MachineSSHKeyType0")


@_attrs_define
class MachineSSHKeyType0:
    """
    Attributes:
        private_key (None | str | Unset): PEM-encoded private key (only returned on creation)
        public_key (None | str | Unset):
        setup_command (None | str | Unset): Shell command to save the key and SSH in
        key_path (str | Unset):  Example: ~/.ssh/justavps_abc123.
    """

    private_key: None | str | Unset = UNSET
    public_key: None | str | Unset = UNSET
    setup_command: None | str | Unset = UNSET
    key_path: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        private_key: None | str | Unset
        if isinstance(self.private_key, Unset):
            private_key = UNSET
        else:
            private_key = self.private_key

        public_key: None | str | Unset
        if isinstance(self.public_key, Unset):
            public_key = UNSET
        else:
            public_key = self.public_key

        setup_command: None | str | Unset
        if isinstance(self.setup_command, Unset):
            setup_command = UNSET
        else:
            setup_command = self.setup_command

        key_path = self.key_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if private_key is not UNSET:
            field_dict["private_key"] = private_key
        if public_key is not UNSET:
            field_dict["public_key"] = public_key
        if setup_command is not UNSET:
            field_dict["setup_command"] = setup_command
        if key_path is not UNSET:
            field_dict["key_path"] = key_path

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_private_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        private_key = _parse_private_key(d.pop("private_key", UNSET))

        def _parse_public_key(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        public_key = _parse_public_key(d.pop("public_key", UNSET))

        def _parse_setup_command(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        setup_command = _parse_setup_command(d.pop("setup_command", UNSET))

        key_path = d.pop("key_path", UNSET)

        machine_ssh_key_type_0 = cls(
            private_key=private_key,
            public_key=public_key,
            setup_command=setup_command,
            key_path=key_path,
        )

        machine_ssh_key_type_0.additional_properties = d
        return machine_ssh_key_type_0

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
