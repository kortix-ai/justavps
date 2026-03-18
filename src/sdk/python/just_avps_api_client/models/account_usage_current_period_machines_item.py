from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

T = TypeVar("T", bound="AccountUsageCurrentPeriodMachinesItem")


@_attrs_define
class AccountUsageCurrentPeriodMachinesItem:
    """
    Attributes:
        id (UUID | Unset):
        slug (str | Unset):
        server_type (str | Unset):
        status (str | Unset):
    """

    id: UUID | Unset = UNSET
    slug: str | Unset = UNSET
    server_type: str | Unset = UNSET
    status: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        id: str | Unset = UNSET
        if not isinstance(self.id, Unset):
            id = str(self.id)

        slug = self.slug

        server_type = self.server_type

        status = self.status

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update({})
        if id is not UNSET:
            field_dict["id"] = id
        if slug is not UNSET:
            field_dict["slug"] = slug
        if server_type is not UNSET:
            field_dict["server_type"] = server_type
        if status is not UNSET:
            field_dict["status"] = status

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        _id = d.pop("id", UNSET)
        id: UUID | Unset
        if isinstance(_id, Unset):
            id = UNSET
        else:
            id = UUID(_id)

        slug = d.pop("slug", UNSET)

        server_type = d.pop("server_type", UNSET)

        status = d.pop("status", UNSET)

        account_usage_current_period_machines_item = cls(
            id=id,
            slug=slug,
            server_type=server_type,
            status=status,
        )

        account_usage_current_period_machines_item.additional_properties = d
        return account_usage_current_period_machines_item

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
