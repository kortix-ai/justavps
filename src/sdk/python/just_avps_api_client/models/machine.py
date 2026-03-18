from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field
from dateutil.parser import isoparse

from ..models.machine_status import MachineStatus
from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.machine_connect_type_0 import MachineConnectType0
    from ..models.machine_health_type_0 import MachineHealthType0
    from ..models.machine_ssh_key_type_0 import MachineSSHKeyType0
    from ..models.machine_ur_ls_type_0 import MachineURLsType0


T = TypeVar("T", bound="Machine")


@_attrs_define
class Machine:
    """
    Attributes:
        id (UUID):
        slug (str): Unique 6-char identifier used in URLs Example: abc123.
        name (str):  Example: my-machine.
        status (MachineStatus):
        provider (str):  Example: hetzner.
        server_type (str):  Example: cpx22.
        region (str):  Example: nbg1.
        created_at (datetime.datetime):
        provisioning_stage (None | str | Unset): Current provisioning step Example: server_creating.
        provisioning_stage_updated_at (datetime.datetime | None | Unset):
        snapshot_id (None | Unset | UUID):
        ip (None | str | Unset):  Example: 116.203.0.1.
        price_monthly (float | None | Unset): Monthly price in USD (cents) Example: 12.
        ready_at (datetime.datetime | None | Unset):
        urls (MachineURLsType0 | None | Unset):
        ssh (None | str | Unset):  Example: ssh -i ~/.ssh/justavps_abc123 root@1.2.3.4.
        ssh_key (MachineSSHKeyType0 | None | Unset):
        connect (MachineConnectType0 | None | Unset):
        health (MachineHealthType0 | None | Unset):
    """

    id: UUID
    slug: str
    name: str
    status: MachineStatus
    provider: str
    server_type: str
    region: str
    created_at: datetime.datetime
    provisioning_stage: None | str | Unset = UNSET
    provisioning_stage_updated_at: datetime.datetime | None | Unset = UNSET
    snapshot_id: None | Unset | UUID = UNSET
    ip: None | str | Unset = UNSET
    price_monthly: float | None | Unset = UNSET
    ready_at: datetime.datetime | None | Unset = UNSET
    urls: MachineURLsType0 | None | Unset = UNSET
    ssh: None | str | Unset = UNSET
    ssh_key: MachineSSHKeyType0 | None | Unset = UNSET
    connect: MachineConnectType0 | None | Unset = UNSET
    health: MachineHealthType0 | None | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        from ..models.machine_connect_type_0 import MachineConnectType0
        from ..models.machine_health_type_0 import MachineHealthType0
        from ..models.machine_ssh_key_type_0 import MachineSSHKeyType0
        from ..models.machine_ur_ls_type_0 import MachineURLsType0

        id = str(self.id)

        slug = self.slug

        name = self.name

        status = self.status.value

        provider = self.provider

        server_type = self.server_type

        region = self.region

        created_at = self.created_at.isoformat()

        provisioning_stage: None | str | Unset
        if isinstance(self.provisioning_stage, Unset):
            provisioning_stage = UNSET
        else:
            provisioning_stage = self.provisioning_stage

        provisioning_stage_updated_at: None | str | Unset
        if isinstance(self.provisioning_stage_updated_at, Unset):
            provisioning_stage_updated_at = UNSET
        elif isinstance(self.provisioning_stage_updated_at, datetime.datetime):
            provisioning_stage_updated_at = self.provisioning_stage_updated_at.isoformat()
        else:
            provisioning_stage_updated_at = self.provisioning_stage_updated_at

        snapshot_id: None | str | Unset
        if isinstance(self.snapshot_id, Unset):
            snapshot_id = UNSET
        elif isinstance(self.snapshot_id, UUID):
            snapshot_id = str(self.snapshot_id)
        else:
            snapshot_id = self.snapshot_id

        ip: None | str | Unset
        if isinstance(self.ip, Unset):
            ip = UNSET
        else:
            ip = self.ip

        price_monthly: float | None | Unset
        if isinstance(self.price_monthly, Unset):
            price_monthly = UNSET
        else:
            price_monthly = self.price_monthly

        ready_at: None | str | Unset
        if isinstance(self.ready_at, Unset):
            ready_at = UNSET
        elif isinstance(self.ready_at, datetime.datetime):
            ready_at = self.ready_at.isoformat()
        else:
            ready_at = self.ready_at

        urls: dict[str, Any] | None | Unset
        if isinstance(self.urls, Unset):
            urls = UNSET
        elif isinstance(self.urls, MachineURLsType0):
            urls = self.urls.to_dict()
        else:
            urls = self.urls

        ssh: None | str | Unset
        if isinstance(self.ssh, Unset):
            ssh = UNSET
        else:
            ssh = self.ssh

        ssh_key: dict[str, Any] | None | Unset
        if isinstance(self.ssh_key, Unset):
            ssh_key = UNSET
        elif isinstance(self.ssh_key, MachineSSHKeyType0):
            ssh_key = self.ssh_key.to_dict()
        else:
            ssh_key = self.ssh_key

        connect: dict[str, Any] | None | Unset
        if isinstance(self.connect, Unset):
            connect = UNSET
        elif isinstance(self.connect, MachineConnectType0):
            connect = self.connect.to_dict()
        else:
            connect = self.connect

        health: dict[str, Any] | None | Unset
        if isinstance(self.health, Unset):
            health = UNSET
        elif isinstance(self.health, MachineHealthType0):
            health = self.health.to_dict()
        else:
            health = self.health

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "id": id,
                "slug": slug,
                "name": name,
                "status": status,
                "provider": provider,
                "server_type": server_type,
                "region": region,
                "created_at": created_at,
            }
        )
        if provisioning_stage is not UNSET:
            field_dict["provisioning_stage"] = provisioning_stage
        if provisioning_stage_updated_at is not UNSET:
            field_dict["provisioning_stage_updated_at"] = provisioning_stage_updated_at
        if snapshot_id is not UNSET:
            field_dict["snapshot_id"] = snapshot_id
        if ip is not UNSET:
            field_dict["ip"] = ip
        if price_monthly is not UNSET:
            field_dict["price_monthly"] = price_monthly
        if ready_at is not UNSET:
            field_dict["ready_at"] = ready_at
        if urls is not UNSET:
            field_dict["urls"] = urls
        if ssh is not UNSET:
            field_dict["ssh"] = ssh
        if ssh_key is not UNSET:
            field_dict["ssh_key"] = ssh_key
        if connect is not UNSET:
            field_dict["connect"] = connect
        if health is not UNSET:
            field_dict["health"] = health

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.machine_connect_type_0 import MachineConnectType0
        from ..models.machine_health_type_0 import MachineHealthType0
        from ..models.machine_ssh_key_type_0 import MachineSSHKeyType0
        from ..models.machine_ur_ls_type_0 import MachineURLsType0

        d = dict(src_dict)
        id = UUID(d.pop("id"))

        slug = d.pop("slug")

        name = d.pop("name")

        status = MachineStatus(d.pop("status"))

        provider = d.pop("provider")

        server_type = d.pop("server_type")

        region = d.pop("region")

        created_at = isoparse(d.pop("created_at"))

        def _parse_provisioning_stage(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        provisioning_stage = _parse_provisioning_stage(d.pop("provisioning_stage", UNSET))

        def _parse_provisioning_stage_updated_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                provisioning_stage_updated_at_type_0 = isoparse(data)

                return provisioning_stage_updated_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        provisioning_stage_updated_at = _parse_provisioning_stage_updated_at(
            d.pop("provisioning_stage_updated_at", UNSET)
        )

        def _parse_snapshot_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                snapshot_id_type_0 = UUID(data)

                return snapshot_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        snapshot_id = _parse_snapshot_id(d.pop("snapshot_id", UNSET))

        def _parse_ip(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        ip = _parse_ip(d.pop("ip", UNSET))

        def _parse_price_monthly(data: object) -> float | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(float | None | Unset, data)

        price_monthly = _parse_price_monthly(d.pop("price_monthly", UNSET))

        def _parse_ready_at(data: object) -> datetime.datetime | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                ready_at_type_0 = isoparse(data)

                return ready_at_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(datetime.datetime | None | Unset, data)

        ready_at = _parse_ready_at(d.pop("ready_at", UNSET))

        def _parse_urls(data: object) -> MachineURLsType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_machine_ur_ls_type_0 = MachineURLsType0.from_dict(data)

                return componentsschemas_machine_ur_ls_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineURLsType0 | None | Unset, data)

        urls = _parse_urls(d.pop("urls", UNSET))

        def _parse_ssh(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        ssh = _parse_ssh(d.pop("ssh", UNSET))

        def _parse_ssh_key(data: object) -> MachineSSHKeyType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_machine_ssh_key_type_0 = MachineSSHKeyType0.from_dict(data)

                return componentsschemas_machine_ssh_key_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineSSHKeyType0 | None | Unset, data)

        ssh_key = _parse_ssh_key(d.pop("ssh_key", UNSET))

        def _parse_connect(data: object) -> MachineConnectType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_machine_connect_type_0 = MachineConnectType0.from_dict(data)

                return componentsschemas_machine_connect_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineConnectType0 | None | Unset, data)

        connect = _parse_connect(d.pop("connect", UNSET))

        def _parse_health(data: object) -> MachineHealthType0 | None | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                componentsschemas_machine_health_type_0 = MachineHealthType0.from_dict(data)

                return componentsschemas_machine_health_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(MachineHealthType0 | None | Unset, data)

        health = _parse_health(d.pop("health", UNSET))

        machine = cls(
            id=id,
            slug=slug,
            name=name,
            status=status,
            provider=provider,
            server_type=server_type,
            region=region,
            created_at=created_at,
            provisioning_stage=provisioning_stage,
            provisioning_stage_updated_at=provisioning_stage_updated_at,
            snapshot_id=snapshot_id,
            ip=ip,
            price_monthly=price_monthly,
            ready_at=ready_at,
            urls=urls,
            ssh=ssh,
            ssh_key=ssh_key,
            connect=connect,
            health=health,
        )

        machine.additional_properties = d
        return machine

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
