from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_files_move_response_200 import (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_move_response_401 import (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse401,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_move_response_404 import (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse404,
)
from ...types import UNSET, Response


def _get_kwargs(
    machine_id: UUID,
    *,
    source: str,
    destination: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["source"] = source

    params["destination"] = destination

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/move".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxFilesMoveResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxFilesMoveResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiV1MachinesMachineIdToolboxFilesMoveResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    source: str,
    destination: str,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
]:
    """Move or rename a file/directory

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        source (str): Source path Example: /root/old.txt.
        destination (str): Destination path Example: /root/new.txt.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesMoveResponse200 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        source=source,
        destination=destination,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    source: str,
    destination: str,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
    | None
):
    """Move or rename a file/directory

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        source (str): Source path Example: /root/old.txt.
        destination (str): Destination path Example: /root/new.txt.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesMoveResponse200 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        source=source,
        destination=destination,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    source: str,
    destination: str,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
]:
    """Move or rename a file/directory

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        source (str): Source path Example: /root/old.txt.
        destination (str): Destination path Example: /root/new.txt.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesMoveResponse200 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        source=source,
        destination=destination,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    source: str,
    destination: str,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesMoveResponse200
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401
    | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
    | None
):
    """Move or rename a file/directory

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        source (str): Source path Example: /root/old.txt.
        destination (str): Destination path Example: /root/new.txt.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesMoveResponse200 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse401 | PostApiV1MachinesMachineIdToolboxFilesMoveResponse404
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            source=source,
            destination=destination,
        )
    ).parsed
