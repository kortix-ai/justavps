from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_machines_id_backups_response_200_backups_item import (
        GetApiV1MachinesIdBackupsResponse200BackupsItem,
    )


T = TypeVar("T", bound="GetApiV1MachinesIdBackupsResponse200")


@_attrs_define
class GetApiV1MachinesIdBackupsResponse200:
    """
    Attributes:
        backups (list[GetApiV1MachinesIdBackupsResponse200BackupsItem]):
        backups_enabled (bool):
    """

    backups: list[GetApiV1MachinesIdBackupsResponse200BackupsItem]
    backups_enabled: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        backups = []
        for backups_item_data in self.backups:
            backups_item = backups_item_data.to_dict()
            backups.append(backups_item)

        backups_enabled = self.backups_enabled

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "backups": backups,
                "backups_enabled": backups_enabled,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_machines_id_backups_response_200_backups_item import (
            GetApiV1MachinesIdBackupsResponse200BackupsItem,
        )

        d = dict(src_dict)
        backups = []
        _backups = d.pop("backups")
        for backups_item_data in _backups:
            backups_item = GetApiV1MachinesIdBackupsResponse200BackupsItem.from_dict(backups_item_data)

            backups.append(backups_item)

        backups_enabled = d.pop("backups_enabled")

        get_api_v1_machines_id_backups_response_200 = cls(
            backups=backups,
            backups_enabled=backups_enabled,
        )

        get_api_v1_machines_id_backups_response_200.additional_properties = d
        return get_api_v1_machines_id_backups_response_200

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
