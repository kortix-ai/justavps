from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_machines_machine_id_toolbox_files_download_response_401 import (
    GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401,
)
from ...models.get_api_v1_machines_machine_id_toolbox_files_download_response_404 import (
    GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404,
)
from ...types import UNSET, Response


def _get_kwargs(
    machine_id: UUID,
    *,
    path: str,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["path"] = path

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/download".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
    | None
):
    if response.status_code == 200:
        response_200 = cast(Any, None)
        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
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
    path: str,
) -> Response[
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
]:
    """Download a file

     Downloads the raw content of a file. Returns the file with appropriate Content-Type and Content-
    Disposition headers.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File path to download Example: /root/main.go.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401 | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
) -> (
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
    | None
):
    """Download a file

     Downloads the raw content of a file. Returns the file with appropriate Content-Type and Content-
    Disposition headers.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File path to download Example: /root/main.go.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401 | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        path=path,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
) -> Response[
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
]:
    """Download a file

     Downloads the raw content of a file. Returns the file with appropriate Content-Type and Content-
    Disposition headers.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File path to download Example: /root/main.go.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401 | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
) -> (
    Any
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401
    | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
    | None
):
    """Download a file

     Downloads the raw content of a file. Returns the file with appropriate Content-Type and Content-
    Disposition headers.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File path to download Example: /root/main.go.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse401 | GetApiV1MachinesMachineIdToolboxFilesDownloadResponse404
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            path=path,
        )
    ).parsed
