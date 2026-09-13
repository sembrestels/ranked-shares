#!/usr/bin/env python3
"""Prompt for the postage signer without showing it or putting it in argv."""
import getpass
from pathlib import Path
import subprocess
import sys

if __name__ == "__main__":
    script = Path(__file__).with_suffix(".cjs")
    secret = getpass.getpass("Swarm batch signer (hidden): ")
    try:
        result = subprocess.run(["node", str(script), "--upload"], input=secret, text=True)
    finally:
        del secret
    sys.exit(result.returncode)
