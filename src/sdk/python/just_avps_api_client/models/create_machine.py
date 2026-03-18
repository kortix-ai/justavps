from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, TypeVar, cast
from uuid import UUID

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.create_machine_env_vars import CreateMachineEnvVars


T = TypeVar("T", bound="CreateMachine")


@_attrs_define
class CreateMachine:
    """
    Attributes:
        provider (str): Cloud provider (e.g. "hetzner")
        server_type (str): Provider-specific server type (e.g. "cpx22", "t3.medium")
        region (str): Provider-specific region (e.g. "nbg1", "us-east-1")
        image_id (None | Unset | UUID): Image to boot from. Null = Ubuntu 24.04
        name (str | Unset): Human-readable name
        env_vars (CreateMachineEnvVars | Unset): Extra environment variables written to /etc/justavps/env on the machine
        docker_image (str | Unset): Docker image to run on boot (e.g. "myapp:latest")
        entrypoint (str | Unset): Entrypoint for the Docker container
    """

    provider: str
    server_type: str
    region: str
    image_id: None | Unset | UUID = UNSET
    name: str | Unset = UNSET
    env_vars: CreateMachineEnvVars | Unset = UNSET
    docker_image: str | Unset = UNSET
    entrypoint: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        provider = self.provider

        server_type = self.server_type

        region = self.region

        image_id: None | str | Unset
        if isinstance(self.image_id, Unset):
            image_id = UNSET
        elif isinstance(self.image_id, UUID):
            image_id = str(self.image_id)
        else:
            image_id = self.image_id

        name = self.name

        env_vars: dict[str, Any] | Unset = UNSET
        if not isinstance(self.env_vars, Unset):
            env_vars = self.env_vars.to_dict()

        docker_image = self.docker_image

        entrypoint = self.entrypoint

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "provider": provider,
                "server_type": server_type,
                "region": region,
            }
        )
        if image_id is not UNSET:
            field_dict["image_id"] = image_id
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
        from ..models.create_machine_env_vars import CreateMachineEnvVars

        d = dict(src_dict)
        provider = d.pop("provider")

        server_type = d.pop("server_type")

        region = d.pop("region")

        def _parse_image_id(data: object) -> None | Unset | UUID:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            try:
                if not isinstance(data, str):
                    raise TypeError()
                image_id_type_0 = UUID(data)

                return image_id_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(None | Unset | UUID, data)

        image_id = _parse_image_id(d.pop("image_id", UNSET))

        name = d.pop("name", UNSET)

        _env_vars = d.pop("env_vars", UNSET)
        env_vars: CreateMachineEnvVars | Unset
        if isinstance(_env_vars, Unset):
            env_vars = UNSET
        else:
            env_vars = CreateMachineEnvVars.from_dict(_env_vars)

        docker_image = d.pop("docker_image", UNSET)

        entrypoint = d.pop("entrypoint", UNSET)

        create_machine = cls(
            provider=provider,
            server_type=server_type,
            region=region,
            image_id=image_id,
            name=name,
            env_vars=env_vars,
            docker_image=docker_image,
            entrypoint=entrypoint,
        )

        return create_machine
