from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_process_kill_body import (
    PostApiV1MachinesMachineIdToolboxProcessKillBody,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_kill_response_200 import (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_kill_response_401 import (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse401,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_kill_response_403 import (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse403,
)
from ...types import Response


def _get_kwargs(
    machine_id: UUID,
    *,
    body: PostApiV1MachinesMachineIdToolboxProcessKillBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/process/kill".format(
            machine_id=quote(str(machine_id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxProcessKillResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxProcessKillResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = PostApiV1MachinesMachineIdToolboxProcessKillResponse403.from_dict(response.json())

        return response_403

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
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
    body: PostApiV1MachinesMachineIdToolboxProcessKillBody,
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
]:
    """Kill a process

     Sends a signal to a process by PID. Supports SIGTERM, SIGKILL, SIGINT, SIGHUP.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessKillBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxProcessKillResponse200 | PostApiV1MachinesMachineIdToolboxProcessKillResponse401 | PostApiV1MachinesMachineIdToolboxProcessKillResponse403]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesMachineIdToolboxProcessKillBody,
) -> (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
    | None
):
    """Kill a process

     Sends a signal to a process by PID. Supports SIGTERM, SIGKILL, SIGINT, SIGHUP.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessKillBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxProcessKillResponse200 | PostApiV1MachinesMachineIdToolboxProcessKillResponse401 | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
    """

    return sync_detailed(
        machine_id=machine_id,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesMachineIdToolboxProcessKillBody,
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
]:
    """Kill a process

     Sends a signal to a process by PID. Supports SIGTERM, SIGKILL, SIGINT, SIGHUP.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessKillBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxProcessKillResponse200 | PostApiV1MachinesMachineIdToolboxProcessKillResponse401 | PostApiV1MachinesMachineIdToolboxProcessKillResponse403]
    """

    kwargs = _get_kwargs(
        machine_id=machine_id,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    machine_id: UUID,
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesMachineIdToolboxProcessKillBody,
) -> (
    PostApiV1MachinesMachineIdToolboxProcessKillResponse200
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse401
    | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
    | None
):
    """Kill a process

     Sends a signal to a process by PID. Supports SIGTERM, SIGKILL, SIGINT, SIGHUP.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessKillBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxProcessKillResponse200 | PostApiV1MachinesMachineIdToolboxProcessKillResponse401 | PostApiV1MachinesMachineIdToolboxProcessKillResponse403
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            body=body,
        )
    ).parsed
