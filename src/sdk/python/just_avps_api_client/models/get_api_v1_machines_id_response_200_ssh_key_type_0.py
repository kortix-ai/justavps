from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1MachinesIdResponse200SshKeyType0")


@_attrs_define
class GetApiV1MachinesIdResponse200SshKeyType0:
    """
    Attributes:
        private_key (None | str):
        public_key (None | str):
        setup_command (None | str):
        key_path (str):
    """

    private_key: None | str
    public_key: None | str
    setup_command: None | str
    key_path: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        private_key: None | str
        private_key = self.private_key

        public_key: None | str
        public_key = self.public_key

        setup_command: None | str
        setup_command = self.setup_command

        key_path = self.key_path

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "private_key": private_key,
                "public_key": public_key,
                "setup_command": setup_command,
                "key_path": key_path,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)

        def _parse_private_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        private_key = _parse_private_key(d.pop("private_key"))

        def _parse_public_key(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        public_key = _parse_public_key(d.pop("public_key"))

        def _parse_setup_command(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        setup_command = _parse_setup_command(d.pop("setup_command"))

        key_path = d.pop("key_path")

        get_api_v1_machines_id_response_200_ssh_key_type_0 = cls(
            private_key=private_key,
            public_key=public_key,
            setup_command=setup_command,
            key_path=key_path,
        )

        get_api_v1_machines_id_response_200_ssh_key_type_0.additional_properties = d
        return get_api_v1_machines_id_response_200_ssh_key_type_0

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
