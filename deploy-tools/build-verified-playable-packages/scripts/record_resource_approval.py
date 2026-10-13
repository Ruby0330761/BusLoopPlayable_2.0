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
from render_resource_plan import render_markdown


def tinify_authorization_for_plan(plan: dict[str, Any]) -> dict[str, Any] | None:
    items = [
        item for item in plan.get("items") or []
        if isinstance(item, dict) and item.get("action") == "TINIFY_SHRINK"
    ]
    if not items:
        return None
    action_ids: list[str] = []
    paths: list[str] = []
    high_risk_ids: list[str] = []
    upload_bytes = 0
    for item in items:
        action_id = item.get("actionId")
        path = item.get("path")
        parameters = item.get("parameters") or {}
        if not isinstance(action_id, str) or not action_id or not isinstance(path, str) or not path:
            raise ValueError("Tinify 计划项缺少 actionId 或 path")
        if parameters.get("operation") != "shrink" or any(
            name in parameters for name in ("resize", "convert", "metadata", "quality")
        ):
            raise ValueError(f"Tinify 默认 shrink 动作无效或夹带附加参数：{action_id}")
        current_bytes = item.get("currentBytes")
        if not isinstance(current_bytes, int) or current_bytes < 1:
            raise ValueError(f"Tinify 上传 bytes 无效：{action_id}")
        action_ids.append(action_id)
        paths.append(path)
        upload_bytes += current_bytes
        audit = item.get("opportunityAudit") or {}
        if audit.get("riskProfile") == "HIGH" or audit.get("pixelSensitive") is True:
            high_risk_ids.append(action_id)
    return {
        "service": "Tinify Developer API",
        "provider": "tinify",
        "operation": "shrink",
        "externalUploadAuthorized": True,
        "uploadAllowlist": paths,
        "uploadBytes": upload_bytes,
        "approvedActionIds": action_ids,
        "approvedHighRiskActionIds": high_risk_ids,
        "estimatedRequestCount": len(action_ids),
        "additionalOperationsAuthorized": [],
        "sourceFilesWillBeOverwritten": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="记录 Gate A：允许在候选目录试做资源优化")
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--plan-md", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--confirmation-text", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--verification-out", type=Path, help="同一次命令生成批准验证结果；标准流程必须提供")
    return parser.parse_args()


def verify_bucket_audit_integrity(plan: dict[str, Any]) -> None:
    if plan.get("auditContractVersion") != "per-resource-v2":
        return
    declared = plan.get("bucketAudit")
    if not isinstance(declared, dict):
        raise ValueError("分资源桶审计摘要缺失")
    computed: dict[str, dict[str, int]] = {}
    items = plan.get("items")
    if not isinstance(items, list):
        raise ValueError("分资源桶审计摘要无法复核：items 无效")
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("分资源桶审计摘要无法复核：资源项无效")
        bucket = str(item.get("bucket") or "other")
        decision = str((item.get("opportunityAudit") or {}).get("decision") or "")
        if decision not in {"OPTIMIZE", "KEEP", "UNSUPPORTED"}:
            raise ValueError(f"分资源桶审计摘要无法复核：{item.get('path')} 缺少逐项结论")
        record = computed.setdefault(bucket, {"total": 0, "OPTIMIZE": 0, "KEEP": 0, "UNSUPPORTED": 0})
        record["total"] += 1
        record[decision] += 1
    if set(declared) != set(computed):
        raise ValueError("分资源桶审计摘要与逐项资源桶集合不一致")
    for bucket, expected in computed.items():
        actual = declared.get(bucket)
        if not isinstance(actual, dict) or any(actual.get(key) != value for key, value in expected.items()):
            raise ValueError(f"分资源桶审计摘要与逐项结论不一致：{bucket}")
    shown = (plan.get("userSummary") or {}).get("bucketAudits")
    if shown is not None:
        if not isinstance(shown, list):
            raise ValueError("分资源桶审计摘要的用户展示无效")
        shown_map = {str(item.get("bucket")): item for item in shown if isinstance(item, dict)}
        if set(shown_map) != set(computed):
            raise ValueError("分资源桶审计摘要与 Gate A 用户展示不一致")
        for bucket, expected in computed.items():
            if any(shown_map[bucket].get(key) != value for key, value in expected.items()):
                raise ValueError(f"分资源桶审计摘要与 Gate A 用户展示不一致：{bucket}")


def verified_plan(path: Path) -> dict[str, Any]:
    plan = load_json(path)
    if not isinstance(plan, dict) or plan.get("schemaVersion") != "playable-resource-optimization-plan-v1":
        raise ValueError("资源优化计划 schemaVersion 无效")
    core = {key: value for key, value in plan.items() if key not in {"generatedAt", "optimizationPlanHash"}}
    actual = "sha256:" + sha256_object(core)
    if plan.get("optimizationPlanHash") != actual:
        raise ValueError("资源优化计划哈希无效")
    if plan.get("blockers"):
        raise ValueError("资源优化计划仍有阻塞项，不能记录批准")
    verify_bucket_audit_integrity(plan)
    dependencies = plan.get("externalDependencies") or {}
    policy = dependencies.get("networkPolicy")
    if dependencies.get("externalAssetCount") != 0 or policy not in {"DENY", "TINIFY_ALLOWLIST_ONLY"}:
        raise ValueError("资源计划必须保持外部素材为 0，并使用 DENY 或 Tinify allowlist 网络策略")
    authorization = tinify_authorization_for_plan(plan)
    if policy == "TINIFY_ALLOWLIST_ONLY" and authorization is None:
        raise ValueError("Tinify allowlist 网络策略缺少 TINIFY_SHRINK 计划项")
    if policy == "DENY" and authorization is not None:
        raise ValueError("TINIFY_SHRINK 计划不能使用 networkPolicy=DENY")
    return plan


def validate_inputs(plan_value: Path, markdown_value: Path, lock_value: Path) -> tuple[Path, Path, Path, dict[str, Any]]:
    plan_path = plan_value.expanduser().resolve()
    md_path = markdown_value.expanduser().resolve()
    lock_path = lock_value.expanduser().resolve()
    plan = verified_plan(plan_path)
    if not md_path.is_file() or md_path.read_text(encoding="utf-8") != render_markdown(plan):
        raise ValueError("资源优化提案不存在或与当前计划不一致")
    lock = load_json(lock_path)
    if not isinstance(lock, dict) or lock.get("schemaVersion") != "playable-resource-toolchain-lock-v1":
        raise ValueError("工具链锁 schemaVersion 无效")
    if lock.get("networkPolicy") != "DENY" or lock.get("externalAssetsUsed") is not False:
        raise ValueError("工具链锁必须声明 networkPolicy=DENY 且 externalAssetsUsed=false")
    plan_toolchain = (plan.get("inputs") or {}).get("toolchain")
    if not isinstance(plan_toolchain, dict) or plan_toolchain.get("path") != str(lock_path) or plan_toolchain.get("sha256") != sha256_file(lock_path):
        raise ValueError("资源优化计划未绑定当前工具链锁")
    return plan_path, md_path, lock_path, plan


def verification_result(
    approval: dict[str, Any], approval_path: Path, plan: dict[str, Any],
    plan_path: Path, md_path: Path, lock_path: Path,
) -> dict[str, Any]:
    errors = []
    if approval.get("status") not in {"APPROVED", "RESOURCE_TRIAL_APPROVED"}:
        errors.append("RESOURCE_PLAN_NOT_APPROVED")
    if approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash"):
        errors.append("RESOURCE_PLAN_HASH_DRIFT")
    expected = {
        "planJson": (plan_path, approval.get("planJson")),
        "planMarkdown": (md_path, approval.get("planMarkdown")),
        "toolchainLock": (lock_path, approval.get("toolchainLock")),
    }
    for label, (path, reference) in expected.items():
        if not path.is_file() or not isinstance(reference, dict) or reference.get("path") != str(path) or reference.get("sha256") != sha256_file(path):
            errors.append(f"{label.upper()}_DRIFT")
    return {
        "schemaVersion": "playable-resource-approval-verification-v1",
        "valid": not errors,
        "optimizationPlanHash": plan.get("optimizationPlanHash"),
        "approval": str(approval_path),
        "approvalBundleId": approval.get("approvalBundleId"),
        "errors": errors,
    }


def main() -> int:
    args = parse_args()
    try:
        plan_path, md_path, lock_path, plan = validate_inputs(args.plan_json, args.plan_md, args.toolchain_lock)
        confirmation = args.confirmation_text.strip()
        if not confirmation:
            raise ValueError("用户确认原话不能为空")
        tinify_authorization = tinify_authorization_for_plan(plan)
        approval = {
            "schemaVersion": "playable-resource-trial-approval-v2",
            "status": "RESOURCE_TRIAL_APPROVED",
            "approvalType": "CANDIDATE_TRIAL_ONLY",
            "approvedAt": utc_now(),
            "approvalBundleId": "sha256:" + sha256_object({
                "plan": plan["optimizationPlanHash"],
                "confirmation": confirmation,
                "planMarkdownSha256": sha256_file(md_path),
                "toolchainLockSha256": sha256_file(lock_path),
            }),
            "projectRoot": plan["projectRoot"],
            "confirmationText": confirmation,
            "optimizationPlanHash": plan["optimizationPlanHash"],
            "planJson": {"path": str(plan_path), "sha256": sha256_file(plan_path)},
            "planMarkdown": {"path": str(md_path), "sha256": sha256_file(md_path)},
            "toolchainLock": {"path": str(lock_path), "sha256": sha256_file(lock_path)},
        }
        if tinify_authorization is not None:
            approval["tinifyAuthorization"] = tinify_authorization
        write_json_atomic(args.output, approval)
        verification = verification_result(approval, args.output.expanduser().resolve(), plan, plan_path, md_path, lock_path)
        if not verification["valid"]:
            raise ValueError("批准记录生成后自验证失败：" + ", ".join(verification["errors"]))
        if args.verification_out:
            write_json_atomic(args.verification_out, verification)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": "已确认可以试做资源优化；当前只会生成候选，不会覆盖工程资源",
        "optimizationPlanHash": approval["optimizationPlanHash"],
        "output": str(args.output.resolve()),
        "verification": str(args.verification_out.resolve()) if args.verification_out else None,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
