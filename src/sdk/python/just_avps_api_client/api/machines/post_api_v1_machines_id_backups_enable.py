from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_id_backups_enable_response_200 import PostApiV1MachinesIdBackupsEnableResponse200
from ...models.post_api_v1_machines_id_backups_enable_response_401 import PostApiV1MachinesIdBackupsEnableResponse401
from ...models.post_api_v1_machines_id_backups_enable_response_404 import PostApiV1MachinesIdBackupsEnableResponse404
from ...types import Response


def _get_kwargs(
    id: UUID,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{id}/backups/enable".format(
            id=quote(str(id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesIdBackupsEnableResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesIdBackupsEnableResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = PostApiV1MachinesIdBackupsEnableResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
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
) -> Response[
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
]:
    """Enable automatic backups

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesIdBackupsEnableResponse200 | PostApiV1MachinesIdBackupsEnableResponse401 | PostApiV1MachinesIdBackupsEnableResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
    | None
):
    """Enable automatic backups

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesIdBackupsEnableResponse200 | PostApiV1MachinesIdBackupsEnableResponse401 | PostApiV1MachinesIdBackupsEnableResponse404
    """

    return sync_detailed(
        id=id,
        client=client,
    ).parsed


async def asyncio_detailed(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> Response[
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
]:
    """Enable automatic backups

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesIdBackupsEnableResponse200 | PostApiV1MachinesIdBackupsEnableResponse401 | PostApiV1MachinesIdBackupsEnableResponse404]
    """

    kwargs = _get_kwargs(
        id=id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    id: UUID,
    *,
    client: AuthenticatedClient,
) -> (
    PostApiV1MachinesIdBackupsEnableResponse200
    | PostApiV1MachinesIdBackupsEnableResponse401
    | PostApiV1MachinesIdBackupsEnableResponse404
    | None
):
    """Enable automatic backups

    Args:
        id (UUID):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesIdBackupsEnableResponse200 | PostApiV1MachinesIdBackupsEnableResponse401 | PostApiV1MachinesIdBackupsEnableResponse404
    """

    return (
        await asyncio_detailed(
            id=id,
            client=client,
        )
    ).parsed
