from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

T = TypeVar("T", bound="Account")


@_attrs_define
class Account:
    """
    Attributes:
        id (UUID):
        email (str):
        name (None | str):
        machines_count (float):
        stripe_customer_id (None | str):
        created_at (str):
    """

    id: UUID
    email: str
    name: None | str
    machines_count: float
    stripe_customer_id: None | str
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        id = str(self.id)

        email = self.email

        name: None | str
        name = self.name

        machines_count = self.machines_count

        stripe_customer_id: None | str
        stripe_customer_id = self.stripe_customer_id

        created_at = self.created_at

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "email": email,
                "name": name,
                "machines_count": machines_count,
                "stripe_customer_id": stripe_customer_id,
                "created_at": created_at,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        id = UUID(d.pop("id"))

        email = d.pop("email")

        def _parse_name(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        name = _parse_name(d.pop("name"))

        machines_count = d.pop("machines_count")

        def _parse_stripe_customer_id(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        stripe_customer_id = _parse_stripe_customer_id(d.pop("stripe_customer_id"))

        created_at = d.pop("created_at")

        account = cls(
            id=id,
            email=email,
            name=name,
            machines_count=machines_count,
            stripe_customer_id=stripe_customer_id,
            created_at=created_at,
        )

        return account
