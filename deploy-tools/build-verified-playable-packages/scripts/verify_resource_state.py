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
from resource_common import file_ref, is_within, load_json, resolve_project_path, sha256_file, sha256_paths, utc_now, write_json_atomic


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="验证 RESOURCE_READY 的全部哈希与保真门禁")
    parser.add_argument("--effect-baseline", required=True, type=Path)
    parser.add_argument("--reference-graph", required=True, type=Path)
    parser.add_argument("--allowlist", required=True, type=Path)
    parser.add_argument("--plan-json", required=True, type=Path)
    parser.add_argument("--plan-md", required=True, type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--toolchain-lock", required=True, type=Path)
    parser.add_argument("--toolchain-verification", required=True, type=Path)
    parser.add_argument("--execution-verification", type=Path)
    parser.add_argument("--resource-manifest", required=True, type=Path)
    parser.add_argument("--optimized-ledger", required=True, type=Path)
    parser.add_argument("--fidelity-report", required=True, type=Path)
    parser.add_argument("--provenance", required=True, type=Path)
    parser.add_argument("--external-resource-report", required=True, type=Path)
    parser.add_argument("--application-mode", choices=("applied", "candidate-only"))
    parser.add_argument("--adapter", type=Path)
    parser.add_argument("--source-ledger", type=Path)
    parser.add_argument("--payload-report", type=Path)
    parser.add_argument("--apply-proposal", type=Path)
    parser.add_argument("--apply-approval", type=Path)
    parser.add_argument("--apply-result", type=Path)
    parser.add_argument("--consumed-resource-root", action="append", default=[])
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def resolve_consumed_root(project_root: Path, value: str) -> Path:
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        return resolve_project_path(project_root, value, must_exist=True)
    resolved = candidate.resolve()
    if not is_within(project_root, resolved):
        raise ValueError(f"消费资源目录必须位于项目内：{value}")
    if not resolved.exists():
        raise ValueError(f"消费资源目录不存在：{value}")
    return resolved


def require(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{path.name} schemaVersion 必须为 {schema}")
    return value


def matches_ref(reference: object, path: Path) -> bool:
    return (
        isinstance(reference, dict)
        and reference.get("path") == str(path)
        and reference.get("sha256") == sha256_file(path)
    )


def resolve_resource(project_root: Path, value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = project_root / path
    return path.resolve()


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    try:
        paths = {name: Path(getattr(args, name)).expanduser().resolve() for name in (
            "effect_baseline", "reference_graph", "allowlist", "plan_json", "plan_md",
            "approval", "toolchain_lock", "toolchain_verification", "resource_manifest",
            "optimized_ledger", "fidelity_report", "provenance", "external_resource_report",
        )}
        optional_paths = {}
        for name in ("adapter", "source_ledger", "payload_report", "apply_proposal", "apply_approval", "apply_result", "execution_verification"):
            value = getattr(args, name)
            if value:
                optional_paths[name] = Path(value).expanduser().resolve()
        paths.update(optional_paths)
        effect = require(paths["effect_baseline"], "playable-effect-baseline-assessment-v1")
        graph = require(paths["reference_graph"], "playable-resource-reference-graph-v1")
        allowlist = require(paths["allowlist"], "playable-resource-allowlist-v1")
        plan = verified_plan(paths["plan_json"])
        approval = load_json(paths["approval"])
        if not isinstance(approval, dict) or approval.get("schemaVersion") not in {
            "playable-resource-optimization-approval-v1", "playable-resource-trial-approval-v2",
        }:
            raise ValueError("资源 trial approval schemaVersion 无效")
        toolchain = require(paths["toolchain_lock"], "playable-resource-toolchain-lock-v1")
        toolchain_verification = require(paths["toolchain_verification"], "playable-resource-toolchain-verification-v1")
        resource_manifest = require(paths["resource_manifest"], "playable-resource-manifest-v1")
        optimized_ledger = require(paths["optimized_ledger"], "playable-resource-ledger-v2")
        fidelity = require(paths["fidelity_report"], "playable-resource-fidelity-report-v1")
        provenance = require(paths["provenance"], "playable-resource-provenance-v1")
        external = require(paths["external_resource_report"], "playable-external-resource-report-v1")

        raw_project_roots = [
            value.get("projectRoot") for value in (effect, graph, allowlist, plan, resource_manifest, optimized_ledger, provenance)
        ]
        project_roots = {
            str(Path(value).expanduser().resolve()) for value in raw_project_roots if isinstance(value, str) and value
        }
        if len(project_roots) != 1 or any(not isinstance(value, str) or not value for value in raw_project_roots):
            errors.append("PROJECT_ROOT_MISMATCH")
        project_root = Path(str(effect.get("projectRoot"))).expanduser().resolve()
        if effect.get("status") != "EFFECT_BASELINE_FROZEN":
            errors.append("EFFECT_BASELINE_INVALID")
        if graph.get("unresolved") or allowlist.get("blockers"):
            errors.append("RESOURCE_REFERENCE_UNRESOLVED")
        if approval.get("status") not in {"APPROVED", "RESOURCE_TRIAL_APPROVED"} or approval.get("optimizationPlanHash") != plan.get("optimizationPlanHash"):
            errors.append("RESOURCE_PLAN_APPROVAL_INVALID")
        for label, path in (("planJson", paths["plan_json"]), ("planMarkdown", paths["plan_md"]), ("toolchainLock", paths["toolchain_lock"])):
            if not matches_ref(approval.get(label), path):
                errors.append(f"{label.upper()}_DRIFT")
        if toolchain.get("networkPolicy") != "DENY" or toolchain.get("externalAssetsUsed") is not False:
            errors.append("TOOLCHAIN_POLICY_INVALID")
        if toolchain_verification.get("status") != "TOOLCHAIN_VERIFIED" or not matches_ref(toolchain_verification.get("toolchainLock"), paths["toolchain_lock"]):
            errors.append("TOOLCHAIN_VERIFICATION_INVALID")
        plan_network_policy = (plan.get("externalDependencies") or {}).get("networkPolicy")
        if plan_network_policy not in {"DENY", "TINIFY_ALLOWLIST_ONLY"}:
            errors.append("RESOURCE_PLAN_NETWORK_POLICY_INVALID")
        authorized_tinify = (approval.get("tinifyAuthorization") or {}).get("externalUploadAuthorized") is True
        expected_remote_services = plan_network_policy == "TINIFY_ALLOWLIST_ONLY" and authorized_tinify
        remote_services_used = external.get("remoteServicesUsed")
        valid_remote_services = (
            remote_services_used is False
            if not expected_remote_services else
            remote_services_used in {True, "tinify"}
            and external.get("approvedRemoteServices") == ["tinify"]
        )
        if external.get("unapprovedExternalAssets") not in (0, []) or not valid_remote_services or external.get("runtimeExternalBusinessResources") not in ([], 0):
            errors.append("UNAPPROVED_EXTERNAL_RESOURCE")
        if (fidelity.get("automaticConclusion") or fidelity.get("conclusion")) != "PASS":
            errors.append("AUTOMATIC_FIDELITY_NOT_APPROVED")
        if not isinstance(optimized_ledger.get("duplicateGroups"), list):
            errors.append("OPTIMIZED_LEDGER_DUPLICATE_GROUPS_MISSING")
        if "source_ledger" in paths:
            source_ledger = require(paths["source_ledger"], "playable-resource-ledger-v2")
            if not isinstance(source_ledger.get("duplicateGroups"), list):
                errors.append("SOURCE_LEDGER_DUPLICATE_GROUPS_MISSING")
        lossy = any(item.get("action") in {"TINIFY_SHRINK", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS", "SUBSET_FONT", "PRUNE_CONFIG"} for item in plan.get("items", []))
        human = fidelity.get("humanApproval") or {}
        if lossy:
            if "execution_verification" not in paths:
                errors.append("RESOURCE_EXECUTION_VERIFICATION_MISSING")
            else:
                execution = require(paths["execution_verification"], "playable-resource-execution-verification-v1")
                if execution.get("status") != "EXECUTION_VERIFIED" or not matches_ref(execution.get("planJson"), paths["plan_json"]) or not matches_ref(execution.get("toolchainLock"), paths["toolchain_lock"]):
                    errors.append("RESOURCE_EXECUTION_VERIFICATION_INVALID")

        allowed_ids = {item.get("resourceId") for item in allowlist.get("resources", [])}
        output_resources = resource_manifest.get("resources")
        if not isinstance(output_resources, list):
            errors.append("RESOURCE_MANIFEST_RESOURCES_INVALID")
            output_resources = []
        for item in output_resources:
            if not isinstance(item, dict) or not isinstance(item.get("path"), str):
                errors.append("RESOURCE_MANIFEST_ENTRY_INVALID")
                continue
            if item.get("sourceResourceId") not in allowed_ids:
                errors.append(f"UNEXPECTED_RESOURCE_IMPORT:{item.get('path')}")
            path = resolve_resource(project_root, item["path"])
            if not path.is_file():
                errors.append(f"OPTIMIZED_RESOURCE_MISSING:{item['path']}")
            elif item.get("sha256") != sha256_file(path):
                errors.append(f"OPTIMIZED_RESOURCE_DRIFT:{item['path']}")
        provenance_ids = {
            item.get("resourceId") for item in provenance.get("resources", []) if isinstance(item, dict)
        }
        missing_provenance = sorted(str(item) for item in allowed_ids - provenance_ids)
        if missing_provenance:
            errors.append("RESOURCE_PROVENANCE_MISSING:" + ",".join(missing_provenance))

        application_mode = args.application_mode
        resource_result_type = "legacy"
        consumed_roots: list[Path] = []
        if application_mode:
            required_v15 = {"adapter", "payload_report", "apply_proposal", "apply_approval", "apply_result"}
            missing_v15 = sorted(required_v15 - set(paths))
            if missing_v15:
                errors.append("V15_EVIDENCE_MISSING:" + ",".join(missing_v15))
            else:
                adapter = load_json(paths["adapter"])
                if not isinstance(adapter, dict) or adapter.get("schemaVersion") != "playable-package-build-adapter-v2":
                    errors.append("ADAPTER_V2_REQUIRED")
                    resources = {}
                else:
                    resources = adapter.get("resources") or {}
                payload = require(paths["payload_report"], "playable-candidate-payload-report-v1")
                apply_proposal = require(paths["apply_proposal"], "playable-resource-apply-proposal-v1")
                apply_approval = require(paths["apply_approval"], "playable-resource-apply-approval-v1")
                apply_result = require(paths["apply_result"], "playable-resource-apply-result-v1")
                if payload.get("conclusion") != "PASS" or payload.get("blockers"):
                    errors.append("FINAL_PAYLOAD_BLOCKED")
                if apply_approval.get("applicationMode") != application_mode or apply_result.get("applicationMode") != application_mode:
                    errors.append("APPLICATION_MODE_MISMATCH")
                resource_result_type = apply_proposal.get("resourceResultType")
                if resource_result_type not in {"optimized", "package-only", "unchanged-explicitly-approved"}:
                    errors.append("RESOURCE_RESULT_TYPE_INVALID")
                if apply_approval.get("resourceResultType") != resource_result_type or apply_result.get("resourceResultType") != resource_result_type:
                    errors.append("RESOURCE_RESULT_TYPE_MISMATCH")
                if lossy and human.get("status") != "APPROVED" and (apply_approval.get("humanFidelity") or {}).get("status") != "ACCEPTED":
                    errors.append("HUMAN_FIDELITY_APPROVAL_MISSING")
                if apply_approval.get("proposalHash") != apply_proposal.get("proposalHash"):
                    errors.append("APPLY_PROPOSAL_HASH_DRIFT")
                expected_result_status = "RESOURCE_APPLIED" if application_mode == "applied" else "RESOURCE_APPLY_SKIPPED"
                if apply_result.get("status") != expected_result_status:
                    errors.append("RESOURCE_APPLY_RESULT_INVALID")
                for item in apply_proposal.get("unreferencedResources") or []:
                    unreferenced_path = resolve_project_path(project_root, item.get("path"), must_exist=True)
                    if (
                        not unreferenced_path.is_file()
                        or unreferenced_path.stat().st_size != item.get("bytes")
                        or sha256_file(unreferenced_path) != item.get("sha256")
                    ):
                        errors.append(f"UNREFERENCED_RESOURCE_DRIFT:{item.get('path')}")
                if application_mode == "candidate-only" and apply_result.get("workingTreeBeforeSha256") != apply_result.get("workingTreeAfterSha256"):
                    errors.append("CANDIDATE_ONLY_WORKING_TREE_CHANGED")
                if application_mode == "applied":
                    working = [resolve_project_path(project_root, item, must_exist=True) for item in resources.get("playableWorkingRoots") or []]
                    if not working or sha256_paths(working, base=project_root) != apply_result.get("workingTreeAfterSha256"):
                        errors.append("APPLIED_WORKING_TREE_DRIFT")

                proposal_actions = apply_proposal.get("actions") or []
                package_actions = apply_proposal.get("packageOnlyActions") or []
                artifacts = apply_proposal.get("artifacts") or {}
                before_artifact = artifacts.get("before") or {}
                after_artifact = artifacts.get("after") or {}
                saved_bytes = artifacts.get("savedBytes")
                artifact_changed = before_artifact.get("sha256") != after_artifact.get("sha256")
                if resource_result_type == "optimized":
                    if not lossy or not proposal_actions:
                        errors.append("OPTIMIZED_RESULT_WITHOUT_PLANNED_RESOURCE_ACTION")
                    if not isinstance(saved_bytes, int) or saved_bytes <= 0 or not artifact_changed:
                        errors.append("OPTIMIZED_RESULT_WITHOUT_NET_SAVINGS")
                    for item in proposal_actions:
                        if (
                            not isinstance(item, dict)
                            or item.get("beforeSha256") == item.get("candidateSha256")
                            or not isinstance(item.get("savedBytes"), int)
                            or item.get("savedBytes") <= 0
                            or not isinstance(item.get("actualParameters"), dict)
                            or not item.get("actualParameters")
                        ):
                            action_id = item.get("actionId") if isinstance(item, dict) else "unknown"
                            errors.append(f"INVALID_OPTIMIZED_ACTION:{action_id}")
                elif resource_result_type == "package-only":
                    if lossy or proposal_actions or not package_actions:
                        errors.append("PACKAGE_ONLY_RESULT_SCOPE_INVALID")
                    if not isinstance(saved_bytes, int) or saved_bytes <= 0 or not artifact_changed:
                        errors.append("PACKAGE_ONLY_RESULT_WITHOUT_NET_SAVINGS")
                elif resource_result_type == "unchanged-explicitly-approved":
                    if lossy or proposal_actions or package_actions:
                        errors.append("UNCHANGED_RESULT_SCOPE_INVALID")
                    if saved_bytes != 0 or artifact_changed:
                        errors.append("UNCHANGED_RESULT_ARTIFACT_DRIFT")

            for value in args.consumed_resource_root:
                consumed_roots.append(resolve_consumed_root(project_root, value))
            if not consumed_roots:
                errors.append("CONSUMED_RESOURCE_ROOT_MISSING")
        else:
            application_mode = "legacy"
            if lossy and human.get("status") != "APPROVED":
                errors.append("HUMAN_FIDELITY_APPROVAL_MISSING")

        consumed_resource_tree = None
        if consumed_roots:
            consumed_resource_tree = {
                "roots": [str(item) for item in consumed_roots],
                "sha256": sha256_paths(consumed_roots, base=project_root),
            }

        status = "RESOURCE_READY" if not errors else "BLOCKED"
        report = {
            "schemaVersion": "playable-resource-state-verification-v1",
            "generatedAt": utc_now(),
            "status": status,
            "userConclusion": (
                (
                    "资源优化候选已验证，可以开始生成 AppLovin 候选包；确认资源已写回工程"
                    if resource_result_type == "optimized" and application_mode == "applied" else
                    "资源优化候选已验证，可以开始生成 AppLovin 候选包；正式工程资源未被覆盖"
                    if resource_result_type == "optimized" else
                    "仅完成未引用载荷排除或最终包去重，可以开始生成 AppLovin 候选包；正式工程资源未被覆盖"
                    if resource_result_type == "package-only" else
                    "用户已明确确认本轮不做资源优化，可以继续生成 AppLovin 候选包；正式工程资源未被覆盖"
                    if resource_result_type == "unchanged-explicitly-approved" else
                    "资源优化已完成，可以开始生成 AppLovin 候选包；目前还没有完成平台交付"
                ) if status == "RESOURCE_READY"
                else "资源阶段仍有阻塞，尚不能生成 AppLovin 候选包"
            ),
            "projectRoot": str(project_root),
            "effectFingerprint": effect.get("effectFingerprint"),
            "resourceReferenceGraphHash": graph.get("graphHash"),
            "resourceAllowlistHash": allowlist.get("allowlistHash"),
            "optimizationPlanHash": plan.get("optimizationPlanHash"),
            "toolchainLockHash": toolchain.get("toolchainLockHash"),
            "applicationMode": application_mode,
            "resourceResultType": resource_result_type,
            "consumedResourceTree": consumed_resource_tree,
            "networkPolicy": toolchain.get("networkPolicy"),
            "externalAssetsUsed": toolchain.get("externalAssetsUsed"),
            "evidence": {name: file_ref(path) for name, path in paths.items()},
            "errors": sorted(set(errors)),
        }
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        report = {
            "schemaVersion": "playable-resource-state-verification-v1",
            "generatedAt": utc_now(),
            "status": "BLOCKED",
            "userConclusion": "资源阶段仍有阻塞，尚不能生成 AppLovin 候选包",
            "errors": [str(exc)],
        }
    write_json_atomic(args.output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "RESOURCE_READY" else 1


if __name__ == "__main__":
    raise SystemExit(main())
