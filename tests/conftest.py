import os
import tempfile
from pathlib import Path

_root = Path(tempfile.mkdtemp(prefix="chainline-"))
os.environ["DATA_DIR"] = str(_root)
os.environ["DATABASE_URL"] = f"sqlite:///{_root / 'test.db'}"
