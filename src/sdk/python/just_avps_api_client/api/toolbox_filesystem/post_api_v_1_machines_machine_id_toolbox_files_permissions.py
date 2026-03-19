from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_files_permissions_body import (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_permissions_response_200 import (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_permissions_response_401 import (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_permissions_response_404 import (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404,
)
from ...types import UNSET, Response


def _get_kwargs(
    machine_id: UUID,
    *,
    body: PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
    path: str,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    params: dict[str, Any] = {}

    params["path"] = path

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/permissions".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
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
    body: PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
    path: str,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
]:
    """Set file permissions

     Change mode (chmod), owner, and/or group of a file or directory.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File or directory path Example: /root/script.sh.
        body (PostApiV1MachinesMachineIdToolboxFilesPermissionsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        body=body,
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
    body: PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
    path: str,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
    | None
):
    """Set file permissions

     Change mode (chmod), owner, and/or group of a file or directory.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File or directory path Example: /root/script.sh.
        body (PostApiV1MachinesMachineIdToolboxFilesPermissionsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        body=body,
        path=path,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
    path: str,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
]:
    """Set file permissions

     Change mode (chmod), owner, and/or group of a file or directory.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File or directory path Example: /root/script.sh.
        body (PostApiV1MachinesMachineIdToolboxFilesPermissionsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        body=body,
        path=path,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesMachineIdToolboxFilesPermissionsBody,
    path: str,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401
    | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
    | None
):
    """Set file permissions

     Change mode (chmod), owner, and/or group of a file or directory.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): File or directory path Example: /root/script.sh.
        body (PostApiV1MachinesMachineIdToolboxFilesPermissionsBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse200 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse401 | PostApiV1MachinesMachineIdToolboxFilesPermissionsResponse404
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            body=body,
            path=path,
        )
    ).parsed
