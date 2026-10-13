#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, utc_now, write_json_atomic


def main() -> int:
    parser = argparse.ArgumentParser(description="验证资源优化后的新 artifact 不复用旧 Checker 证据")
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--checker-evidence", required=True, type=Path)
    parser.add_argument("--external-status", required=True, choices=["NOT_RUN", "PENDING", "PASS", "ISSUES_FOUND", "UNAVAILABLE"])
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        artifact = args.artifact.expanduser().resolve()
        evidence = load_json(args.checker_evidence.expanduser().resolve())
        if (
            not artifact.is_file()
            or not isinstance(evidence, dict)
            or evidence.get("schemaVersion") != "playable-resource-checker-artifact-binding-v1"
        ):
            raise ValueError("artifact 或 Checker 证据无效")
        current_sha = sha256_file(artifact)
        evidence_artifact = evidence.get("artifact") or {}
        evidence_sha = str(evidence_artifact.get("sha256") or "").removeprefix("sha256:")
        evidence_path = Path(str(evidence_artifact.get("path") or "")).expanduser().resolve()
        evidence_trusted = evidence_path.is_file() and sha256_file(evidence_path) == evidence_sha
        reusable = evidence_trusted and evidence_sha == current_sha
        effective_status = args.external_status if reusable or args.external_status != "PASS" else "NOT_RUN"
        report = {
            "schemaVersion": "playable-resource-checker-artifact-binding-verification-v1", "generatedAt": utc_now(),
            "artifact": {"path": str(artifact), "bytes": artifact.stat().st_size, "sha256": current_sha},
            "checkerEvidenceReusable": reusable,
            "checkerEvidenceTrusted": evidence_trusted,
            "checkerContinuation": "observation-retry" if reusable else "supersede",
            "externalStatus": args.external_status,
            "effectiveExternalStatus": effective_status,
            "localReadyAllowed": effective_status in {"NOT_RUN", "PENDING", "PASS", "UNAVAILABLE"},
            "requiresRework": effective_status == "ISSUES_FOUND",
            "userConclusion": (
                "当前 artifact 与旧 Checker 证据不同；旧证据只读保留，如需补测必须按新 SHA 继续"
                if not reusable else "Checker 证据仍绑定当前 artifact"
            ),
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "checkerEvidenceReusable": reusable}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
