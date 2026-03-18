from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar
from uuid import UUID

from attrs import define as _attrs_define
from attrs import field as _attrs_field

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_machine_body_env_vars import CreateMachineBodyEnvVars


T = TypeVar("T", bound="CreateMachineBody")


@_attrs_define
class CreateMachineBody:
    """
    Attributes:
        snapshot_id (UUID): Snapshot to boot from
        provider (str): Cloud provider Example: hetzner.
        server_type (str): Provider-specific server type Example: cpx22.
        region (str): Provider-specific region Example: nbg1.
        name (str | Unset): Human-readable name (auto-generated if omitted) Example: my-machine.
        env_vars (CreateMachineBodyEnvVars | Unset): Extra environment variables written to /etc/justavps/env on the
            machine Example: {'API_KEY': 'sk-xxx', 'NODE_ENV': 'production'}.
        docker_image (str | Unset): Docker image to run on boot Example: nginx:latest.
        entrypoint (str | Unset): Container entrypoint override Example: sleep infinity.
    """

    snapshot_id: UUID
    provider: str
    server_type: str
    region: str
    name: str | Unset = UNSET
    env_vars: CreateMachineBodyEnvVars | Unset = UNSET
    docker_image: str | Unset = UNSET
    entrypoint: str | Unset = UNSET
    additional_properties: dict[str, Any] = _attrs_field(init=False, factory=dict)

    def to_dict(self) -> dict[str, Any]:
        snapshot_id = str(self.snapshot_id)

        provider = self.provider

        server_type = self.server_type

        region = self.region

        name = self.name

        env_vars: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env_vars, Unset):
            env_vars = self.env_vars.to_dict()

        docker_image = self.docker_image

        entrypoint = self.entrypoint

        field_dict: dict[str, Any] = {}
        field_dict.update(self.additional_properties)
        field_dict.update(
            {
                "snapshot_id": snapshot_id,
                "provider": provider,
                "server_type": server_type,
                "region": region,
            }
        )
        if name is not UNSET:
            field_dict["name"] = name
        if env_vars is not UNSET:
            field_dict["env_vars"] = env_vars
        if docker_image is not UNSET:
            field_dict["docker_image"] = docker_image
        if entrypoint is not UNSET:
            field_dict["entrypoint"] = entrypoint

        return field_dict

    @classmethod
    def from_dict(cls: type[T], src_dict: Mapping[str, Any]) -> T:
        from ..models.create_machine_body_env_vars import CreateMachineBodyEnvVars

        d = dict(src_dict)
        snapshot_id = UUID(d.pop("snapshot_id"))

        provider = d.pop("provider")

        server_type = d.pop("server_type")

        region = d.pop("region")

        name = d.pop("name", UNSET)

        _env_vars = d.pop("env_vars", UNSET)
        env_vars: CreateMachineBodyEnvVars | Unset
        if isinstance(_env_vars, Unset):
            env_vars = UNSET
        else:
            env_vars = CreateMachineBodyEnvVars.from_dict(_env_vars)

        docker_image = d.pop("docker_image", UNSET)

        entrypoint = d.pop("entrypoint", UNSET)

        create_machine_body = cls(
            snapshot_id=snapshot_id,
            provider=provider,
            server_type=server_type,
            region=region,
            name=name,
            env_vars=env_vars,
            docker_image=docker_image,
            entrypoint=entrypoint,
        )

        create_machine_body.additional_properties = d
        return create_machine_body

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
