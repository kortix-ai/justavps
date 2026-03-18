from __future__ import annotations

from collections.abc import Mapping
from typing import Any, TypeVar

from attrs import define as _attrs_define

from ..models.server_type_architecture import ServerTypeArchitecture
from ..models.server_type_cpu_type import ServerTypeCpuType

T = TypeVar("T", bound="ServerType")


@_attrs_define
class ServerType:
    """
    Attributes:
        name (str):
        description (str):
        vcpu (float):
        ram_gb (float):
        disk_gb (float):
        cpu_type (ServerTypeCpuType):
        architecture (ServerTypeArchitecture):
        price_monthly (float): Our price after markup
        provider_price_monthly (float): Raw provider price
        available (bool):
    """

    name: str
    description: str
    vcpu: float
    ram_gb: float
    disk_gb: float
    cpu_type: ServerTypeCpuType
    architecture: ServerTypeArchitecture
    price_monthly: float
    provider_price_monthly: float
    available: bool

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

        available = self.available

        field_dict: dict[str, Any] = {}

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

        cpu_type = ServerTypeCpuType(d.pop("cpu_type"))

        architecture = ServerTypeArchitecture(d.pop("architecture"))

        price_monthly = d.pop("price_monthly")

        provider_price_monthly = d.pop("provider_price_monthly")

        available = d.pop("available")

        server_type = cls(
            name=name,
            description=description,
            vcpu=vcpu,
            ram_gb=ram_gb,
            disk_gb=disk_gb,
            cpu_type=cpu_type,
            architecture=architecture,
            price_monthly=price_monthly,
            provider_price_monthly=provider_price_monthly,
            available=available,
        )

        return server_type
