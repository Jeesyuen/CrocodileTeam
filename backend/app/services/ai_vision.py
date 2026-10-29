"""AI hazard image classification via Claude (server-side only).

Outputs are suggestions. They never change an incident's verification or
restriction status — only authorised operators can do that.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Literal

import anthropic
from pydantic import BaseModel, Field, ValidationError

from ..config import get_settings

log = logging.getLogger("saferoute.ai")

CATEGORIES = ["fallen_tree", "flooding", "pothole", "damaged_pavement", "construction", "road_debris",
              "poor_lighting", "slippery_surface", "road_accident", "other"]
SEVERITIES = ["low", "medium", "high", "critical"]
BLOCKAGE = ["none", "partial", "complete", "unknown"]


class HazardAnalysis(BaseModel):
    is_hazard_photo: bool
    hazard_type: Literal[tuple(CATEGORIES)]  # type: ignore[valid-type]
    severity: Literal[tuple(SEVERITIES)]  # type: ignore[valid-type]
    possible_blockage: Literal[tuple(BLOCKAGE)]  # type: ignore[valid-type]
    affects: Literal["pedestrians", "vehicles", "both", "unclear"]
    description: str = Field(max_length=400)
    confidence: float = Field(ge=0, le=1)
    requires_verification: bool


SCHEMA = {
    "type": "object",
    "properties": {
        "is_hazard_photo": {"type": "boolean", "description": "False if the photo does not show a road or path hazard."},
        "hazard_type": {"type": "string", "enum": CATEGORIES},
        "severity": {"type": "string", "enum": SEVERITIES},
        "possible_blockage": {"type": "string", "enum": BLOCKAGE},
        "affects": {"type": "string", "enum": ["pedestrians", "vehicles", "both", "unclear"]},
        "description": {"type": "string", "description": "One factual sentence describing what is visible."},
        "confidence": {"type": "number", "description": "0-1 confidence in hazard_type."},
        "requires_verification": {"type": "boolean"},
    },
    "required": ["is_hazard_photo", "hazard_type", "severity", "possible_blockage", "affects", "description",
                 "confidence", "requires_verification"],
    "additionalProperties": False,
}

SYSTEM = (
    "You assist a community road-safety app in Cyberjaya, Malaysia. Users photograph hazards on roads and "
    "pedestrian paths. Classify only what is visible in the photo. Severity guide: low = minor inconvenience; "
    "medium = needs care or a detour for some users; high = blocks or seriously endangers a path or lane; "
    "critical = immediate danger to life (e.g. live accident, deep fast-flowing flood, fallen power line). "
    "If the image is unclear, unrelated, or you are unsure, say so through a low confidence and "
    "is_hazard_photo=false where appropriate. Never guess a location. Always set requires_verification=true "
    "for high or critical severity. Your output is a suggestion that a human operator will review."
)


def analyze_image(data: bytes, media_type: str) -> dict:
    """Returns {"status": ok|uncertain|unavailable|error, "model": str, "result": {...}|None, "message": str}."""
    s = get_settings()
    if not s.anthropic_api_key:
        return {"status": "unavailable", "model": None, "result": None,
                "message": "AI image analysis is not configured on this server. Please classify the hazard manually."}
    if not data:
        return {"status": "error", "model": None, "result": None, "message": "No image provided."}

    client = anthropic.Anthropic(api_key=s.anthropic_api_key, timeout=s.vision_timeout_seconds, max_retries=1)
    try:
        resp = client.beta.messages.create(
            model=s.vision_model,
            max_tokens=2000,
            system=SYSTEM,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                             "data": base64.standard_b64encode(data).decode()}},
                {"type": "text", "text": "Analyse this reported hazard photo."},
            ]}],
        )
    except anthropic.APITimeoutError:
        return _fail("The AI service timed out. You can still submit the report manually.", s.vision_model)
    except anthropic.RateLimitError:
        return _fail("The AI service is busy right now. You can still submit the report manually.", s.vision_model)
    except anthropic.AuthenticationError:
        log.error("Anthropic authentication failed — check ANTHROPIC_API_KEY")
        return _fail("AI analysis is misconfigured on the server. Please classify manually.", s.vision_model)
    except anthropic.APIStatusError as e:
        log.warning("Vision API error %s: %s", e.status_code, e.message)
        return _fail("AI analysis failed. You can still submit the report manually.", s.vision_model)
    except anthropic.APIConnectionError:
        return _fail("Could not reach the AI service. You can still submit the report manually.", s.vision_model)

    if resp.stop_reason == "refusal":
        return _fail("The AI declined to analyse this image. Please classify manually.", resp.model)
    if resp.stop_reason == "max_tokens":
        return _fail("The AI response was incomplete. Please classify manually.", resp.model)
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        result = HazardAnalysis.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError) as e:
        log.warning("Invalid model output: %s", e)
        return _fail("The AI returned an invalid answer. Please classify manually.", resp.model)

    out = result.model_dump()
    if out["severity"] in ("high", "critical"):
        out["requires_verification"] = True
    status = "ok"
    message = "AI suggestion — please review before submitting."
    if not result.is_hazard_photo or result.confidence < 0.5:
        status = "uncertain"
        message = "The AI is not confident about this photo. Please check the category and severity yourself."
    return {"status": status, "model": resp.model, "result": out, "message": message}


def _fail(message: str, model: str | None) -> dict:
    return {"status": "error", "model": model, "result": None, "message": message}
