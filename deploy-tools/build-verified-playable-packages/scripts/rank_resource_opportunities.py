#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, utc_now, write_json_atomic


def score(item: dict[str, Any]) -> float:
    values = item.get("priorityInputs") or {}
    savings = float(values.get("estimatedNetSavingsBytes") or 0)
    confidence = max(0.0, float(values.get("evidenceConfidence") or 0))
    risk = max(0.01, float(values.get("effectRisk") or 1))
    compatibility = max(0.01, float(values.get("compatibilityCost") or 1))
    validation = max(0.01, float(values.get("validationCost") or 1))
    return savings * confidence / risk / compatibility / validation


def main() -> int:
    parser = argparse.ArgumentParser(description="按 exact artifact 净收益、证据、风险和验证成本动态排序资源机会")
    parser.add_argument("--audit", required=True, type=Path)
    parser.add_argument("--exact-result", action="append", default=[], type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        audit = load_json(args.audit.expanduser().resolve())
        if not isinstance(audit, dict) or audit.get("schemaVersion") != "resource-opportunity-audit-v1":
            raise ValueError("资源机会审计 schemaVersion 无效")
        completed = []
        completed_paths = set()
        for path in args.exact_result:
            value = load_json(path.expanduser().resolve())
            if not isinstance(value, dict) or value.get("schemaVersion") != "playable-resource-exact-candidate-result-v1":
                raise ValueError("exact artifact 结果 schemaVersion 无效")
            before = value.get("artifactBefore") or {}
            after = value.get("artifactAfter") or {}
            if not before.get("sha256") or not after.get("sha256") or before.get("sha256") == after.get("sha256"):
                raise ValueError("每个已完成候选必须重新构建并绑定不同 SHA 的 exact artifact")
            if int(value.get("netSavingsBytes") or 0) <= 0:
                raise ValueError("已完成候选没有 exact artifact 正向净收益")
            completed_paths.add(str(value.get("actionPath") or ""))
            completed.append({"path": value.get("actionPath"), "netSavingsBytes": value.get("netSavingsBytes"), "evidence": str(path.resolve())})
        queue = []
        for item in audit.get("items") or []:
            if not isinstance(item, dict) or item.get("decision") != "OPTIMIZE" or item.get("path") in completed_paths:
                continue
            queue.append({"path": item.get("path"), "priorityScore": round(score(item), 6), "priorityInputs": item.get("priorityInputs")})
        queue.sort(key=lambda item: (-item["priorityScore"], str(item["path"])))
        report = {
            "schemaVersion": "playable-resource-optimization-queue-v1", "generatedAt": utc_now(),
            "queue": queue, "completed": completed, "rerankedAfterExactArtifact": bool(completed),
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "remaining": len(queue)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
