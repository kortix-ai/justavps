from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_files_folder_response_200 import (
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_folder_response_401 import (
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse401,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    machine_id: UUID,
    *,
    path: str,
    mode: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["path"] = path

    params["mode"] = mode

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/folder".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200
    | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxFilesFolderResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxFilesFolderResponse401.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
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
    mode: str | Unset = UNSET,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
]:
    """Create a directory

     Creates a directory recursively (like `mkdir -p`).

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory path to create Example: /root/project/src.
        mode (str | Unset): Directory permissions (octal, default: "755") Example: 755.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        mode=mode,
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
    mode: str | Unset = UNSET,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200
    | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
    | None
):
    """Create a directory

     Creates a directory recursively (like `mkdir -p`).

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory path to create Example: /root/project/src.
        mode (str | Unset): Directory permissions (octal, default: "755") Example: 755.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        path=path,
        mode=mode,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    mode: str | Unset = UNSET,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
]:
    """Create a directory

     Creates a directory recursively (like `mkdir -p`).

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory path to create Example: /root/project/src.
        mode (str | Unset): Directory permissions (octal, default: "755") Example: 755.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        mode=mode,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    mode: str | Unset = UNSET,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesFolderResponse200
    | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
    | None
):
    """Create a directory

     Creates a directory recursively (like `mkdir -p`).

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory path to create Example: /root/project/src.
        mode (str | Unset): Directory permissions (octal, default: "755") Example: 755.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesFolderResponse200 | PostApiV1MachinesMachineIdToolboxFilesFolderResponse401
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            path=path,
            mode=mode,
        )
    ).parsed
