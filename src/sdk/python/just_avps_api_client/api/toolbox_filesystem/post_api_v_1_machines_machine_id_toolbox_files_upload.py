from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_files_upload_response_200 import (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_upload_response_401 import (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse401,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_upload_response_409 import (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse409,
)
from ...models.post_api_v1_machines_machine_id_toolbox_files_upload_response_413 import (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse413,
)
from ...types import UNSET, Response, Unset


def _get_kwargs(
    machine_id: UUID,
    *,
    path: str,
    mode: str | Unset = UNSET,
    overwrite: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["path"] = path

    params["mode"] = mode

    params["overwrite"] = overwrite

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/files/upload".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxFilesUploadResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxFilesUploadResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 409:
        response_409 = PostApiV1MachinesMachineIdToolboxFilesUploadResponse409.from_dict(response.json())

        return response_409

    if response.status_code == 413:
        response_413 = PostApiV1MachinesMachineIdToolboxFilesUploadResponse413.from_dict(response.json())

        return response_413

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
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
    overwrite: str | Unset = UNSET,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
]:
    """Upload a file

     Uploads content to a file on the machine. Creates parent directories automatically. Supports raw
    body or multipart form upload.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Target file path Example: /root/app.py.
        mode (str | Unset): File permissions (octal, default: "644") Example: 644.
        overwrite (str | Unset): Overwrite if exists (default: "true") Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesUploadResponse200 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        mode=mode,
        overwrite=overwrite,
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
    overwrite: str | Unset = UNSET,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
    | None
):
    """Upload a file

     Uploads content to a file on the machine. Creates parent directories automatically. Supports raw
    body or multipart form upload.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Target file path Example: /root/app.py.
        mode (str | Unset): File permissions (octal, default: "644") Example: 644.
        overwrite (str | Unset): Overwrite if exists (default: "true") Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesUploadResponse200 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        path=path,
        mode=mode,
        overwrite=overwrite,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    mode: str | Unset = UNSET,
    overwrite: str | Unset = UNSET,
) -> Response[
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
]:
    """Upload a file

     Uploads content to a file on the machine. Creates parent directories automatically. Supports raw
    body or multipart form upload.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Target file path Example: /root/app.py.
        mode (str | Unset): File permissions (octal, default: "644") Example: 644.
        overwrite (str | Unset): Overwrite if exists (default: "true") Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxFilesUploadResponse200 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        path=path,
        mode=mode,
        overwrite=overwrite,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    path: str,
    mode: str | Unset = UNSET,
    overwrite: str | Unset = UNSET,
) -> (
    PostApiV1MachinesMachineIdToolboxFilesUploadResponse200
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409
    | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
    | None
):
    """Upload a file

     Uploads content to a file on the machine. Creates parent directories automatically. Supports raw
    body or multipart form upload.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        path (str): Target file path Example: /root/app.py.
        mode (str | Unset): File permissions (octal, default: "644") Example: 644.
        overwrite (str | Unset): Overwrite if exists (default: "true") Example: true.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxFilesUploadResponse200 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse401 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse409 | PostApiV1MachinesMachineIdToolboxFilesUploadResponse413
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            path=path,
            mode=mode,
            overwrite=overwrite,
        )
    ).parsed
