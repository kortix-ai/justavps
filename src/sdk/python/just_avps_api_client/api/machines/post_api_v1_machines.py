from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_machines_body import PostApiV1MachinesBody
from ...models.post_api_v1_machines_response_202 import PostApiV1MachinesResponse202
from ...models.post_api_v1_machines_response_400 import PostApiV1MachinesResponse400
from ...models.post_api_v1_machines_response_401 import PostApiV1MachinesResponse401
from ...models.post_api_v1_machines_response_402 import PostApiV1MachinesResponse402
from ...models.post_api_v1_machines_response_404 import PostApiV1MachinesResponse404
from ...types import Response


def _get_kwargs(
    *,
    body: PostApiV1MachinesBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/machines",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> (
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
    | None
):
    if response.status_code == 202:
        response_202 = PostApiV1MachinesResponse202.from_dict(response.json())

        return response_202

    if response.status_code == 400:
        response_400 = PostApiV1MachinesResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1MachinesResponse401.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = PostApiV1MachinesResponse402.from_dict(response.json())

        return response_402

    if response.status_code == 404:
        response_404 = PostApiV1MachinesResponse404.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesBody,
) -> Response[
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
]:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (PostApiV1MachinesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesResponse202 | PostApiV1MachinesResponse400 | PostApiV1MachinesResponse401 | PostApiV1MachinesResponse402 | PostApiV1MachinesResponse404]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesBody,
) -> (
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
    | None
):
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (PostApiV1MachinesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesResponse202 | PostApiV1MachinesResponse400 | PostApiV1MachinesResponse401 | PostApiV1MachinesResponse402 | PostApiV1MachinesResponse404
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesBody,
) -> Response[
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
]:
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (PostApiV1MachinesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1MachinesResponse202 | PostApiV1MachinesResponse400 | PostApiV1MachinesResponse401 | PostApiV1MachinesResponse402 | PostApiV1MachinesResponse404]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiV1MachinesBody,
) -> (
    PostApiV1MachinesResponse202
    | PostApiV1MachinesResponse400
    | PostApiV1MachinesResponse401
    | PostApiV1MachinesResponse402
    | PostApiV1MachinesResponse404
    | None
):
    """Create a machine

     Provisions a new VPS machine. If `image_id` is provided, boots from that image. If omitted, boots
    from Ubuntu 24.04.

    Returns 202 if provisioning starts immediately (user has payment method), or 402 with a
    `checkout_url` if payment is required first.

    Args:
        body (PostApiV1MachinesBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1MachinesResponse202 | PostApiV1MachinesResponse400 | PostApiV1MachinesResponse401 | PostApiV1MachinesResponse402 | PostApiV1MachinesResponse404
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
