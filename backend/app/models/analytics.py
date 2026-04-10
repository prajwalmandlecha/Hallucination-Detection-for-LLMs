"""
Pydantic schemas for analytics endpoints.
"""

from datetime import datetime
from pydantic import BaseModel, Field


class AnalyticsSummary(BaseModel):
    """Top-level summary metrics for the selected time window."""

    total_analyses: int = 0
    total_claims: int = 0
    total_hallucinations: int = 0
    average_confidence: float = Field(0.0, ge=0.0, le=1.0)


class AnalyticsModelStat(BaseModel):
    """Per-model analytics metrics."""

    id: str
    name: str
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    hallucinations: int = 0
    sources: int = 0
    analyses: int = 0
    claims: int = 0


class AnalyticsTimelinePoint(BaseModel):
    """Daily trend data point for charting."""

    date: str
    label: str
    hallucinations: int = 0
    confidence: float = Field(0.0, ge=0.0, le=1.0)


class AnalyticsOverviewResponse(BaseModel):
    """Response body for GET /analytics/overview."""

    days: int
    generated_at: datetime
    summary: AnalyticsSummary
    models: list[AnalyticsModelStat]
    timeline: list[AnalyticsTimelinePoint]
