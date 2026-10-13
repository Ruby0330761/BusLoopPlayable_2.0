#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from rules import RulesetError, verify_ruleset


def main() -> int:
    try:
        result = verify_ruleset()
    except RulesetError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    output = dict(result)
    output["ok"] = True
    output.pop("paths", None)
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

