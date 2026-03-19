from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.get_api_v1_machines_machine_id_toolbox_files_find_response_200 import (
    GetApiV1MachinesMachineIdToolboxFilesFindResponse200,
)
from ...models.get_api_v1_machines_machine_id_toolbox_files_find_response_401 import (
    GetApiV1MachinesMachineIdToolboxFilesFindResponse401,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    machine_id: UUID,
    *,
    path: str,
    pattern: str,
    include: str | Unset = UNSET,
    max_results: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["path"] = path

    params["pattern"] = pattern

    params["include"] = include

    params["max_results"] = max_results

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/find".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401 | None:
    if response.status_code == 200:
        response_200 = GetApiV1MachinesMachineIdToolboxFilesFindResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = GetApiV1MachinesMachineIdToolboxFilesFindResponse401.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401
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
    pattern: str,
    include: str | Unset = UNSET,
    max_results: str | Unset = UNSET,
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401
]:
    """Search text in files

     Recursively searches for a regex pattern in files under the given path. Like `grep -rn`.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory to search in Example: /root/project.
        pattern (str): Regex pattern to match Example: TODO|FIXME.
        include (str | Unset): Glob filter for filenames Example: *.go.
        max_results (str | Unset): Max matches to return (default: 100) Example: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        pattern=pattern,
        include=include,
        max_results=max_results,
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
    pattern: str,
    include: str | Unset = UNSET,
    max_results: str | Unset = UNSET,
) -> GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401 | None:
    """Search text in files

     Recursively searches for a regex pattern in files under the given path. Like `grep -rn`.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory to search in Example: /root/project.
        pattern (str): Regex pattern to match Example: TODO|FIXME.
        include (str | Unset): Glob filter for filenames Example: *.go.
        max_results (str | Unset): Max matches to return (default: 100) Example: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        path=path,
        pattern=pattern,
        include=include,
        max_results=max_results,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    pattern: str,
    include: str | Unset = UNSET,
    max_results: str | Unset = UNSET,
) -> Response[
    GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401
]:
    """Search text in files

     Recursively searches for a regex pattern in files under the given path. Like `grep -rn`.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory to search in Example: /root/project.
        pattern (str): Regex pattern to match Example: TODO|FIXME.
        include (str | Unset): Glob filter for filenames Example: *.go.
        max_results (str | Unset): Max matches to return (default: 100) Example: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        pattern=pattern,
        include=include,
        max_results=max_results,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    pattern: str,
    include: str | Unset = UNSET,
    max_results: str | Unset = UNSET,
) -> GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401 | None:
    """Search text in files

     Recursively searches for a regex pattern in files under the given path. Like `grep -rn`.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Directory to search in Example: /root/project.
        pattern (str): Regex pattern to match Example: TODO|FIXME.
        include (str | Unset): Glob filter for filenames Example: *.go.
        max_results (str | Unset): Max matches to return (default: 100) Example: 100.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        GetApiV1MachinesMachineIdToolboxFilesFindResponse200 | GetApiV1MachinesMachineIdToolboxFilesFindResponse401
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            path=path,
            pattern=pattern,
            include=include,
            max_results=max_results,
        )
    ).parsed
