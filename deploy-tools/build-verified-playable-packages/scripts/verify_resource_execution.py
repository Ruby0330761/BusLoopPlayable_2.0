#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from record_resource_approval import verified_plan
from resource_common import load_json, sha256_file, utc_now, write_json_atomic
from verify_toolchain_lock import verify_lock_hash


LOSSY_ACTIONS = {"TINIFY_SHRINK", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS", "SUBSET_FONT", "PRUNE_CONFIG"}


def contains_sensitive_tinify_evidence(value: object) -> bool:
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True).lower()
    return any(token in serialized for token in (
        "authorization", "apikey", "api_key", "basic ", "https://", "http://", "/result/",
    ))


def verify_tinify_record(
    item: dict[str, Any], record: dict[str, Any], approval: dict[str, Any], errors: list[str],
) -> dict[str, Any] | None:
    action_id = item.get("actionId")
    authorization = approval.get("tinifyAuthorization") or {}
    approved_ids = authorization.get("approvedActionIds") or []
    if authorization.get("externalUploadAuthorized") is not True or action_id not in approved_ids:
        errors.append(f"TINIFY_UPLOAD_NOT_APPROVED:{action_id}")
    audit = item.get("opportunityAudit") or {}
    if (audit.get("riskProfile") == "HIGH" or audit.get("pixelSensitive") is True) and action_id not in (authorization.get("approvedHighRiskActionIds") or []):
        errors.append(f"TINIFY_HIGH_RISK_NOT_APPROVED:{action_id}")
    if record.get("provider") != "tinify" or record.get("service") != "Tinify Developer API" or "argv" in record:
        errors.append(f"TINIFY_EXECUTION_IDENTITY_INVALID:{action_id}")
    receipt = record.get("tinifyReceipt") or {}
    api = receipt.get("api") or {}
    credential = receipt.get("credential") or {}
    if (
        receipt.get("schemaVersion") != "playable-tinify-receipt-v1"
        or receipt.get("action") != "TINIFY_SHRINK"
        or receipt.get("provider") != "tinify"
        or api.get("operation") != "shrink"
        or api.get("requestCount") != 1
        or api.get("resizeUsed") is not False
        or api.get("conversionUsed") is not False
        or api.get("metadataUsed") is not False
        or credential.get("secretCopiedToEvidence") is not False
        or contains_sensitive_tinify_evidence(receipt)
    ):
        errors.append(f"TINIFY_RECEIPT_INVALID_OR_SENSITIVE:{action_id}")
    input_ref = record.get("input") or {}
    output_ref = record.get("output") or {}
    for label, reference, receipt_sha in (
        ("INPUT", input_ref, receipt.get("sourceSha256")),
        ("OUTPUT", output_ref, receipt.get("candidateSha256")),
    ):
        path = Path(str(reference.get("path") or "")).resolve()
        if not path.is_file() or reference.get("sha256") != sha256_file(path) or receipt_sha != reference.get("sha256"):
            errors.append(f"TINIFY_{label}_INVALID:{action_id}")
    actual = record.get("actualParameters")
    declared = item.get("parameters") or {}
    if not isinstance(actual, dict) or actual != declared or actual.get("operation") != "shrink" or any(
        name in actual for name in ("resize", "convert", "metadata", "quality")
    ):
        errors.append(f"TINIFY_PARAMETERS_INVALID:{action_id}")
    if record.get("changedVariables") != ["encoded-bytes"] or int(record.get("savedBytes") or 0) <= 0:
        errors.append(f"TINIFY_SINGLE_VARIABLE_OR_SAVINGS_INVALID:{action_id}")
    return {
        "actionId": action_id, "path": item.get("path"), "provider": "tinify",
        "service": "Tinify Developer API", "actualParameters": actual,
        "requestCount": api.get("requestCount"), "compressionCount": api.get("compressionCount"),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证候选实际工具、argv 和参数没有超出 Gate A 批准范围")
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--execution-records", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def in_approved_range(name: str, actual: Any, declared: dict[str, Any]) -> bool:
    ranges = declared.get("parameterRanges") or {}
    if name in ranges:
        allowed = ranges[name]
        return actual in allowed if isinstance(allowed, list) else actual == allowed
    if name in declared:
        return actual == declared[name]
    return False


def tool_allows(name: str, actual: Any, allowed: dict[str, Any]) -> bool:
    if name not in allowed:
        return True
    value = allowed[name]
    return actual in value if isinstance(value, list) else actual == value


def in_approved_or_locked_range(name: str, actual: Any, declared: dict[str, Any], tool: dict[str, Any]) -> bool:
    if in_approved_range(name, actual, declared):
        return True
    allowed = (tool.get("parameters") or {}).get(name)
    return isinstance(allowed, list) and len(allowed) == 1 and actual == allowed[0]


def ffmpeg_parameters(argv: list[str]) -> dict[str, Any]:
    def following(flag: str) -> str | None:
        return argv[argv.index(flag) + 1] if flag in argv and argv.index(flag) + 1 < len(argv) else None
    bitrate = following("-b:a")
    return {
        "codec": following("-codec:a"),
        "bitRateKbps": int(bitrate[:-1]) if isinstance(bitrate, str) and bitrate.endswith("k") and bitrate[:-1].isdigit() else None,
        "sampleRateHz": int(following("-ar")) if str(following("-ar") or "").isdigit() else None,
        "channels": int(following("-ac")) if str(following("-ac") or "").isdigit() else None,
        "metadata": "removed" if following("-map_metadata") == "-1" else None,
    }


def normalized_argv_parameter(name: str, value: Any) -> Any:
    if name == "metadata" and value in {"remove", "strip", "removed"}:
        return "removed"
    return value


def argv_contains_path(argv: list[str], expected: Path) -> bool:
    for value in argv:
        candidate = Path(str(value)).expanduser()
        if candidate.is_absolute() and candidate.resolve() == expected:
            return True
    return False


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    verified: list[dict[str, Any]] = []
    try:
        plan_path = args.plan_json.expanduser().resolve()
        approval_path = args.approval.expanduser().resolve()
        lock_path = args.toolchain_lock.expanduser().resolve()
        records_path = args.execution_records.expanduser().resolve()
        plan = verified_plan(plan_path)
        approval = load_json(approval_path)
        lock = load_json(lock_path)
        records_file = load_json(records_path)
        if not isinstance(approval, dict) or approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash"):
            raise ValueError("Gate A 批准未绑定当前计划")
        if (approval.get("toolchainLock") or {}).get("sha256") != sha256_file(lock_path):
            raise ValueError("Gate A 批准未绑定当前工具链锁")
        if not isinstance(lock, dict) or lock.get("schemaVersion") != "playable-resource-toolchain-lock-v1":
            raise ValueError("工具链锁无效")
        verify_lock_hash(lock)
        if not isinstance(records_file, dict) or not isinstance(records_file.get("executionRecords"), list):
            raise ValueError("实际执行记录必须包含 executionRecords 数组")
        tools = {item.get("name"): item for item in lock.get("tools", []) if isinstance(item, dict)}
        records = {item.get("actionId"): item for item in records_file["executionRecords"] if isinstance(item, dict)}
        skipped = {
            item.get("actionId"): item for item in records_file.get("skippedActions") or []
            if isinstance(item, dict)
        }
        for item in plan.get("items", []):
            if item.get("action") not in LOSSY_ACTIONS:
                continue
            action_id = item.get("actionId")
            record = records.get(action_id)
            if item.get("action") == "TINIFY_SHRINK" and action_id in skipped:
                skip = skipped[action_id]
                if skip.get("status") == "NOT_TESTED_QUOTA" and skip.get("reason") == "QUOTA_EXHAUSTED":
                    continue
                errors.append(f"EXECUTION_SKIPPED_STATUS_INVALID:{action_id}")
                continue
            if not isinstance(record, dict):
                errors.append(f"EXECUTION_RECORD_MISSING:{action_id}")
                continue
            if record.get("path") != item.get("path"):
                errors.append(f"EXECUTION_PATH_MISMATCH:{action_id}")
                continue
            if item.get("action") == "TINIFY_SHRINK":
                verified_record = verify_tinify_record(item, record, approval, errors)
                if verified_record is not None:
                    verified.append(verified_record)
                continue
            tool = tools.get(record.get("toolName"))
            if not isinstance(tool, dict):
                errors.append(f"EXECUTION_TOOL_NOT_LOCKED:{action_id}")
                continue
            executable = Path(str(tool.get("executable", ""))).resolve()
            argv = record.get("argv")
            if not isinstance(argv, list) or not argv or Path(str(argv[0])).resolve() != executable:
                errors.append(f"EXECUTION_ARGV_INVALID:{action_id}")
                continue
            if record.get("executableSha256") != tool.get("executableSha256") or tool.get("executableSha256") != "sha256:" + sha256_file(executable):
                errors.append(f"EXECUTION_TOOL_HASH_MISMATCH:{action_id}")
            if tool.get("source") == "skill-bundled":
                bundled = Path(str(tool.get("bundledScript") or "")).resolve()
                record_bundled = record.get("bundledScript") or {}
                if (
                    not bundled.is_file()
                    or tool.get("bundledScriptSha256") != "sha256:" + sha256_file(bundled)
                    or record_bundled.get("path") != str(bundled)
                    or record_bundled.get("sha256") != sha256_file(bundled)
                    or str(bundled) not in argv
                ):
                    errors.append(f"EXECUTION_BUNDLED_TOOL_HASH_MISMATCH:{action_id}")
            changed = record.get("changedVariables")
            if changed is not None and (not isinstance(changed, list) or len(changed) != 1):
                errors.append(f"EXECUTION_NOT_SINGLE_VARIABLE:{action_id}")
            input_ref = record.get("input") or {}
            output_ref = record.get("output") or {}
            for label, reference in (("INPUT", input_ref), ("OUTPUT", output_ref)):
                path = Path(str(reference.get("path", ""))).resolve()
                atlas_input = item.get("action") == "REPACK_ATLAS" and label == "INPUT" and any(
                    isinstance(value, dict) and Path(str(value.get("path") or "")).resolve() == path
                    for value in record.get("inputs") or []
                )
                if not path.is_file() or reference.get("sha256") != sha256_file(path) or (not argv_contains_path(argv, path) and not atlas_input):
                    errors.append(f"EXECUTION_{label}_INVALID:{action_id}")
            if item.get("action") == "REPACK_ATLAS":
                atlas_inputs = record.get("inputs")
                manifest = record.get("manifest") or {}
                if not isinstance(atlas_inputs, list) or len(atlas_inputs) < 2:
                    errors.append(f"EXECUTION_ATLAS_INPUTS_INVALID:{action_id}")
                else:
                    for reference in atlas_inputs:
                        path = Path(str(reference.get("path") or "")).resolve()
                        if not path.is_file() or reference.get("sha256") != sha256_file(path):
                            errors.append(f"EXECUTION_ATLAS_INPUT_INVALID:{action_id}")
                manifest_path = Path(str(manifest.get("path") or "")).resolve()
                if not manifest_path.is_file() or manifest.get("sha256") != sha256_file(manifest_path) or not argv_contains_path(argv, manifest_path):
                    errors.append(f"EXECUTION_ATLAS_MANIFEST_INVALID:{action_id}")
            if record.get("savedBytes") is not None and int(record.get("savedBytes") or 0) <= 0:
                errors.append(f"EXECUTION_NO_BYTE_SAVINGS:{action_id}")
            actual = record.get("actualParameters")
            if not isinstance(actual, dict):
                errors.append(f"EXECUTION_PARAMETERS_MISSING:{action_id}")
                continue
            declared = item.get("parameters") or {}
            for name, value in actual.items():
                if name == "audioClass":
                    if value != declared.get(name):
                        errors.append(f"EXECUTION_PARAMETER_OUT_OF_RANGE:{action_id}:{name}")
                elif not in_approved_or_locked_range(name, value, declared, tool) or not tool_allows(name, value, tool.get("parameters") or {}):
                    errors.append(f"EXECUTION_PARAMETER_OUT_OF_RANGE:{action_id}:{name}")
            if record.get("toolName") == "ffmpeg":
                parsed = ffmpeg_parameters(argv)
                for name in ("codec", "bitRateKbps", "sampleRateHz", "channels", "metadata"):
                    if normalized_argv_parameter(name, actual.get(name)) != normalized_argv_parameter(name, parsed.get(name)):
                        errors.append(f"EXECUTION_ARGV_PARAMETER_MISMATCH:{action_id}:{name}")
            verified.append({"actionId": action_id, "path": item.get("path"), "toolName": record.get("toolName"), "actualParameters": actual})
        status = "EXECUTION_VERIFIED" if not errors else "BLOCKED"
        report = {
            "schemaVersion": "playable-resource-execution-verification-v1",
            "generatedAt": utc_now(),
            "status": status,
            "userConclusion": "实际资源转换命令与已批准参数一致" if status == "EXECUTION_VERIFIED" else "实际资源转换参数超出批准范围，候选不能继续使用",
            "planJson": {"path": str(plan_path), "sha256": sha256_file(plan_path)},
            "approval": {"path": str(approval_path), "sha256": sha256_file(approval_path)},
            "toolchainLock": {"path": str(lock_path), "sha256": sha256_file(lock_path)},
            "executionRecords": {"path": str(records_path), "sha256": sha256_file(records_path)},
            "verifiedActions": verified,
            "errors": sorted(set(errors)),
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        report = {"schemaVersion": "playable-resource-execution-verification-v1", "generatedAt": utc_now(), "status": "BLOCKED", "userConclusion": "实际资源转换参数尚未通过验证", "errors": [str(exc)]}
    write_json_atomic(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "EXECUTION_VERIFIED" else 1


if __name__ == "__main__":
    raise SystemExit(main())
