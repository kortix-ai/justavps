from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

T = TypeVar("T", bound="GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem")


@_attrs_define
class GetApiV1AccountUsageResponse200CurrentPeriodMachinesItem:
    """
    Attributes:
        id (UUID):
        slug (str):
        server_type (str):
        status (str):
    """

    id: UUID
    slug: str
    server_type: str
    status: str
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        server_type = self.server_type

        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "server_type": server_type,
                "status": status,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        server_type = d.pop("server_type")

        status = d.pop("status")

        get_api_v1_account_usage_response_200_current_period_machines_item = cls(
            id=id,
            slug=slug,
            server_type=server_type,
            status=status,
        )

        get_api_v1_account_usage_response_200_current_period_machines_item.additional_properties = d
        return get_api_v1_account_usage_response_200_current_period_machines_item

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
