#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

LIB_ROOT = Path(__file__).resolve().parent / "lib"
sys.path.insert(0, str(LIB_ROOT))

from artifact import ArtifactError, load_artifact, sha256_file
from resource_common import sha256_tree
from rules import RulesetError, verify_ruleset

READY_STATUSES = {
    "BASELINE_READY",
    "PLATFORM_READY",
    "FINAL_RECHECK_READY",
}
ACCEPTABLE_WARNING_IDS = {"COMMON-STA-004"}


class CandidateError(RuntimeError):
    pass


def load_json_file(path_value: str, label: str) -> tuple[Path, dict]:
    path = Path(path_value).expanduser().resolve()
    if not path.is_file():
        raise CandidateError(f"{label} 不存在: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} 无法读取: {exc}") from exc
    if not isinstance(data, dict):
        raise CandidateError(f"{label} 顶层必须是对象")
    return path, data


def parse_acceptances(values: list[str]) -> dict[str, str]:
    accepted: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise CandidateError(f"warning 接受格式必须为 RULE_ID=证据或理由: {value}")
        rule_id, reason = value.split("=", 1)
        rule_id = rule_id.strip()
        reason = reason.strip()
        if not rule_id or not reason:
            raise CandidateError(f"warning 接受内容不完整: {value}")
        accepted[rule_id] = reason
    return accepted


def report_ref(path: Path) -> dict:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
    }


def verify_resource_state(path_value: str) -> dict:
    path, state = load_json_file(path_value, "资源状态验证报告")
    if state.get("schemaVersion") != "playable-resource-state-verification-v1":
        raise CandidateError("资源状态验证报告 schemaVersion 不受支持")
    if state.get("status") != "RESOURCE_READY":
        raise CandidateError("资源优化尚未完成，不能生成平台候选清单")
    legacy_one_time = state.get("legacyOneTimeInput") is True
    if legacy_one_time:
        acceptance = state.get("userAcceptance")
        if not isinstance(acceptance, dict) or not acceptance.get("confirmationText"):
            raise CandidateError("一次性 legacy 资源缺少用户明确接受记录")
        if "LEGACY_TOOLCHAIN_UNKNOWN" not in (state.get("warnings") or []):
            raise CandidateError("一次性 legacy 资源未保留工具链不可复现警告")
    elif state.get("networkPolicy") != "DENY" or state.get("externalAssetsUsed") is not False:
        raise CandidateError("资源状态未保持离线且无外部素材策略")
    evidence = state.get("evidence")
    if not isinstance(evidence, dict) or not evidence:
        raise CandidateError("资源状态缺少哈希绑定证据")
    for label, reference in evidence.items():
        if not isinstance(reference, dict):
            raise CandidateError(f"资源状态证据无效: {label}")
        evidence_path = Path(str(reference.get("path", ""))).expanduser().resolve()
        if not evidence_path.exists() or sha256_tree(evidence_path) != reference.get("sha256"):
            raise CandidateError(f"资源状态证据不存在或漂移: {label}")
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "effectFingerprint": state.get("effectFingerprint"),
        "resourceAllowlistHash": state.get("resourceAllowlistHash"),
        "optimizationPlanHash": state.get("optimizationPlanHash"),
        "toolchainLockHash": state.get("toolchainLockHash"),
        "legacyOneTimeInput": legacy_one_time,
        "warnings": state.get("warnings", []),
        "applicationMode": state.get("applicationMode", "legacy"),
        "consumedResourceTree": state.get("consumedResourceTree"),
    }


def verify_source_freeze(path_value: str, platform: str) -> dict:
    from source_freeze import verify_freeze

    path = Path(path_value).expanduser().resolve()
    try:
        report = verify_freeze(path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise CandidateError(f"source freeze 无效：{exc}") from exc
    if report.get("valid") is not True:
        raise CandidateError(str(report.get("userConclusion") or "source freeze 已失效"))
    _, freeze = load_json_file(str(path), "source freeze")
    if platform not in set(freeze.get("platforms") or []):
        raise CandidateError(f"source freeze 未包含当前平台：{platform}")
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "sourceFingerprint": freeze.get("sourceFingerprint"),
        "adapterSha256": (freeze.get("adapter") or {}).get("sha256"),
    }


def verify_report_artifact(report: dict, artifact_sha: str, platform: str, label: str) -> None:
    if report.get("platform") != platform:
        raise CandidateError(f"{label} 平台不匹配")
    report_artifact = report.get("artifact")
    if not isinstance(report_artifact, dict) or report_artifact.get("sha256") != artifact_sha:
        raise CandidateError(f"{label} 未绑定当前 artifact SHA-256")


def validate_runtime_capture(report: dict, platform: str) -> None:
    capture = report.get("ctaCapture")
    if not isinstance(capture, dict) or capture.get("conclusion") != "PASS":
        raise CandidateError("运行时报告缺少通过的可信 CTA 捕获")
    if (
        capture.get("hookInstalledBeforeBusinessScripts") is not True
        or capture.get("isTrusted") is not True
        or capture.get("inputMethod") not in {"cdp-mouse", "cdp-touch"}
        or not isinstance(capture.get("gameplayStage"), str)
        or not capture.get("gameplayStage")
        or not isinstance(capture.get("coordinates"), dict)
        or not (capture.get("target") or {}).get("actionable") is True
    ):
        raise CandidateError("运行时 CTA 不是由浏览器可信输入在可操作阶段触发")
    expected = {
        "applovin": {"mraid"},
        "unityads": {"mraid"},
        "moloco": {"fb-cta"},
        "meta": {"fb-cta"},
        "tiktok": {"open-app-store"},
        "mintegral": {"mintegral"},
        "google-ads": {"exit-api", "mraid"},
    }.get(platform, set())
    calls = capture.get("actualBridgeCalls") or []
    if not any(isinstance(item, dict) and item.get("bridge") in expected for item in calls):
        raise CandidateError("运行时 CTA 未调用当前平台期望 bridge")
    if platform == "mintegral":
        lifecycle = report.get("lifecycleCapture")
        if (
            not isinstance(lifecycle, dict)
            or lifecycle.get("conclusion") != "PASS"
            or lifecycle.get("installCaptured") is not True
            or lifecycle.get("sequenceValid") is not True
            or lifecycle.get("gameEndAtMs") is None
        ):
            raise CandidateError("Mintegral 运行时报告未证明 install 与 gameReady → gameStart → gameEnd 完整顺序")


def warning_ids(report: dict, label: str) -> set[str]:
    ids: set[str] = set()
    for check in report.get("checks", []):
        if isinstance(check, dict) and check.get("status") == "warning":
            rule_id = check.get("id")
            if isinstance(rule_id, str):
                ids.add(rule_id)
    if report.get("conclusion") == "UNAVAILABLE":
        ids.add("RUNTIME-UNAVAILABLE")
    if report.get("conclusion") == "FAIL":
        raise CandidateError(f"{label} 存在 blocker")
    return ids


def validate_warning_policy(unresolved: set[str], accepted: dict[str, str], target_os: str | None = None) -> None:
    unsupported_acceptances = sorted(set(accepted) - ACCEPTABLE_WARNING_IDS)
    if unsupported_acceptances:
        raise CandidateError(
            "以下 warning 不允许接受，必须修复并重建: "
            + ", ".join(unsupported_acceptances)
        )
    must_fix = sorted(unresolved - ACCEPTABLE_WARNING_IDS)
    if must_fix:
        raise CandidateError("以下 warning 必须修复并重建: " + ", ".join(must_fix))
    missing_acceptance = sorted(unresolved - set(accepted))
    if missing_acceptance:
        raise CandidateError("以下商店地址 warning 未记录实际单端投放依据: " + ", ".join(missing_acceptance))
    if "COMMON-STA-004" in unresolved and target_os != "android":
        raise CandidateError("COMMON-STA-004 只允许 Android 单端投放缺少 iOS App Store 地址时保留")


def manual_gates(report: dict) -> list[dict]:
    gates = []
    for check in report.get("checks", []):
        if not isinstance(check, dict) or check.get("status") != "manual":
            continue
        gates.append({
            "id": check.get("id"),
            "title": check.get("title"),
            "manualGate": check.get("manualGate") or check.get("summary"),
        })
    return gates


def verify_manifest_file(path_value: str, verify_current_ruleset: bool = True) -> dict:
    path, manifest = load_json_file(path_value, "候选清单")
    if manifest.get("schemaVersion") not in {"playable-candidate-manifest-v2", "playable-candidate-manifest-v3", "playable-candidate-manifest-v4"}:
        raise CandidateError("候选清单 schemaVersion 不受支持")
    if manifest.get("status") not in READY_STATUSES:
        raise CandidateError(f"候选清单状态不可用: {manifest.get('status')}")

    artifact_info = manifest.get("artifact")
    if not isinstance(artifact_info, dict):
        raise CandidateError("候选清单缺少 artifact")
    artifact_path = Path(str(artifact_info.get("path", ""))).expanduser().resolve()
    if not artifact_path.is_file():
        raise CandidateError(f"候选 artifact 不存在: {artifact_path}")
    actual_artifact_sha = sha256_file(artifact_path)
    if actual_artifact_sha != artifact_info.get("sha256"):
        raise CandidateError("候选 artifact 已发生字节变化")

    report_data: dict[str, dict] = {}
    for label in ("staticReport", "runtimeReport"):
        ref = manifest.get(label)
        if not isinstance(ref, dict):
            raise CandidateError(f"候选清单缺少 {label}")
        report_path = Path(str(ref.get("path", ""))).expanduser().resolve()
        if not report_path.is_file() or sha256_file(report_path) != ref.get("sha256"):
            raise CandidateError(f"{label} 不存在或哈希已变化")
        _, report_data[label] = load_json_file(str(report_path), label)
        verify_report_artifact(report_data[label], actual_artifact_sha, manifest.get("platform"), label)
        if (report_data[label].get("ruleset") or {}).get("rulesetSha256") != (manifest.get("ruleset") or {}).get("rulesetSha256"):
            raise CandidateError(f"{label} 与候选清单 ruleset 不一致")
    validate_runtime_capture(report_data["runtimeReport"], str(manifest.get("platform") or ""))

    delivery_context = manifest.get("deliveryContext")
    if not isinstance(delivery_context, dict) or delivery_context.get("targetOs") not in {
        "android", "ios", "both", "unspecified",
    }:
        raise CandidateError("候选清单缺少合法的 deliveryContext.targetOs")
    if report_data["staticReport"].get("deliveryContext") != delivery_context:
        raise CandidateError("候选清单 deliveryContext 与静态报告不一致")
    unresolved_warnings = warning_ids(report_data["staticReport"], "静态报告")
    unresolved_warnings.update(warning_ids(report_data["runtimeReport"], "运行时报告"))
    accepted_warnings = {
        str(item.get("id")): str(item.get("evidence"))
        for item in manifest.get("acceptedWarnings") or []
        if isinstance(item, dict) and item.get("id") and item.get("evidence")
    }
    validate_warning_policy(unresolved_warnings, accepted_warnings, delivery_context.get("targetOs"))

    resource_state = manifest.get("resourceState")
    if not isinstance(resource_state, dict):
        raise CandidateError("候选清单缺少 RESOURCE_READY 资源状态")
    verified_resource_state = verify_resource_state(str(resource_state.get("path", "")))
    if verified_resource_state.get("sha256") != resource_state.get("sha256"):
        raise CandidateError("关联资源状态已发生变化")
    if manifest.get("schemaVersion") in {"playable-candidate-manifest-v3", "playable-candidate-manifest-v4"}:
        if manifest.get("applicationMode") not in {"applied", "candidate-only"}:
            raise CandidateError("v3 候选清单 applicationMode 无效")
        if manifest.get("applicationMode") != verified_resource_state.get("applicationMode"):
            raise CandidateError("候选清单 applicationMode 与资源状态不一致")
        if manifest.get("consumedResourceTree") != verified_resource_state.get("consumedResourceTree"):
            raise CandidateError("候选清单未绑定资源状态的实际消费资源树")
        adapter_data = None
        for label in ("payloadReport", "adapter"):
            reference = manifest.get(label)
            if not isinstance(reference, dict):
                raise CandidateError(f"v3 候选清单缺少 {label}")
            reference_path = Path(str(reference.get("path", ""))).expanduser().resolve()
            if not reference_path.is_file() or sha256_file(reference_path) != reference.get("sha256"):
                raise CandidateError(f"{label} 不存在或漂移")
            if label == "adapter":
                _, adapter_data = load_json_file(str(reference_path), "adapter")
        efficiency_enabled = bool(
            isinstance(adapter_data, dict)
            and (adapter_data.get("executionEfficiency") or {}).get("enabled") is True
        )
        source_freeze = manifest.get("sourceFreeze")
        if manifest.get("mode") == "final-recheck" and efficiency_enabled and not isinstance(source_freeze, dict):
            raise CandidateError("启用效率编排的 final-recheck 清单缺少 source freeze")
        if isinstance(source_freeze, dict):
            if manifest.get("mode") != "final-recheck":
                raise CandidateError("source freeze 只能绑定 final-recheck 清单")
            verified_freeze = verify_source_freeze(str(source_freeze.get("path") or ""), str(manifest.get("platform") or ""))
            if (
                source_freeze.get("sha256") != verified_freeze.get("sha256")
                or source_freeze.get("sourceFingerprint") != verified_freeze.get("sourceFingerprint")
                or verified_freeze.get("adapterSha256") != (manifest.get("adapter") or {}).get("sha256")
            ):
                raise CandidateError("候选清单与 source freeze 不一致")
    if manifest.get("schemaVersion") == "playable-candidate-manifest-v4":
        batch_id = manifest.get("checkBatchId")
        if not isinstance(batch_id, str) or not batch_id:
            raise CandidateError("v4 候选清单缺少 checkBatchId")
        for label, report in report_data.items():
            if report.get("checkBatchId") != batch_id:
                raise CandidateError(f"{label} 不属于候选清单记录的检查批次")
        payload_path = Path(str((manifest.get("payloadReport") or {}).get("path", ""))).resolve()
        _, payload_data = load_json_file(str(payload_path), "payloadReport")
        if payload_data.get("checkBatchId") != batch_id:
            raise CandidateError("payloadReport 不属于候选清单记录的检查批次")
        if payload_data.get("platform") != manifest.get("platform") or (payload_data.get("artifact") or {}).get("sha256") != actual_artifact_sha:
            raise CandidateError("payloadReport 未绑定当前平台 artifact")
        proof_ref = manifest.get("resourceConsumptionProof")
        if not isinstance(proof_ref, dict):
            raise CandidateError("v4 候选清单缺少资源消费证明")
        proof_path = Path(str(proof_ref.get("path") or "")).expanduser().resolve()
        if not proof_path.is_file() or sha256_file(proof_path) != proof_ref.get("sha256"):
            raise CandidateError("资源消费证明不存在或已漂移")
        _, proof = load_json_file(str(proof_path), "资源消费证明")
        if (
            proof.get("schemaVersion") != "resource-consumption-proof-v1"
            or proof.get("conclusion") != "PASS"
            or proof.get("platform") != manifest.get("platform")
            or (proof.get("artifact") or {}).get("sha256") != actual_artifact_sha
            or (proof.get("resourceState") or {}).get("sha256") != resource_state.get("sha256")
        ):
            raise CandidateError("资源消费证明未通过或未绑定当前 artifact/资源状态")

    baseline = manifest.get("baselineManifest")
    if isinstance(baseline, dict):
        baseline_path = Path(str(baseline.get("path", ""))).expanduser().resolve()
        if not baseline_path.is_file() or sha256_file(baseline_path) != baseline.get("sha256"):
            raise CandidateError("关联 baseline manifest 不存在或已变化")
        _, baseline_data = load_json_file(str(baseline_path), "baseline manifest")
        if baseline_data.get("status") != "BASELINE_READY":
            raise CandidateError("关联 baseline 不再是 BASELINE_READY")
        if (baseline_data.get("artifact") or {}).get("sha256") != baseline.get("artifactSha256"):
            raise CandidateError("关联 baseline artifact 哈希不匹配")
        if manifest.get("deliveryKey") and baseline_data.get("deliveryKey") and manifest.get("deliveryKey") != baseline_data.get("deliveryKey"):
            raise CandidateError("平台候选 deliveryKey 与关联 baseline 不一致")

    if verify_current_ruleset:
        current = verify_ruleset()
        embedded = manifest.get("ruleset") or {}
        if embedded.get("rulesetSha256") != current["rulesetSha256"]:
            raise CandidateError("当前 Skill ruleset 已变化，候选必须重新检查")

    result = dict(manifest)
    result["manifestPath"] = str(path)
    result["manifestSha256"] = sha256_file(path)
    return result


def create_candidate(args: argparse.Namespace) -> int:
    accepted = parse_acceptances(args.accept_warning or [])
    try:
        artifact = load_artifact(args.artifact)
        static_path, static_report = load_json_file(args.static_report, "静态报告")
        runtime_path, runtime_report = load_json_file(args.runtime_report, "运行时报告")
        verify_report_artifact(static_report, artifact.sha256, args.platform, "静态报告")
        verify_report_artifact(runtime_report, artifact.sha256, args.platform, "运行时报告")
        validate_runtime_capture(runtime_report, args.platform)

        static_ruleset = static_report.get("ruleset") or {}
        runtime_ruleset = runtime_report.get("ruleset") or {}
        if static_ruleset.get("rulesetSha256") != runtime_ruleset.get("rulesetSha256"):
            raise CandidateError("静态与运行时报告 ruleset 不一致")
        current_ruleset = verify_ruleset()
        if static_ruleset.get("rulesetSha256") != current_ruleset["rulesetSha256"]:
            raise CandidateError("报告未使用当前 Skill ruleset")

        delivery_context = static_report.get("deliveryContext")
        if not isinstance(delivery_context, dict) or delivery_context.get("targetOs") not in {
            "android", "ios", "both", "unspecified",
        }:
            raise CandidateError("静态报告缺少合法的 deliveryContext.targetOs")

        unresolved_warnings = warning_ids(static_report, "静态报告")
        unresolved_warnings.update(warning_ids(runtime_report, "运行时报告"))
        validate_warning_policy(unresolved_warnings, accepted, delivery_context.get("targetOs"))

        if args.mode == "baseline" and args.platform != "applovin":
            raise CandidateError("baseline 模式只允许 applovin")
        if args.mode == "platform" and not args.baseline_manifest:
            raise CandidateError("platform 模式必须提供 baseline manifest")

        resource_state_ref = None
        if args.resource_state:
            resource_state_ref = verify_resource_state(args.resource_state)
        if args.mode in {"baseline", "final-recheck"} and resource_state_ref is None:
            raise CandidateError(f"{args.mode} 模式必须提供 --resource-state")

        baseline_ref = None
        if args.baseline_manifest:
            baseline = verify_manifest_file(args.baseline_manifest)
            if baseline.get("status") != "BASELINE_READY":
                raise CandidateError("输入清单不是 BASELINE_READY")
            baseline_path = Path(baseline["manifestPath"])
            baseline_ref = {
                "path": str(baseline_path),
                "sha256": baseline["manifestSha256"],
                "artifactSha256": baseline["artifact"]["sha256"],
            }
            baseline_resource_state = baseline.get("resourceState")
            if resource_state_ref and resource_state_ref.get("sha256") != baseline_resource_state.get("sha256"):
                raise CandidateError("显式资源状态与 AppLovin 基线不一致")
            resource_state_ref = baseline_resource_state

        payload_ref = None
        adapter_ref = None
        source_freeze_ref = None
        if args.payload_report or args.adapter:
            if not args.payload_report or not args.adapter:
                raise CandidateError("v1.5 候选必须同时提供 --payload-report 和 --adapter")
            if not args.resource_consumption_proof:
                raise CandidateError("v1.5 候选必须提供 --resource-consumption-proof，不能只凭构建参数声明资源已被消费")
            payload_path, payload = load_json_file(args.payload_report, "最终载荷报告")
            if payload.get("schemaVersion") != "playable-candidate-payload-report-v1":
                raise CandidateError("最终载荷报告 schemaVersion 无效")
            if payload.get("conclusion") != "PASS" or payload.get("blockers"):
                raise CandidateError("最终载荷报告仍有 blocker")
            if (payload.get("artifact") or {}).get("sha256") != artifact.sha256 or payload.get("platform") != args.platform:
                raise CandidateError("最终载荷报告未绑定当前平台 artifact")
            adapter_path, adapter = load_json_file(args.adapter, "v2 Adapter")
            if adapter.get("schemaVersion") != "playable-package-build-adapter-v2":
                raise CandidateError("v1.5 候选必须绑定 v2 Adapter")
            if resource_state_ref.get("applicationMode") not in {"applied", "candidate-only"}:
                raise CandidateError("v1.5 候选资源状态缺少 applicationMode")
            if not isinstance(resource_state_ref.get("consumedResourceTree"), dict):
                raise CandidateError("v1.5 候选资源状态缺少实际消费资源树")
            payload_ref = report_ref(payload_path)
            proof_path, proof = load_json_file(args.resource_consumption_proof, "资源消费证明")
            if (
                proof.get("schemaVersion") != "resource-consumption-proof-v1"
                or proof.get("conclusion") != "PASS"
                or proof.get("platform") != args.platform
                or (proof.get("artifact") or {}).get("sha256") != artifact.sha256
                or (proof.get("resourceState") or {}).get("sha256") != resource_state_ref.get("sha256")
            ):
                raise CandidateError("资源消费证明未通过或未绑定当前 artifact/资源状态")
            resource_consumption_ref = report_ref(proof_path)
            adapter_ref = report_ref(adapter_path)
            efficiency_enabled = (adapter.get("executionEfficiency") or {}).get("enabled") is True
            if args.mode == "final-recheck" and efficiency_enabled and not args.source_freeze:
                raise CandidateError("启用效率编排的 final-recheck 必须提供 --source-freeze")
            if args.source_freeze:
                if args.mode != "final-recheck":
                    raise CandidateError("--source-freeze 只用于 final-recheck 清单")
                source_freeze_ref = verify_source_freeze(args.source_freeze, args.platform)
                if source_freeze_ref.get("adapterSha256") != adapter_ref.get("sha256"):
                    raise CandidateError("source freeze 与当前 Adapter 不一致")
            batch_ids = {
                static_report.get("checkBatchId"),
                runtime_report.get("checkBatchId"),
                payload.get("checkBatchId"),
            }
            if None in batch_ids or "" in batch_ids or len(batch_ids) != 1:
                raise CandidateError("v1.5 候选的静态、运行时和载荷报告必须绑定同一非空 checkBatchId")
            check_batch_id = next(iter(batch_ids))
        else:
            check_batch_id = None
            resource_consumption_ref = None

        if args.mode == "baseline":
            status = "BASELINE_READY"
        elif args.mode == "platform":
            status = "PLATFORM_READY"
        else:
            status = "FINAL_RECHECK_READY"

        gates = manual_gates(static_report) + manual_gates(runtime_report)
        target_os = delivery_context.get("targetOs")
        if args.delivery_key:
            current_delivery_key = args.delivery_key.strip()
        else:
            file_name = Path(artifact.path).name
            version = re.search(r"(?:^|[_-])(V\d+)(?:[_-]|$)", file_name, re.IGNORECASE)
            taps = re.search(r"(?:^|[_-])(\d+tap)(?:[_.-]|$)", file_name, re.IGNORECASE)
            current_delivery_key = f"{target_os}:{(version.group(1) if version else 'default').lower()}:{(taps.group(1) if taps else 'default').lower()}"
        if baseline_ref:
            baseline_key = baseline.get("deliveryKey")
            if isinstance(baseline_key, str) and baseline_key:
                if args.delivery_key and current_delivery_key != baseline_key:
                    raise CandidateError("平台候选 deliveryKey 与 AppLovin 基线不一致")
                current_delivery_key = baseline_key
            baseline_ref["deliveryKey"] = current_delivery_key
        manifest = {
            "schemaVersion": "playable-candidate-manifest-v4" if payload_ref else "playable-candidate-manifest-v2",
            "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "mode": args.mode,
            "status": status,
            "platform": args.platform,
            "deliveryKey": current_delivery_key,
            "deliveryContext": dict(delivery_context),
            "artifact": artifact.to_report_dict(),
            "ruleset": {
                "rulesetVersion": static_ruleset.get("rulesetVersion"),
                "rulesetSha256": static_ruleset.get("rulesetSha256"),
            },
            "staticReport": report_ref(static_path),
            "runtimeReport": report_ref(runtime_path),
            "resourceState": resource_state_ref,
            "acceptedWarnings": [
                {"id": rule_id, "evidence": reason}
                for rule_id, reason in sorted(accepted.items())
                if rule_id in unresolved_warnings
            ],
            "manualGates": gates,
            "performanceAssessment": runtime_report.get("performanceAssessment"),
        }
        if payload_ref:
            manifest["checkBatchId"] = check_batch_id
            manifest["payloadReport"] = payload_ref
            manifest["adapter"] = adapter_ref
            manifest["applicationMode"] = resource_state_ref["applicationMode"]
            manifest["consumedResourceTree"] = resource_state_ref["consumedResourceTree"]
            manifest["resourceConsumptionProof"] = resource_consumption_ref
        if baseline_ref:
            manifest["baselineManifest"] = baseline_ref
        if source_freeze_ref:
            manifest["sourceFreeze"] = {
                "path": source_freeze_ref["path"],
                "sha256": source_freeze_ref["sha256"],
                "sourceFingerprint": source_freeze_ref["sourceFingerprint"],
            }

        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, ensure_ascii=False, indent=2))
        return 0
    except (ArtifactError, CandidateError, RulesetError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


def verify_candidate(args: argparse.Namespace) -> int:
    try:
        manifest = verify_manifest_file(args.manifest)
    except (CandidateError, RulesetError, OSError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "status": manifest["status"],
        "platform": manifest["platform"],
        "artifactSha256": manifest["artifact"]["sha256"],
        "manifestPath": manifest["manifestPath"],
        "manifestSha256": manifest["manifestSha256"],
    }, ensure_ascii=False, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="绑定 playable 候选包、规则集和检查报告")
    subparsers = root.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("--mode", required=True, choices=["baseline", "platform", "final-recheck"])
    create.add_argument("--platform", required=True)
    create.add_argument("--artifact", required=True)
    create.add_argument("--static-report", required=True)
    create.add_argument("--runtime-report", required=True)
    create.add_argument("--baseline-manifest")
    create.add_argument("--resource-state")
    create.add_argument("--payload-report")
    create.add_argument("--resource-consumption-proof")
    create.add_argument("--adapter")
    create.add_argument("--source-freeze", help="效率编排 final-recheck 必须绑定的有效源码冻结")
    create.add_argument("--accept-warning", action="append", default=[])
    create.add_argument("--delivery-key", help="交付组合标识，例如 android:v1:3tap；平台包必须与其基线一致")
    create.add_argument("--output", required=True)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--manifest", required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "create":
        return create_candidate(args)
    return verify_candidate(args)


if __name__ == "__main__":
    raise SystemExit(main())
