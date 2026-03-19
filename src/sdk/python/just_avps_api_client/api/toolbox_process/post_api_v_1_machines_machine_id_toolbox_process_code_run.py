from http import HTTPStatus
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_machine_id_toolbox_process_code_run_body import (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_code_run_response_200 import (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_code_run_response_401 import (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401,
)
from ...models.post_api_v1_machines_machine_id_toolbox_process_code_run_response_408 import (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408,
)
from ...types import Response


def _get_kwargs(
    machine_id: UUID,
    *,
    body: PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines/{machine_id}/toolbox/process/code-run".format(
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
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
    | None
):
    if response.status_code == 200:
        response_200 = PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 408:
        response_408 = PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408.from_dict(response.json())

        return response_408

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
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
    body: PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
]:
    """Run a code snippet

     Executes a code snippet in the specified language (python, node, bash, ruby, go). Auto-detects
    language if omitted.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessCodeRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408]
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
    body: PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
) -> (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
    | None
):
    """Run a code snippet

     Executes a code snippet in the specified language (python, node, bash, ruby, go). Auto-detects
    language if omitted.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessCodeRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
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
    body: PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
) -> Response[
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
]:
    """Run a code snippet

     Executes a code snippet in the specified language (python, node, bash, ruby, go). Auto-detects
    language if omitted.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessCodeRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408]
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
    body: PostApiV1MachinesMachineIdToolboxProcessCodeRunBody,
) -> (
    PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401
    | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
    | None
):
    """Run a code snippet

     Executes a code snippet in the specified language (python, node, bash, ruby, go). Auto-detects
    language if omitted.

    Args:
        machine_id (UUID): Machine ID Example: 550e8400-e29b-41d4-a716-446655440000.
        body (PostApiV1MachinesMachineIdToolboxProcessCodeRunBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse200 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse401 | PostApiV1MachinesMachineIdToolboxProcessCodeRunResponse408
    """

    return (
        await asyncio_detailed(
            machine_id=machine_id,
            client=client,
            body=body,
        )
    ).parsed
