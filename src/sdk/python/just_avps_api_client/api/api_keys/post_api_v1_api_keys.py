from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.post_api_v1_api_keys_body import PostApiV1ApiKeysBody
from ...models.post_api_v1_api_keys_response_201 import PostApiV1ApiKeysResponse201
from ...models.post_api_v1_api_keys_response_400 import PostApiV1ApiKeysResponse400
from ...models.post_api_v1_api_keys_response_401 import PostApiV1ApiKeysResponse401
from ...types import Response


def _get_kwargs(
    *,
    body: PostApiV1ApiKeysBody,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/api-keys",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401 | None:
    if response.status_code == 201:
        response_201 = PostApiV1ApiKeysResponse201.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = PostApiV1ApiKeysResponse400.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = PostApiV1ApiKeysResponse401.from_dict(response.json())

        return response_401

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1ApiKeysBody,
) -> Response[PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401]:
    """Create an API key

     **The full key is only returned once in this response.** Store it securely.

    Args:
        body (PostApiV1ApiKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401]
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
    body: PostApiV1ApiKeysBody,
) -> PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401 | None:
    """Create an API key

     **The full key is only returned once in this response.** Store it securely.

    Args:
        body (PostApiV1ApiKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: PostApiV1ApiKeysBody,
) -> Response[PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401]:
    """Create an API key

     **The full key is only returned once in this response.** Store it securely.

    Args:
        body (PostApiV1ApiKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: PostApiV1ApiKeysBody,
) -> PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401 | None:
    """Create an API key

     **The full key is only returned once in this response.** Store it securely.

    Args:
        body (PostApiV1ApiKeysBody):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        PostApiV1ApiKeysResponse201 | PostApiV1ApiKeysResponse400 | PostApiV1ApiKeysResponse401
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
