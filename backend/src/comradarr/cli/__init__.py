"""Comradarr CLI entrypoints (PRD §24, plan §3 Milestone 8).

The package contains thin scripts that own their own asyncio loop and may
therefore call blocking Alembic / SQLAlchemy APIs directly. RULE-ASYNC-002
forbids calling ``alembic.command.upgrade`` from the Litestar lifespan
because the lifespan runs inside Granian's loop; CLI scripts are explicitly
exempt because they exec from a fresh process and create their own loop.
"""
