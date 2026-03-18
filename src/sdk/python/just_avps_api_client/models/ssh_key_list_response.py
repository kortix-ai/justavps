from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.ssh_key_list_response_ssh_keys_item import SSHKeyListResponseSshKeysItem


T = TypeVar("T", bound="SSHKeyListResponse")


@_attrs_define
class SSHKeyListResponse:
    """
    Attributes:
        ssh_keys (list[SSHKeyListResponseSshKeysItem]):
    """

    ssh_keys: list[SSHKeyListResponseSshKeysItem]

    def to_dict(self) -> dict[str, Any]:
        ssh_keys = []
        for ssh_keys_item_data in self.ssh_keys:
            ssh_keys_item = ssh_keys_item_data.to_dict()
            ssh_keys.append(ssh_keys_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "ssh_keys": ssh_keys,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.ssh_key_list_response_ssh_keys_item import SSHKeyListResponseSshKeysItem

        d = dict(src_dict)
        ssh_keys = []
        _ssh_keys = d.pop("ssh_keys")
        for ssh_keys_item_data in _ssh_keys:
            ssh_keys_item = SSHKeyListResponseSshKeysItem.from_dict(ssh_keys_item_data)

            ssh_keys.append(ssh_keys_item)

        ssh_key_list_response = cls(
            ssh_keys=ssh_keys,
        )

        return ssh_key_list_response
