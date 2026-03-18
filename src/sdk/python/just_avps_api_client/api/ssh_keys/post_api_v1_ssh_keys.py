from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_ssh_keys_body import PostApiV1SshKeysBody
from ...models.post_api_v1_ssh_keys_response_201 import PostApiV1SshKeysResponse201
from ...models.post_api_v1_ssh_keys_response_400 import PostApiV1SshKeysResponse400
from ...models.post_api_v1_ssh_keys_response_401 import PostApiV1SshKeysResponse401
from ...types import Response


def _get_kwargs(
    *,
    body: PostApiV1SshKeysBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/ssh-keys",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401 | None:
    if response.status_code == 201:
        response_201 = PostApiV1SshKeysResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiV1SshKeysResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1SshKeysResponse401.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1SshKeysBody,
) -> Response[PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401]:
    """Add an SSH key

     Registers a new SSH public key. Automatically uploaded to all providers.

    Args:
        body (PostApiV1SshKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401]
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
    body: PostApiV1SshKeysBody,
) -> PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401 | None:
    """Add an SSH key

     Registers a new SSH public key. Automatically uploaded to all providers.

    Args:
        body (PostApiV1SshKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1SshKeysBody,
) -> Response[PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401]:
    """Add an SSH key

     Registers a new SSH public key. Automatically uploaded to all providers.

    Args:
        body (PostApiV1SshKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiV1SshKeysBody,
) -> PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401 | None:
    """Add an SSH key

     Registers a new SSH public key. Automatically uploaded to all providers.

    Args:
        body (PostApiV1SshKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1SshKeysResponse201 | PostApiV1SshKeysResponse400 | PostApiV1SshKeysResponse401
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
