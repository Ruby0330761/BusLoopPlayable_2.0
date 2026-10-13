#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from execute_resource_candidate import safe_environment
from record_resource_approval import verified_plan
from resource_common import git_worktree_root, is_within, load_json, sha256_file, utc_now, write_json_atomic
from verify_toolchain_lock import run_probe, verify_lock_hash


LOSSY_ACTIONS = {"TINIFY_SHRINK", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS", "SUBSET_FONT", "PRUNE_CONFIG"}


def execution_record_from_tinify(
    planned: dict[str, Any], batch_item: dict[str, Any], project_root: Path, candidate_root: Path,
) -> dict[str, Any]:
    if batch_item.get("status") not in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}:
        raise ValueError(f"Tinify 候选尚未成功：{planned.get('actionId')}")
    receipt = batch_item.get("receipt") or {}
    if receipt.get("schemaVersion") != "playable-tinify-receipt-v1" or receipt.get("provider") != "tinify":
        raise ValueError(f"Tinify receipt 无效：{planned.get('actionId')}")
    source = (project_root / str(planned.get("path") or "")).resolve()
    target = (candidate_root / str(planned.get("path") or "")).resolve()
    if not is_within(project_root, source) or not source.is_file():
        raise ValueError(f"Tinify 输入不属于当前项目：{planned.get('actionId')}")
    if not is_within(candidate_root, target) or not target.is_file():
        raise ValueError(f"Tinify 候选不存在或超出 candidateRoot：{planned.get('actionId')}")
    if receipt.get("sourceSha256") != sha256_file(source) or receipt.get("candidateSha256") != sha256_file(target):
        raise ValueError(f"Tinify receipt 与当前输入或候选不一致：{planned.get('actionId')}")
    input_facts = receipt.get("input") or {}
    output_facts = receipt.get("output") or {}
    if input_facts.get("bytes") != source.stat().st_size or output_facts.get("bytes") != target.stat().st_size:
        raise ValueError(f"Tinify receipt bytes 已漂移：{planned.get('actionId')}")
    if not isinstance(receipt.get("savedBytes"), int) or receipt["savedBytes"] <= 0:
        raise ValueError(f"Tinify 候选没有正向 bytes 收益：{planned.get('actionId')}")
    parameters = planned.get("parameters") or {}
    if parameters.get("operation") != "shrink" or any(
        name in parameters for name in ("resize", "convert", "metadata", "quality")
    ):
        raise ValueError(f"Tinify 计划夹带未批准附加动作：{planned.get('actionId')}")
    return {
        "actionId": planned.get("actionId"), "path": planned.get("path"),
        "action": "TINIFY_SHRINK", "provider": "tinify", "service": "Tinify Developer API",
        "changedVariables": ["encoded-bytes"], "actualParameters": dict(parameters),
        "input": {"path": str(source), "bytes": source.stat().st_size, "sha256": sha256_file(source)},
        "output": {"path": str(target), "bytes": target.stat().st_size, "sha256": sha256_file(target)},
        "savedBytes": receipt["savedBytes"], "tinifyReceipt": receipt,
    }


def tinify_records_from_batch(
    items: list[dict[str, Any]], batch_by_id: dict[str, dict[str, Any]],
    project_root: Path, candidate_root: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    records: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in items:
        batch_item = batch_by_id.get(item.get("actionId")) or {}
        if batch_item.get("status") == "NOT_TESTED_QUOTA":
            skipped.append({
                "actionId": item.get("actionId"), "path": item.get("path"),
                "status": "NOT_TESTED_QUOTA", "reason": "QUOTA_EXHAUSTED",
            })
            continue
        records.append(execution_record_from_tinify(item, batch_item, project_root, candidate_root))
    return records, skipped


def first_allowed(parameters: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    ranges = parameters.get("parameterRanges") or {}
    if not isinstance(ranges, dict):
        raise ValueError("parameterRanges 必须是对象")
    for name, values in ranges.items():
        if not isinstance(values, list) or not values:
            raise ValueError(f"Gate A 参数范围无效：{name}")
        result[name] = values[0]
    for name, value in parameters.items():
        if name != "parameterRanges":
            result[name] = value
    return result


def fill_locked_defaults(actual: dict[str, Any], tool: dict[str, Any]) -> dict[str, Any]:
    """补入工具锁中唯一允许的固定参数，避免计划省略非试做变量时留下 argv 占位符。"""
    allowed = tool.get("parameters") or {}
    if not isinstance(allowed, dict):
        raise ValueError(f"工具允许参数无效：{tool.get('name')}")
    result = dict(actual)
    for name, values in allowed.items():
        if name in result or not isinstance(values, list) or len(values) != 1:
            continue
        result[name] = values[0]
    return result


def changed_variable(action: str, required_capability: str, parameters: dict[str, Any]) -> str:
    explicit = parameters.get("candidateVariable")
    if explicit is not None:
        if not isinstance(explicit, str) or not explicit.strip() or any(token in explicit for token in (",", "+", "/")):
            raise ValueError("candidateVariable 必须声明一个单独试做变量")
        return explicit.strip()
    return {
        "RESIZE": "dimensions",
        "REENCODE": "compact-storage" if required_capability == "model-compact" else "format",
        "SIMPLIFY": "triangle-count",
        "REPACK_ATLAS": "packing", "SUBSET_FONT": "character-set", "PRUNE_CONFIG": "reference-closure",
    }[action]


def capability(item: dict[str, Any]) -> str:
    if isinstance(item.get("requiredCapability"), str):
        return item["requiredCapability"]
    action = item["action"]
    if action == "REENCODE":
        return "audio-reencode" if item.get("bucket") == "audio" else "image-reencode" if item.get("bucket") == "textures" else "model-convert"
    return {
        "RESIZE": "image-resize", "SIMPLIFY": "model-simplify", "REPACK_ATLAS": "atlas-repack",
        "SUBSET_FONT": "font-subset", "PRUNE_CONFIG": "config-prune",
    }[action]


def substitute(template: list[str], replacements: dict[str, str]) -> list[str]:
    result = []
    for value in template:
        rendered = value
        for name, replacement in replacements.items():
            rendered = rendered.replace("{" + name + "}", replacement)
        if "{" in rendered or "}" in rendered:
            raise ValueError(f"候选 argv 含未解析占位符：{rendered}")
        result.append(rendered)
    return result


def replacement_value(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def tool_allows(tool: dict[str, Any], actual: dict[str, Any]) -> None:
    allowed = tool.get("parameters") or {}
    if not isinstance(allowed, dict):
        raise ValueError(f"工具允许参数无效：{tool.get('name')}")
    for name, values in allowed.items():
        if name not in actual:
            continue
        if isinstance(values, list) and actual[name] not in values:
            raise ValueError(f"Gate A 参数超出锁定工具范围：{name}={actual[name]}")
        if not isinstance(values, list) and actual[name] != values:
            raise ValueError(f"Gate A 参数超出锁定工具范围：{name}={actual[name]}")


def verified_tool(tool: dict[str, Any], required: str) -> tuple[Path, Path | None]:
    executable = Path(str(tool.get("executable") or "")).resolve()
    if not executable.is_file() or tool.get("executableSha256") != "sha256:" + sha256_file(executable):
        raise ValueError(f"锁定工具已漂移：{tool.get('name')}")
    bundled_script = None
    if tool.get("source") == "skill-bundled":
        bundled_script = Path(str(tool.get("bundledScript") or "")).resolve()
        if (
            not bundled_script.is_file()
            or tool.get("bundledScriptSha256") != "sha256:" + sha256_file(bundled_script)
            or required not in (tool.get("capabilities") or [])
        ):
            raise ValueError(f"Skill 内建工具脚本已漂移：{tool.get('name')}")
    return executable, bundled_script


def reverify_tool_for_new_lock(tool: dict[str, Any], lock: dict[str, Any], project_root: Path) -> None:
    if "conclusion" not in lock:
        return
    if lock.get("conclusion") != "READY" or lock.get("missingCapabilities"):
        raise ValueError("当前工具链尚未就绪，不能执行候选")
    executable = Path(str(tool.get("executable") or "")).resolve()
    version_argv = tool.get("versionArgv")
    if not isinstance(version_argv, list) or not version_argv or Path(str(version_argv[0])).resolve() != executable:
        raise ValueError(f"锁定工具版本命令无效：{tool.get('name')}")
    completed = subprocess.run(version_argv, capture_output=True, text=True, timeout=60, check=False, env=safe_environment())
    version_output = (completed.stdout or completed.stderr).strip()
    if completed.returncode != 0 or version_output != tool.get("versionOutput"):
        raise ValueError(f"锁定工具版本输出已漂移：{tool.get('name')}")
    run_probe(tool, 60, project_root)


def main() -> int:
    parser = argparse.ArgumentParser(description="从 Gate A 计划执行通用单变量资源候选")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--tinify-report", type=Path, help="Tinify 顺序批处理的脱敏报告；计划含 TINIFY_SHRINK 时必填")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        project_root = args.project_root.expanduser().resolve()
        candidate_root = args.candidate_root.expanduser().resolve()
        product_root = git_worktree_root(project_root)
        stable_run_root = (product_root / "playable-runs").resolve() if product_root else None
        if not is_within(project_root, candidate_root) and not (
            stable_run_root is not None and is_within(stable_run_root, candidate_root)
        ):
            raise ValueError("候选根必须位于当前项目或产品仓 playable-runs 内")
        plan_path = args.plan_json.expanduser().resolve()
        approval_path = args.approval.expanduser().resolve()
        lock_path = args.toolchain_lock.expanduser().resolve()
        plan = verified_plan(plan_path)
        approval = load_json(approval_path)
        lock = load_json(lock_path)
        if Path(str(plan.get("projectRoot") or "")).expanduser().resolve() != project_root:
            raise ValueError("Gate A 计划不属于当前项目")
        if not isinstance(approval, dict) or approval.get("status") != "RESOURCE_TRIAL_APPROVED" or approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash"):
            raise ValueError("Gate A 批准未绑定当前计划")
        approval_lock = approval.get("toolchainLock") or {}
        approval_lock_path = approval_lock.get("path")
        if (
            approval_lock_path is not None
            and Path(str(approval_lock_path)).expanduser().resolve() != lock_path
        ) or approval_lock.get("sha256") != sha256_file(lock_path):
            raise ValueError("Gate A 批准未绑定当前工具链")
        if not isinstance(lock, dict) or lock.get("schemaVersion") != "playable-resource-toolchain-lock-v1":
            raise ValueError("工具链锁无效")
        verify_lock_hash(lock)
        if lock.get("networkPolicy") != "DENY" or lock.get("externalAssetsUsed") is not False:
            raise ValueError("候选执行只接受离线、无外部素材工具链")
        records = []
        tinify_items = [
            item for item in plan.get("items") or []
            if isinstance(item, dict) and item.get("action") == "TINIFY_SHRINK"
        ]
        if tinify_items:
            if args.tinify_report is None:
                raise ValueError("计划包含 TINIFY_SHRINK，必须提供 --tinify-report")
            tinify_report = load_json(args.tinify_report.expanduser().resolve())
            if not isinstance(tinify_report, dict) or tinify_report.get("schemaVersion") != "playable-tinify-batch-report-v1":
                raise ValueError("Tinify 批处理报告无效")
            if tinify_report.get("status") not in {"PASS", "QUOTA_EXHAUSTED"}:
                raise ValueError(f"Tinify 批处理尚未完成：{tinify_report.get('status')}")
            if tinify_report.get("status") == "QUOTA_EXHAUSTED":
                quota_items = [
                    item for item in tinify_report.get("items") or []
                    if isinstance(item, dict) and item.get("status") == "NOT_TESTED_QUOTA"
                ]
                if not quota_items or tinify_report.get("localFallbackDecisionRequired") is not True:
                    raise ValueError("Tinify 额度状态无效，不能部分进入执行验签")
                unexpected = [
                    item for item in tinify_report.get("items") or []
                    if isinstance(item, dict) and item.get("status") not in {"SUCCESS", "REUSED_SUCCESS_RECEIPT", "NOT_TESTED_QUOTA"}
                ]
                if unexpected:
                    raise ValueError("Tinify 额度报告包含认证、限流或未知暂停项，不能伪装成部分成功")
            batch_by_id = {
                value.get("actionId"): value for value in tinify_report.get("items") or []
                if isinstance(value, dict)
            }
            authorization = approval.get("tinifyAuthorization") or {}
            expected_ids = [item.get("actionId") for item in tinify_items]
            if authorization.get("externalUploadAuthorized") is not True or authorization.get("approvedActionIds") != expected_ids:
                raise ValueError("Gate A Tinify 上传授权未绑定当前计划顺序")
            tinify_records, skipped_actions = tinify_records_from_batch(
                tinify_items, batch_by_id, project_root, candidate_root,
            )
            records.extend(tinify_records)
        for item in plan.get("items") or []:
            if not isinstance(item, dict) or item.get("action") not in LOSSY_ACTIONS or item.get("action") == "TINIFY_SHRINK":
                continue
            source = (project_root / str(item.get("path") or "")).resolve()
            if not source.is_file() or not is_within(project_root, source):
                raise ValueError(f"候选输入无效：{item.get('path')}")
            required = capability(item)
            tool = next((value for value in lock.get("tools") or [] if required in (value.get("capabilities") or [])), None)
            if not isinstance(tool, dict):
                raise ValueError(f"缺少已锁定的本地工具能力：{required}")
            executable, bundled_script = verified_tool(tool, required)
            actual = fill_locked_defaults(first_allowed(item.get("parameters") or {}), tool)
            tool_allows(tool, actual)
            reverify_tool_for_new_lock(tool, lock, project_root)
            output_path = actual.get("outputPath")
            if not isinstance(output_path, str) or not output_path:
                output_path = str(item["path"])
                output_format = actual.get("format")
                if item.get("bucket") == "models" and isinstance(output_format, str) and output_format not in {"", "unchanged"}:
                    output_path = str(Path(output_path).with_suffix("." + output_format.lstrip(".")))
            target = (candidate_root / output_path).resolve()
            if not is_within(candidate_root, target):
                raise ValueError(f"候选输出超出 candidateRoot：{output_path}")
            target.parent.mkdir(parents=True, exist_ok=True)
            replacements = {
                "executable": str(executable), "input": str(source), "output": str(target),
                "projectRoot": str(project_root), **{name: replacement_value(value) for name, value in actual.items()},
            }
            manifest_path = target.with_suffix(target.suffix + ".positions.json")
            tool_receipt_path = target.with_suffix(target.suffix + ".tool-receipt.json")
            replacements.update({"manifest": str(manifest_path), "receipt": str(tool_receipt_path)})
            argv = substitute(tool.get("argvTemplate") or [], replacements)
            if not argv or Path(argv[0]).resolve() != executable:
                raise ValueError("候选命令必须直接调用已锁定工具")
            completed = subprocess.run(argv, capture_output=True, text=True, timeout=60, check=False, env=safe_environment())
            if completed.returncode != 0 or not target.is_file():
                raise ValueError(f"资源候选转换失败：{item.get('actionId')} / exit={completed.returncode}")
            record: dict[str, Any] = {
                "actionId": item.get("actionId"), "path": item.get("path"), "action": item.get("action"),
                "toolName": tool.get("name"), "executableSha256": tool.get("executableSha256"), "argv": argv,
                "changedVariables": [changed_variable(item["action"], required, item.get("parameters") or {})], "actualParameters": actual,
                "input": {"path": str(source), "bytes": source.stat().st_size, "sha256": sha256_file(source)},
                "output": {"path": str(target), "bytes": target.stat().st_size, "sha256": sha256_file(target)},
                "requiredCapability": required,
            }
            if bundled_script is not None:
                record["bundledScript"] = {"path": str(bundled_script), "sha256": sha256_file(bundled_script)}
            if item.get("action") == "REPACK_ATLAS":
                input_paths = actual.get("inputPaths")
                if not isinstance(input_paths, list) or len(input_paths) < 2 or not all(isinstance(value, str) for value in input_paths):
                    raise ValueError("图片合集必须绑定至少两张输入图片")
                atlas_inputs = []
                for value in input_paths:
                    input_file = (project_root / value).resolve()
                    if not is_within(project_root, input_file) or not input_file.is_file():
                        raise ValueError(f"图片合集输入无效：{value}")
                    atlas_inputs.append({"path": str(input_file), "bytes": input_file.stat().st_size, "sha256": sha256_file(input_file)})
                if not manifest_path.is_file() or not tool_receipt_path.is_file():
                    raise ValueError("图片合集候选缺少位置表或转换 receipt")
                additional_cost = int(actual.get("additionalRuntimeBytes") or 0)
                input_bytes = sum(value["bytes"] for value in atlas_inputs)
                output_bytes = target.stat().st_size + manifest_path.stat().st_size + additional_cost
                if output_bytes >= input_bytes:
                    for output in (target, manifest_path, tool_receipt_path):
                        output.unlink(missing_ok=True)
                    raise ValueError(f"候选没有减少 bytes：{item.get('actionId')}")
                record["inputs"] = atlas_inputs
                record["manifest"] = {"path": str(manifest_path), "bytes": manifest_path.stat().st_size, "sha256": sha256_file(manifest_path)}
                record["toolReceipt"] = {"path": str(tool_receipt_path), "sha256": sha256_file(tool_receipt_path)}
                record["netBenefitCosts"] = {"manifestBytes": manifest_path.stat().st_size, "additionalRuntimeBytes": additional_cost}
                record["savedBytes"] = input_bytes - output_bytes
            else:
                if target.stat().st_size >= source.stat().st_size:
                    target.unlink(missing_ok=True)
                    raise ValueError(f"候选没有减少 bytes：{item.get('actionId')}")
                record["savedBytes"] = source.stat().st_size - target.stat().st_size
            records.append(record)
        report = {
            "schemaVersion": "playable-resource-conversion-receipts-v1", "generatedAt": utc_now(),
            "projectRoot": str(project_root), "plan": {"path": str(plan_path), "sha256": sha256_file(plan_path)},
            "approval": {"path": str(approval_path), "sha256": sha256_file(approval_path)},
            "toolchainLock": {"path": str(lock_path), "sha256": sha256_file(lock_path)},
            "candidateRoot": str(candidate_root), "executionRecords": records,
            "skippedActions": skipped_actions if tinify_items else [],
            "conclusion": "PASS",
        }
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), "candidateCount": len(records)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
