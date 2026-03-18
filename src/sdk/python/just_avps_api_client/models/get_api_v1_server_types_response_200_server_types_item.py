from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..models.get_api_v1_server_types_response_200_server_types_item_architecture import (
    GetApiV1ServerTypesResponse200ServerTypesItemArchitecture,
)
from ..models.get_api_v1_server_types_response_200_server_types_item_cpu_type import (
    GetApiV1ServerTypesResponse200ServerTypesItemCpuType,
)

T = TypeVar("T", bound="GetApiV1ServerTypesResponse200ServerTypesItem")


@_attrs_define
class GetApiV1ServerTypesResponse200ServerTypesItem:
    """
    Attributes:
        name (str):
        description (str):
        vcpu (float):
        ram_gb (float):
        disk_gb (float):
        cpu_type (GetApiV1ServerTypesResponse200ServerTypesItemCpuType):
        architecture (GetApiV1ServerTypesResponse200ServerTypesItemArchitecture):
        price_monthly (float): Our price after markup (includes backups)
        provider_price_monthly (float): Raw provider price
        backup_price_monthly (float): Provider backup cost (20% of provider price)
        available (bool):
    """

    name: str
    description: str
    vcpu: float
    ram_gb: float
    disk_gb: float
    cpu_type: GetApiV1ServerTypesResponse200ServerTypesItemCpuType
    architecture: GetApiV1ServerTypesResponse200ServerTypesItemArchitecture
    price_monthly: float
    provider_price_monthly: float
    backup_price_monthly: float
    available: bool
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        description = self.description

        vcpu = self.vcpu

        ram_gb = self.ram_gb

        disk_gb = self.disk_gb

        cpu_type = self.cpu_type.value

        architecture = self.architecture.value

        price_monthly = self.price_monthly

        provider_price_monthly = self.provider_price_monthly

        backup_price_monthly = self.backup_price_monthly

        available = self.available

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "name": name,
                "description": description,
                "vcpu": vcpu,
                "ram_gb": ram_gb,
                "disk_gb": disk_gb,
                "cpu_type": cpu_type,
                "architecture": architecture,
                "price_monthly": price_monthly,
                "provider_price_monthly": provider_price_monthly,
                "backup_price_monthly": backup_price_monthly,
                "available": available,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        d = dict(src_dict)
        name = d.pop("name")

        description = d.pop("description")

        vcpu = d.pop("vcpu")

        ram_gb = d.pop("ram_gb")

        disk_gb = d.pop("disk_gb")

        cpu_type = GetApiV1ServerTypesResponse200ServerTypesItemCpuType(d.pop("cpu_type"))

        architecture = GetApiV1ServerTypesResponse200ServerTypesItemArchitecture(d.pop("architecture"))

        price_monthly = d.pop("price_monthly")

        provider_price_monthly = d.pop("provider_price_monthly")

        backup_price_monthly = d.pop("backup_price_monthly")

        available = d.pop("available")

        get_api_v1_server_types_response_200_server_types_item = cls(
            name=name,
            description=description,
            vcpu=vcpu,
            ram_gb=ram_gb,
            disk_gb=disk_gb,
            cpu_type=cpu_type,
            architecture=architecture,
            price_monthly=price_monthly,
            provider_price_monthly=provider_price_monthly,
            backup_price_monthly=backup_price_monthly,
            available=available,
        )

        get_api_v1_server_types_response_200_server_types_item.additional_properties = d
        return get_api_v1_server_types_response_200_server_types_item

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
