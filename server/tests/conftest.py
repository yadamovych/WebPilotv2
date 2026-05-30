"""Pytest configuration — adds server/ to sys.path so tests can import app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
