from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_id_backups_body import PostApiV1MachinesIdBackupsBody
from ...models.post_api_v1_machines_id_backups_response_202 import PostApiV1MachinesIdBackupsResponse202
from ...models.post_api_v1_machines_id_backups_response_401 import PostApiV1MachinesIdBackupsResponse401
from ...models.post_api_v1_machines_id_backups_response_404 import PostApiV1MachinesIdBackupsResponse404
from ...types import UNSET, Response, Unset


def _get_kwargs(
    id: UUID,
    *,
    body: PostApiV1MachinesIdBackupsBody | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{id}/backups".format(
            id=quote(str(id), safe=""),
        ),
    }

    if not isinstance(body, Unset):
        _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
    | None
):
    if response.status_code == 202:
        response_202 = PostApiV1MachinesIdBackupsResponse202.from_dict(response.json())

        return response_202

    if response.status_code == 401:
        response_401 = PostApiV1MachinesIdBackupsResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiV1MachinesIdBackupsResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesIdBackupsBody | Unset = UNSET,
) -> Response[
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
]:
    """Create a manual backup

    Args:
        id (UUID):
        body (PostApiV1MachinesIdBackupsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesIdBackupsResponse202 | PostApiV1MachinesIdBackupsResponse401 | PostApiV1MachinesIdBackupsResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesIdBackupsBody | Unset = UNSET,
) -> (
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
    | None
):
    """Create a manual backup

    Args:
        id (UUID):
        body (PostApiV1MachinesIdBackupsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesIdBackupsResponse202 | PostApiV1MachinesIdBackupsResponse401 | PostApiV1MachinesIdBackupsResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesIdBackupsBody | Unset = UNSET,
) -> Response[
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
]:
    """Create a manual backup

    Args:
        id (UUID):
        body (PostApiV1MachinesIdBackupsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesIdBackupsResponse202 | PostApiV1MachinesIdBackupsResponse401 | PostApiV1MachinesIdBackupsResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesIdBackupsBody | Unset = UNSET,
) -> (
    PostApiV1MachinesIdBackupsResponse202
    | PostApiV1MachinesIdBackupsResponse401
    | PostApiV1MachinesIdBackupsResponse404
    | None
):
    """Create a manual backup

    Args:
        id (UUID):
        body (PostApiV1MachinesIdBackupsBody | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesIdBackupsResponse202 | PostApiV1MachinesIdBackupsResponse401 | PostApiV1MachinesIdBackupsResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
            body=body,
        )
    ).parsed
