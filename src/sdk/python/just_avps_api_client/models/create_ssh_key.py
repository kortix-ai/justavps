from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="CreateSSHKey")


@_attrs_define
class CreateSSHKey:
    """
    Attributes:
        name (str):
        public_key (str): SSH public key (e.g. ssh-ed25519 AAAA...)
    """

    name: str
    public_key: str

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        public_key = self.public_key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "public_key": public_key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        public_key = d.pop("public_key")

        create_ssh_key = cls(
            name=name,
            public_key=public_key,
        )

        return create_ssh_key
