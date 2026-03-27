"""
SurveyAI Analyst — AI Service

Uses Google Gemini API (gemini-3.1-flash-lite-preview) for all AI/LLM tasks:
- Column role suggestion
- Cleaning operation reasoning
- Result interpretation
- Report section drafting

API key is fetched from Supabase Vault via service_role at startup.
It is NEVER read from environment variables exposed to users.
All calls include confidence scoring and reasoning fields (invariant A7).
"""

from __future__ import annotations

import os
import json
from functools import lru_cache
from typing import Any

import structlog
import google.generativeai as genai
from supabase import create_client, Client

logger = structlog.get_logger()


@lru_cache(maxsize=1)
def _get_vault_secret(secret_name: str) -> str:
    """
    Fetch a secret from Supabase Vault using service_role key.
    Cached after first call — never re-fetches unless process restarts.
    Frontend/anon roles cannot access private.get_secret().
    """
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    client: Client = create_client(url, key)
    result = client.rpc("private.get_secret", {"secret_name": secret_name}).execute()
    if not result.data:
        raise RuntimeError(f"Secret '{secret_name}' not found in Vault")
    return result.data


def _get_model() -> genai.GenerativeModel:
    """Initialize Gemini client using key from Vault."""
    api_key = _get_vault_secret("GEMINI_API_KEY")
    model_name = _get_vault_secret("GEMINI_MODEL")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel(model_name)


def generate(prompt: str) -> dict[str, Any]:
    """
    Send a prompt to Gemini and return parsed JSON response.

    Args:
        prompt: The prompt to send (must instruct model to return JSON)

    Returns:
        Parsed JSON dict from model response

    Raises:
        ValueError: If response cannot be parsed as JSON
        RuntimeError: If API call fails
    """
    model = _get_model()

    generation_config = genai.types.GenerationConfig(
        temperature=0.2,
        response_mime_type="application/json",
    )

    try:
        response = model.generate_content(
            prompt,
            generation_config=generation_config,
        )
        text = response.text.strip()
        result = json.loads(text)
        logger.info("gemini_response_ok", prompt_len=len(prompt))
        return result
    except json.JSONDecodeError as e:
        logger.error("gemini_json_parse_error", error=str(e))
        raise ValueError(f"Model returned non-JSON response: {e}") from e
    except Exception as e:
        logger.error("gemini_api_error", error=str(e))
        raise RuntimeError(f"Gemini API call failed: {e}") from e
