from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_ssh_keys_response_200_ssh_keys_item import GetApiV1SshKeysResponse200SshKeysItem


T = TypeVar("T", bound="GetApiV1SshKeysResponse200")


@_attrs_define
class GetApiV1SshKeysResponse200:
    """
    Attributes:
        ssh_keys (list[GetApiV1SshKeysResponse200SshKeysItem]):
    """

    ssh_keys: list[GetApiV1SshKeysResponse200SshKeysItem]
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        ssh_keys = []
        for ssh_keys_item_data in self.ssh_keys:
            ssh_keys_item = ssh_keys_item_data.to_dict()
            ssh_keys.append(ssh_keys_item)

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "ssh_keys": ssh_keys,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_ssh_keys_response_200_ssh_keys_item import GetApiV1SshKeysResponse200SshKeysItem

        d = dict(src_dict)
        ssh_keys = []
        _ssh_keys = d.pop("ssh_keys")
        for ssh_keys_item_data in _ssh_keys:
            ssh_keys_item = GetApiV1SshKeysResponse200SshKeysItem.from_dict(ssh_keys_item_data)

            ssh_keys.append(ssh_keys_item)

        get_api_v1_ssh_keys_response_200 = cls(
            ssh_keys=ssh_keys,
        )

        get_api_v1_ssh_keys_response_200.additional_properties = d
        return get_api_v1_ssh_keys_response_200

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
