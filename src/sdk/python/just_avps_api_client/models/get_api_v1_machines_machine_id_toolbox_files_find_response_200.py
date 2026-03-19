from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

if TYPE_CHECKING:
    from ..models.get_api_v1_machines_machine_id_toolbox_files_find_response_200_matches_item import (
        GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem,
    )


T = TypeVar("T", bound="GetApiV1MachinesMachineIdToolboxFilesFindResponse200")


@_attrs_define
class GetApiV1MachinesMachineIdToolboxFilesFindResponse200:
    """
    Attributes:
        matches (list[GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem]):
        truncated (bool):
        total (float):
    """

    matches: list[GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem]
    truncated: bool
    total: float
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        matches = []
        for matches_item_data in self.matches:
            matches_item = matches_item_data.to_dict()
            matches.append(matches_item)

        truncated = self.truncated

        total = self.total

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "matches": matches,
                "truncated": truncated,
                "total": total,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.get_api_v1_machines_machine_id_toolbox_files_find_response_200_matches_item import (
            GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem,
        )

        d = dict(src_dict)
        matches = []
        _matches = d.pop("matches")
        for matches_item_data in _matches:
            matches_item = GetApiV1MachinesMachineIdToolboxFilesFindResponse200MatchesItem.from_dict(matches_item_data)

            matches.append(matches_item)

        truncated = d.pop("truncated")

        total = d.pop("total")

        get_api_v1_machines_machine_id_toolbox_files_find_response_200 = cls(
            matches=matches,
            truncated=truncated,
            total=total,
        )

        get_api_v1_machines_machine_id_toolbox_files_find_response_200.additional_properties = d
        return get_api_v1_machines_machine_id_toolbox_files_find_response_200

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
