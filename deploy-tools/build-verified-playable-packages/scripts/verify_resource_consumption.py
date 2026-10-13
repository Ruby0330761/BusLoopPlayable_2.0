#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, utc_now, write_json_atomic


SCHEMA = "resource-consumption-proof-v1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="证明最终 artifact 真实消费 Gate B 候选资源字节")
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--platform", required=True)
    parser.add_argument("--payload-report", required=True, type=Path)
    parser.add_argument("--resource-state", required=True, type=Path)
    parser.add_argument("--builder-receipt", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def require(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{path.name} schemaVersion 必须为 {schema}")
    return value


def verified_ref(reference: object, label: str) -> tuple[Path, dict[str, Any]]:
    if not isinstance(reference, dict):
        raise ValueError(f"{label} 缺少文件引用")
    path = Path(str(reference.get("path") or "")).expanduser().resolve()
    if not path.is_file() or sha256_file(path) != reference.get("sha256"):
        raise ValueError(f"{label} 不存在或已漂移")
    value = load_json(path)
    if not isinstance(value, dict):
        raise ValueError(f"{label} 不是 JSON 对象")
    return path, value


def payload_hashes(payload: dict[str, Any]) -> set[str]:
    records = payload.get("payloads")
    if not isinstance(records, list):
        raise ValueError("最终载荷报告缺少完整 payloads；必须重新扫描，不能用 topAssets 推断资源消费")
    return {
        str(item.get("sha256") or "").removeprefix("sha256:")
        for item in records if isinstance(item, dict) and item.get("sha256")
    }


def receipt_actions(path: Path | None, artifact_sha: str) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    receipt = require(path, "playable-resource-builder-receipt-v1")
    if (receipt.get("artifact") or {}).get("sha256") != artifact_sha:
        raise ValueError("builder receipt 未绑定当前 final artifact")
    items = receipt.get("actions")
    if not isinstance(items, list):
        raise ValueError("builder receipt actions 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("actionId"), str):
            raise ValueError("builder receipt action 缺少 actionId")
        entries = item.get("entries")
        if not isinstance(entries, list) or not entries or not all(isinstance(value, str) and value for value in entries):
            raise ValueError(f"builder receipt 缺少最终 entry：{item.get('actionId')}")
        if item["actionId"] in result:
            raise ValueError(f"builder receipt actionId 重复：{item['actionId']}")
        result[item["actionId"]] = item
    return result


def build(args: argparse.Namespace) -> dict[str, Any]:
    artifact = args.artifact.expanduser().resolve()
    if not artifact.is_file():
        raise ValueError(f"最终 artifact 不存在：{artifact}")
    artifact_sha = sha256_file(artifact)
    payload_path = args.payload_report.expanduser().resolve()
    state_path = args.resource_state.expanduser().resolve()
    payload = require(payload_path, "playable-candidate-payload-report-v1")
    state = require(state_path, "playable-resource-state-verification-v1")
    if state.get("status") != "RESOURCE_READY":
        raise ValueError("资源状态尚未就绪")
    payload_artifact = payload.get("artifact") or {}
    if payload.get("platform") != args.platform or payload_artifact.get("sha256") != artifact_sha:
        raise ValueError("最终载荷报告未绑定当前平台 artifact")
    hashes = payload_hashes(payload)
    result_type = state.get("resourceResultType")
    actions: list[dict[str, Any]] = []
    blockers: list[dict[str, Any]] = []
    receipt_by_id = receipt_actions(args.builder_receipt, artifact_sha)

    if result_type == "optimized":
        _, proposal = verified_ref((state.get("evidence") or {}).get("apply_proposal"), "Gate B apply proposal")
        for item in proposal.get("actions") or []:
            if not isinstance(item, dict):
                blockers.append({"code": "RESOURCE_CONSUMPTION_ACTION_INVALID"})
                continue
            action_id = str(item.get("actionId") or "")
            before_sha = str(item.get("beforeSha256") or "").removeprefix("sha256:")
            candidate_sha = str(item.get("candidateSha256") or "").removeprefix("sha256:")
            candidate_present = candidate_sha in hashes
            receipt = receipt_by_id.get(action_id)
            receipt_inputs = [
                str(value).removeprefix("sha256:")
                for value in ((receipt or {}).get("inputSha256s") or [])
                if isinstance(value, str) and value
            ]
            original_hashes = sorted(set(receipt_inputs or [before_sha]))
            originals_present = sorted(value for value in original_hashes if value in hashes)
            original_present = bool(originals_present)
            receipt_valid = bool(
                receipt
                and (
                    str(receipt.get("inputSha256") or "").removeprefix("sha256:") == before_sha
                    or before_sha in receipt_inputs
                )
                and str(receipt.get("candidateSha256") or receipt.get("outputSha256") or "").removeprefix("sha256:") == candidate_sha
            )
            method = "payload-hash" if candidate_present else "builder-receipt" if receipt_valid else "unproven"
            verified = (candidate_present and not original_present) or (receipt_valid and not original_present)
            action_record = {
                "actionId": action_id,
                "targetPath": item.get("targetPath"),
                "beforeSha256": before_sha,
                "candidateSha256": candidate_sha,
                "candidatePresent": candidate_present,
                "originalPresent": original_present,
                "originalSha256s": original_hashes,
                "originalsPresent": originals_present,
                "method": method,
                "builderEntries": (receipt or {}).get("entries") or [],
                "verified": verified,
            }
            actions.append(action_record)
            if original_present:
                blockers.append({
                    "code": "ORIGINAL_RESOURCE_STILL_CONSUMED",
                    "actionId": action_id,
                    "sha256": originals_present[0],
                    "sha256s": originals_present,
                })
            if not candidate_present and not receipt_valid:
                blockers.append({
                    "code": "CANDIDATE_RESOURCE_NOT_CONSUMED",
                    "actionId": action_id,
                    "sha256": candidate_sha,
                })
        if not actions:
            blockers.append({"code": "OPTIMIZED_RESULT_HAS_NO_ACTIONS"})
    elif result_type in {"package-only", "unchanged-explicitly-approved"}:
        pass
    else:
        blockers.append({"code": "RESOURCE_RESULT_TYPE_INVALID", "value": result_type})

    return {
        "schemaVersion": SCHEMA,
        "generatedAt": utc_now(),
        "platform": args.platform,
        "artifact": {"path": str(artifact), "bytes": artifact.stat().st_size, "sha256": artifact_sha},
        "payloadReport": {"path": str(payload_path), "sha256": sha256_file(payload_path)},
        "resourceState": {"path": str(state_path), "sha256": sha256_file(state_path)},
        "resourceResultType": result_type,
        "builderReceipt": (
            {"path": str(args.builder_receipt.resolve()), "sha256": sha256_file(args.builder_receipt.resolve())}
            if args.builder_receipt else None
        ),
        "actions": actions,
        "blockers": blockers,
        "conclusion": "FAIL" if blockers else "PASS",
        "userConclusion": (
            "最终 artifact 已证明消费本轮候选资源字节"
            if not blockers and result_type == "optimized" else
            "本轮没有资源字节替换；消费证明按资源结果类型验签通过"
            if not blockers else
            "最终 artifact 未能证明真实消费候选资源，不能创建平台候选清单"
        ),
    }


def main() -> int:
    args = parse_args()
    try:
        report = build(args)
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["conclusion"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
