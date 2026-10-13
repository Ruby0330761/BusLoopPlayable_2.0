#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import file_ref, load_json, path_bytes, sha256_file, sha256_object, sha256_tree, utc_now, write_json_atomic


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="只读评估并显式接受旧 optimize-playable-resources 证据")
    sub = root.add_subparsers(dest="command", required=True)
    assess = sub.add_parser("assess")
    assess.add_argument("--project-root", required=True, type=Path)
    assess.add_argument("--legacy-manifest", required=True, type=Path)
    assess.add_argument("--optimized-ledger", required=True, type=Path)
    assess.add_argument("--resource-root", required=True, type=Path)
    assess.add_argument("--legacy-report", type=Path)
    assess.add_argument("--output", required=True, type=Path)
    accept = sub.add_parser("accept")
    accept.add_argument("--assessment", required=True, type=Path)
    accept.add_argument("--effect-baseline", required=True, type=Path)
    accept.add_argument("--confirmation-text", required=True)
    accept.add_argument("--output", required=True, type=Path)
    return root


def file_count(path: Path) -> int:
    return sum(1 for item in path.rglob("*") if item.is_file() and not item.is_symlink())


def local_time_label(value: object) -> str:
    if not isinstance(value, str) or not value:
        return "未记录时间"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone().strftime("%Y-%m-%d %H:%M（本机时区）")
    except ValueError:
        return value


def verify_assessment_files(assessment: dict[str, Any]) -> list[str]:
    errors = []
    for label, reference in (assessment.get("evidence") or {}).items():
        if not isinstance(reference, dict):
            errors.append(f"LEGACY_EVIDENCE_INVALID:{label}")
            continue
        path = Path(str(reference.get("path", ""))).expanduser().resolve()
        if not path.exists():
            errors.append(f"LEGACY_EVIDENCE_MISSING:{label}")
            continue
        actual = sha256_file(path) if path.is_file() else sha256_tree(path)
        if reference.get("sha256") != actual:
            errors.append(f"LEGACY_EVIDENCE_DRIFT:{label}")
    return errors


def assess(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    manifest_path = args.legacy_manifest.expanduser().resolve()
    ledger_path = args.optimized_ledger.expanduser().resolve()
    resource_root = args.resource_root.expanduser().resolve()
    manifest = load_json(manifest_path)
    ledger = load_json(ledger_path)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "playable-optimized-resource-manifest-v1":
        raise ValueError("旧资源 manifest schemaVersion 不受支持")
    if not isinstance(ledger, dict) or ledger.get("schemaVersion") != "playable-resource-ledger-v1":
        raise ValueError("旧 optimized ledger schemaVersion 不受支持")
    if Path(str(manifest.get("projectRoot", ""))).expanduser().resolve() != project_root:
        raise ValueError("旧 manifest 不属于目标项目")
    if not resource_root.is_dir():
        raise ValueError("旧优化资源根不存在")
    blockers = []
    actual_bytes = path_bytes(resource_root)
    actual_tree_hash = sha256_tree(resource_root)
    actual_count = file_count(resource_root)
    if manifest.get("resourceRootBytes") != actual_bytes:
        blockers.append("LEGACY_RESOURCE_BYTES_DRIFT")
    if manifest.get("resourceRootTreeSha256") != actual_tree_hash:
        blockers.append("LEGACY_RESOURCE_TREE_DRIFT")
    if manifest.get("resourceRootFileCount") != actual_count:
        blockers.append("LEGACY_RESOURCE_COUNT_DRIFT")
    ledger_reference = manifest.get("ledger") or {}
    if ledger_reference.get("sha256") != sha256_file(ledger_path):
        blockers.append("LEGACY_LEDGER_DRIFT")
    transformations = manifest.get("transformations")
    if not isinstance(transformations, list):
        blockers.append("LEGACY_TRANSFORMATIONS_MISSING")
        transformations = []
    retrospective_core = {
        "projectRoot": str(project_root),
        "resourceRootTreeSha256": actual_tree_hash,
        "optimizedLedgerSha256": sha256_file(ledger_path),
        "transformations": transformations,
        "comparison": manifest.get("comparison"),
    }
    evidence = {
        "legacyManifest": file_ref(manifest_path),
        "optimizedLedger": file_ref(ledger_path),
        "resourceRoot": {
            "path": str(resource_root),
            "bytes": actual_bytes,
            "sha256": actual_tree_hash,
        },
    }
    if args.legacy_report:
        evidence["legacyReport"] = file_ref(args.legacy_report.expanduser().resolve())
    origin = {
        "recordedCreatedAt": manifest.get("createdAt"),
        "recordedCreatedAtLocal": local_time_label(manifest.get("createdAt")),
        "recordedRunId": manifest.get("runId"),
        "recordedResourceRoot": manifest.get("resourceRoot"),
        "recordedRetention": manifest.get("retention"),
        "operatorProven": False,
        "explanation": "记录中没有可验证的操作者身份，不能据此判断是用户本人执行",
    }
    created = origin["recordedCreatedAtLocal"]
    run_id = origin["recordedRunId"] or "未记录运行标识"
    return {
        "schemaVersion": "playable-legacy-resource-import-assessment-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "status": "BLOCKED" if blockers else "AWAITING_USER_ACCEPTANCE",
        "userConclusion": (
            "旧资源证据已损坏，不能迁移"
            if blockers
            else f"检测到一套在 {created} 生成的资源测试结果（运行标识 {run_id}）。记录显示当时只在系统临时目录生成，目标项目资源写入为 0；记录中也没有操作者信息，不能证明是你本人执行。建议忽略这套结果，从原始资源重新分析；只有专门验证复用流程时才使用现有结果。"
        ),
        "userDecision": None if blockers else {
            "question": "这套检测到的资源处理结果要怎么处理？",
            "options": [
                {
                    "id": "ignore-existing",
                    "label": "忽略现有结果，重新分析",
                    "effect": "从项目原始资源重新建立引用关系并生成新的短确认单；不会删除现有测试证据",
                    "recommended": True,
                },
                {
                    "id": "reuse-existing",
                    "label": "使用现有结果继续",
                    "effect": "仅用于测试复用流程，不重新处理资源，继续生成并检查 AppLovin 包",
                    "recommended": False,
                },
            ],
            "sourceFilesWillChangeBeforeDecision": False,
        },
        "origin": origin,
        "retrospectivePlanHash": "sha256:" + sha256_object(retrospective_core),
        "retrospectivePlan": retrospective_core,
        "warnings": ["LEGACY_TOOLCHAIN_UNKNOWN", "LEGACY_APPROVAL_REQUIRED"],
        "blockers": blockers,
        "evidence": evidence,
    }


def accept(args: argparse.Namespace) -> dict[str, Any]:
    assessment_path = args.assessment.expanduser().resolve()
    effect_path = args.effect_baseline.expanduser().resolve()
    assessment = load_json(assessment_path)
    effect = load_json(effect_path)
    if not isinstance(assessment, dict) or assessment.get("schemaVersion") != "playable-legacy-resource-import-assessment-v1":
        raise ValueError("legacy assessment schemaVersion 无效")
    if assessment.get("status") != "AWAITING_USER_ACCEPTANCE":
        raise ValueError("legacy assessment 不可接受")
    errors = verify_assessment_files(assessment)
    if errors:
        raise ValueError("；".join(errors))
    if not isinstance(effect, dict) or effect.get("schemaVersion") != "playable-effect-baseline-assessment-v1" or effect.get("status") != "EFFECT_BASELINE_FROZEN":
        raise ValueError("必须提供当前有效的效果基线")
    if Path(str(effect.get("projectRoot", ""))).resolve() != Path(str(assessment.get("projectRoot", ""))).resolve():
        raise ValueError("效果基线与 legacy 资源不属于同一项目")
    confirmation = args.confirmation_text.strip()
    if not confirmation:
        raise ValueError("用户确认原话不能为空")
    evidence = dict(assessment["evidence"])
    evidence["legacyAssessment"] = file_ref(assessment_path)
    evidence["effectBaseline"] = file_ref(effect_path)
    return {
        "schemaVersion": "playable-resource-state-verification-v1",
        "generatedAt": utc_now(),
        "status": "RESOURCE_READY",
        "userConclusion": "已按你的选择沿用现有压缩资源，可以继续生成并检查 AppLovin 包。本次不会重新压缩这些资源；以后资源发生变化时会重新制定方案",
        "projectRoot": assessment["projectRoot"],
        "effectFingerprint": effect.get("effectFingerprint"),
        "resourceReferenceGraphHash": None,
        "resourceAllowlistHash": None,
        "optimizationPlanHash": assessment.get("retrospectivePlanHash"),
        "toolchainLockHash": None,
        "networkPolicy": "LEGACY_UNPROVEN",
        "externalAssetsUsed": None,
        "legacyOneTimeInput": True,
        "warnings": ["LEGACY_TOOLCHAIN_UNKNOWN", "LEGACY_RESOURCE_GRAPH_UNAVAILABLE"],
        "userAcceptance": {
            "confirmationText": confirmation,
            "acceptedAt": utc_now(),
            "assessment": file_ref(assessment_path),
        },
        "evidence": evidence,
        "errors": [],
    }


def main() -> int:
    args = parser().parse_args()
    try:
        result = assess(args) if args.command == "assess" else accept(args)
        write_json_atomic(args.output, result)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.command == "assess" and result["status"] == "BLOCKED":
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
