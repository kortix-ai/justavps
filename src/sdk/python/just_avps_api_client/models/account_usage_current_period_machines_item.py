from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="AccountUsageCurrentPeriodMachinesItem")


@_attrs_define
class AccountUsageCurrentPeriodMachinesItem:
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

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        slug = self.slug

        server_type = self.server_type

        status = self.status

        field_dict: dict[str, Any] = {}

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

        account_usage_current_period_machines_item = cls(
            id=id,
            slug=slug,
            server_type=server_type,
            status=status,
        )

        return account_usage_current_period_machines_item
