from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_machines_machine_id_toolbox_files_response_200 import (
    GetApiV1MachinesMachineIdToolboxFilesResponse200,
)
from ...models.get_api_v1_machines_machine_id_toolbox_files_response_401 import (
    GetApiV1MachinesMachineIdToolboxFilesResponse401,
)
from ...models.get_api_v1_machines_machine_id_toolbox_files_response_404 import (
    GetApiV1MachinesMachineIdToolboxFilesResponse404,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    machine_id: UUID,
    *,
    path: str | Unset = UNSET,
    depth: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["path"] = path

    params["depth"] = depth

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/machines/{machine_id}/toolbox/files".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
    | None
):
    if response.status_code == 200:
        response_200 = GetApiV1MachinesMachineIdToolboxFilesResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1MachinesMachineIdToolboxFilesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiV1MachinesMachineIdToolboxFilesResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
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
    path: str | Unset = UNSET,
    depth: str | Unset = UNSET,
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
]:
    """List files in a directory

     Lists files and directories at the given path on the machine. Supports recursive listing via `depth`
    parameter.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str | Unset): Directory path (default: /root) Example: /root.
        depth (str | Unset): Depth for recursive listing (default: 1) Example: 1.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesMachineIdToolboxFilesResponse200 | GetApiV1MachinesMachineIdToolboxFilesResponse401 | GetApiV1MachinesMachineIdToolboxFilesResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        depth=depth,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str | Unset = UNSET,
    depth: str | Unset = UNSET,
) -> (
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
    | None
):
    """List files in a directory

     Lists files and directories at the given path on the machine. Supports recursive listing via `depth`
    parameter.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str | Unset): Directory path (default: /root) Example: /root.
        depth (str | Unset): Depth for recursive listing (default: 1) Example: 1.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesMachineIdToolboxFilesResponse200 | GetApiV1MachinesMachineIdToolboxFilesResponse401 | GetApiV1MachinesMachineIdToolboxFilesResponse404
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        path=path,
        depth=depth,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str | Unset = UNSET,
    depth: str | Unset = UNSET,
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
]:
    """List files in a directory

     Lists files and directories at the given path on the machine. Supports recursive listing via `depth`
    parameter.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str | Unset): Directory path (default: /root) Example: /root.
        depth (str | Unset): Depth for recursive listing (default: 1) Example: 1.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesMachineIdToolboxFilesResponse200 | GetApiV1MachinesMachineIdToolboxFilesResponse401 | GetApiV1MachinesMachineIdToolboxFilesResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        depth=depth,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str | Unset = UNSET,
    depth: str | Unset = UNSET,
) -> (
    GetApiV1MachinesMachineIdToolboxFilesResponse200
    | GetApiV1MachinesMachineIdToolboxFilesResponse401
    | GetApiV1MachinesMachineIdToolboxFilesResponse404
    | None
):
    """List files in a directory

     Lists files and directories at the given path on the machine. Supports recursive listing via `depth`
    parameter.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str | Unset): Directory path (default: /root) Example: /root.
        depth (str | Unset): Depth for recursive listing (default: 1) Example: 1.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesMachineIdToolboxFilesResponse200 | GetApiV1MachinesMachineIdToolboxFilesResponse401 | GetApiV1MachinesMachineIdToolboxFilesResponse404
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            path=path,
            depth=depth,
        )
    ).parsed
