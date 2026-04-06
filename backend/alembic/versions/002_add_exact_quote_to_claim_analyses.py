"""Add exact_quote to claim_analyses

Revision ID: 002_exact_quote
Revises: 001_initial_schema
Create Date: 2026-03-29

Stores the extractor-provided exact quoted span from the AI response.
This enables reliable highlighting when serving cached/historical analyses.

Note: Alembic's default `alembic_version.version_num` column is VARCHAR(32),
so keep revision IDs <= 32 characters.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "002_exact_quote"
down_revision: Union[str, Sequence[str], None] = "001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use IF NOT EXISTS to tolerate partial/failed runs.
    op.execute("ALTER TABLE claim_analyses ADD COLUMN IF NOT EXISTS exact_quote TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE claim_analyses DROP COLUMN IF EXISTS exact_quote")
