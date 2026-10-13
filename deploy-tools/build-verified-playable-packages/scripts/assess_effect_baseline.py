#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, sha256_object, utc_now, write_json_atomic


DIMENSIONS = (
    "editorRuntime",
    "coreGameplay",
    "visual",
    "animation",
    "interaction",
    "cta",
    "audio",
    "projectStage",
    "humanEffectConfirmation",
)
VALID_STATUSES = {"READY", "INCOMPLETE", "UNKNOWN"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="校验效果基线是否足以进入资源优化")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def normalize_dimension(name: str, value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"效果维度 {name} 必须是对象")
    status = value.get("status")
    sources = value.get("sources")
    if status not in VALID_STATUSES:
        raise ValueError(f"效果维度 {name} 状态无效：{status}")
    if not isinstance(sources, list) or not sources or not all(isinstance(item, str) and item.strip() for item in sources):
        raise ValueError(f"效果维度 {name} 必须提供至少一条证据来源")
    return {"status": status, "sources": [item.strip() for item in sources]}


def assess(project_root: Path, evidence_path: Path) -> dict[str, Any]:
    project_root = project_root.expanduser().resolve()
    evidence_path = evidence_path.expanduser().resolve()
    if not project_root.is_dir():
        raise ValueError(f"项目目录不存在：{project_root}")
    evidence = load_json(evidence_path)
    if not isinstance(evidence, dict) or evidence.get("schemaVersion") != "playable-effect-baseline-evidence-v1":
        raise ValueError("效果基线证据 schemaVersion 必须为 playable-effect-baseline-evidence-v1")
    raw_dimensions = evidence.get("dimensions")
    if not isinstance(raw_dimensions, dict):
        raise ValueError("效果基线证据缺少 dimensions")
    dimensions = {name: normalize_dimension(name, raw_dimensions.get(name)) for name in DIMENSIONS}

    blockers = []
    for name, value in dimensions.items():
        if value["status"] != "READY":
            blockers.append({"code": "EFFECT_BASELINE_INCOMPLETE", "dimension": name, "status": value["status"]})

    artifact_result = None
    artifact = evidence.get("artifact")
    if artifact is not None:
        if not isinstance(artifact, dict) or not isinstance(artifact.get("path"), str):
            raise ValueError("artifact 必须包含 path")
        candidate = Path(artifact["path"]).expanduser()
        if not candidate.is_absolute():
            candidate = project_root / candidate
        candidate = candidate.resolve()
        runtime_evidence = artifact.get("runtimeEvidence")
        if not candidate.is_file():
            blockers.append({"code": "EFFECT_BASELINE_ARTIFACT_MISSING", "path": str(candidate)})
        elif not isinstance(runtime_evidence, list) or not runtime_evidence:
            blockers.append({"code": "EFFECT_BASELINE_RUNTIME_EVIDENCE_MISSING", "path": str(candidate)})
        else:
            actual_sha = sha256_file(candidate)
            expected_sha = artifact.get("expectedSha256")
            if expected_sha and expected_sha != actual_sha:
                blockers.append({"code": "EFFECT_BASELINE_ARTIFACT_DRIFT", "path": str(candidate)})
            artifact_result = {
                "path": str(candidate),
                "bytes": candidate.stat().st_size,
                "sha256": actual_sha,
                "runtimeEvidence": runtime_evidence,
            }

    status = "EFFECT_BASELINE_FROZEN" if not blockers else "BLOCKED"
    fingerprint_input = {
        "dimensions": dimensions,
        "artifact": artifact_result,
        "variant": evidence.get("variant"),
    }
    return {
        "schemaVersion": "playable-effect-baseline-assessment-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "status": status,
        "userConclusion": (
            "试玩效果基线已固定，可以开始分析当前素材使用的资源"
            if status == "EFFECT_BASELINE_FROZEN"
            else "试玩效果尚未形成完整可比较基线，本轮不能执行有损资源优化"
        ),
        "effectFingerprint": "sha256:" + sha256_object(fingerprint_input),
        "dimensions": dimensions,
        "artifact": artifact_result,
        "blockers": blockers,
        "sourceEvidence": {"path": str(evidence_path), "sha256": sha256_file(evidence_path)},
    }


def main() -> int:
    args = parse_args()
    try:
        report = assess(args.project_root, args.evidence)
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "EFFECT_BASELINE_FROZEN" else 2


if __name__ == "__main__":
    raise SystemExit(main())
