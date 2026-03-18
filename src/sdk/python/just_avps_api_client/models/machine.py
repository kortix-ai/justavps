from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..models.machine_status import MachineStatus

if TYPE_CHECKING:
    from ..models.machine_connect_type_0 import MachineConnectType0
    from ..models.machine_health_type_0 import MachineHealthType0
    from ..models.machine_ssh_key_type_0 import MachineSshKeyType0
    from ..models.machine_urls_type_0 import MachineUrlsType0


T = TypeVar("T", bound="Machine")


@_attrs_define
class Machine:
    """
    Attributes:
        id (UUID):
        slug (str):
        name (str):
        status (MachineStatus):
        provisioning_stage (None | str):
        provisioning_stage_updated_at (None | str):
        provider (str):
        image_id (None | UUID):
        server_type (str):
        region (str):
        ip (None | str):
        price_monthly (float | None):
        created_at (str):
        ready_at (None | str):
        urls (MachineUrlsType0 | None):
        ssh (None | str):
        ssh_key (MachineSshKeyType0 | None):
        connect (MachineConnectType0 | None):
        health (MachineHealthType0 | None):
    """

    id: UUID
    slug: str
    name: str
    status: MachineStatus
    provisioning_stage: None | str
    provisioning_stage_updated_at: None | str
    provider: str
    image_id: None | UUID
    server_type: str
    region: str
    ip: None | str
    price_monthly: float | None
    created_at: str
    ready_at: None | str
    urls: MachineUrlsType0 | None
    ssh: None | str
    ssh_key: MachineSshKeyType0 | None
    connect: MachineConnectType0 | None
    health: MachineHealthType0 | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.machine_connect_type_0 import MachineConnectType0
        from ..models.machine_health_type_0 import MachineHealthType0
        from ..models.machine_ssh_key_type_0 import MachineSshKeyType0
        from ..models.machine_urls_type_0 import MachineUrlsType0

        id = str(self.id)

        slug = self.slug

        name = self.name

        status = self.status.value

        provisioning_stage: None | str
        provisioning_stage = self.provisioning_stage

        provisioning_stage_updated_at: None | str
        provisioning_stage_updated_at = self.provisioning_stage_updated_at

        provider = self.provider

        image_id: None | str
        if isinstance(self.image_id, UUID):
            image_id = str(self.image_id)
        else:
            image_id = self.image_id

        server_type = self.server_type

        region = self.region

        ip: None | str
        ip = self.ip

        price_monthly: float | None
        price_monthly = self.price_monthly

        created_at = self.created_at

        ready_at: None | str
        ready_at = self.ready_at

        urls: dict[str, Any] | None
        if isinstance(self.urls, MachineUrlsType0):
            urls = self.urls.to_dict()
        else:
            urls = self.urls

        ssh: None | str
        ssh = self.ssh

        ssh_key: dict[str, Any] | None
        if isinstance(self.ssh_key, MachineSshKeyType0):
            ssh_key = self.ssh_key.to_dict()
        else:
            ssh_key = self.ssh_key

        connect: dict[str, Any] | None
        if isinstance(self.connect, MachineConnectType0):
            connect = self.connect.to_dict()
        else:
            connect = self.connect

        health: dict[str, Any] | None
        if isinstance(self.health, MachineHealthType0):
            health = self.health.to_dict()
        else:
            health = self.health

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "status": status,
                "provisioning_stage": provisioning_stage,
                "provisioning_stage_updated_at": provisioning_stage_updated_at,
                "provider": provider,
                "image_id": image_id,
                "server_type": server_type,
                "region": region,
                "ip": ip,
                "price_monthly": price_monthly,
                "created_at": created_at,
                "ready_at": ready_at,
                "urls": urls,
                "ssh": ssh,
                "ssh_key": ssh_key,
                "connect": connect,
                "health": health,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.machine_connect_type_0 import MachineConnectType0
        from ..models.machine_health_type_0 import MachineHealthType0
        from ..models.machine_ssh_key_type_0 import MachineSshKeyType0
        from ..models.machine_urls_type_0 import MachineUrlsType0

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        status = MachineStatus(d.pop("status"))

        def _parse_provisioning_stage(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provisioning_stage = _parse_provisioning_stage(d.pop("provisioning_stage"))

        def _parse_provisioning_stage_updated_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        provisioning_stage_updated_at = _parse_provisioning_stage_updated_at(d.pop("provisioning_stage_updated_at"))

        provider = d.pop("provider")

        def _parse_image_id(data: object) -> None | UUID:
            if data is None:
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                image_id_type_0 = UUID(data)

                return image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | UUID, data)

        image_id = _parse_image_id(d.pop("image_id"))

        server_type = d.pop("server_type")

        region = d.pop("region")

        def _parse_ip(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        ip = _parse_ip(d.pop("ip"))

        def _parse_price_monthly(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        price_monthly = _parse_price_monthly(d.pop("price_monthly"))

        created_at = d.pop("created_at")

        def _parse_ready_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        ready_at = _parse_ready_at(d.pop("ready_at"))

        def _parse_urls(data: object) -> MachineUrlsType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                urls_type_0 = MachineUrlsType0.from_dict(data)

                return urls_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineUrlsType0 | None, data)

        urls = _parse_urls(d.pop("urls"))

        def _parse_ssh(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        ssh = _parse_ssh(d.pop("ssh"))

        def _parse_ssh_key(data: object) -> MachineSshKeyType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                ssh_key_type_0 = MachineSshKeyType0.from_dict(data)

                return ssh_key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineSshKeyType0 | None, data)

        ssh_key = _parse_ssh_key(d.pop("ssh_key"))

        def _parse_connect(data: object) -> MachineConnectType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                connect_type_0 = MachineConnectType0.from_dict(data)

                return connect_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineConnectType0 | None, data)

        connect = _parse_connect(d.pop("connect"))

        def _parse_health(data: object) -> MachineHealthType0 | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                health_type_0 = MachineHealthType0.from_dict(data)

                return health_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineHealthType0 | None, data)

        health = _parse_health(d.pop("health"))

        machine = cls(
            id=id,
            slug=slug,
            name=name,
            status=status,
            provisioning_stage=provisioning_stage,
            provisioning_stage_updated_at=provisioning_stage_updated_at,
            provider=provider,
            image_id=image_id,
            server_type=server_type,
            region=region,
            ip=ip,
            price_monthly=price_monthly,
            created_at=created_at,
            ready_at=ready_at,
            urls=urls,
            ssh=ssh,
            ssh_key=ssh_key,
            connect=connect,
            health=health,
        )

        return machine
