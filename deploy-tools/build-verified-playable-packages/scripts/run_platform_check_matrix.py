#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))
sys.path.insert(0, str(SCRIPT_ROOT))

from execution_timeline_core import TimelineError, finish_event, load_timeline, start_event
from record_candidate import CandidateError, verify_manifest_file
from resource_common import load_json, sha256_file, utc_now, write_json_atomic
from rules import RulesetError
from validate_adapter import validate as validate_adapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="对构建矩阵中的 exact artifact 受控并行执行本地完整检查")
    parser.add_argument("--build-matrix", required=True, type=Path)
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument("--target-os", choices=("android", "ios", "both", "unspecified"), default="unspecified")
    parser.add_argument("--delivery-key", required=True)
    parser.add_argument("--resource-state", type=Path)
    parser.add_argument("--baseline-manifest", type=Path)
    parser.add_argument("--accept-warning", action="append", default=[])
    parser.add_argument("--runtime-timeout-seconds", type=int, default=12)
    parser.add_argument("--time-class", choices=("automatic", "rework"), default="automatic")
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def command_result(command: list[str], cwd: Path, log_path: Path, allowed_codes: set[int]) -> dict[str, Any]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        env={**os.environ, "NO_PROXY": "*", "no_proxy": "*", "CI": "1", "PYTHONDONTWRITEBYTECODE": "1"},
        capture_output=True,
        text=True,
        check=False,
    )
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        "命令：" + json.dumps(command, ensure_ascii=False) + "\n"
        + f"退出码：{completed.returncode}\n"
        + "标准输出：\n" + (completed.stdout or "")
        + "\n标准错误：\n" + (completed.stderr or ""),
        encoding="utf-8",
    )
    return {
        "command": command,
        "returnCode": completed.returncode,
        "accepted": completed.returncode in allowed_codes,
        "log": str(log_path),
    }


def validate_build_matrix(path: Path, adapter_sha: str) -> dict[str, Any]:
    report = load_json(path.expanduser().resolve())
    if not isinstance(report, dict) or report.get("schemaVersion") != "playable-platform-build-matrix-v1":
        raise ValueError("平台构建矩阵 schemaVersion 无效")
    if report.get("buildsSucceeded") is not True or report.get("candidateChecksRequired") is not True:
        raise ValueError("平台构建矩阵尚未全部成功，不能开始本地检查")
    if (report.get("adapter") or {}).get("sha256") != adapter_sha:
        raise ValueError("平台构建矩阵与当前 Adapter 不一致")
    targets = report.get("targets") or []
    tasks = report.get("tasks") or []
    if not isinstance(targets, list) or not targets or len(tasks) != len(targets):
        raise ValueError("平台构建矩阵目标与任务数量不一致")
    seen: set[str] = set()
    for task in tasks:
        if not isinstance(task, dict) or task.get("status") != "BUILT_NOT_YET_CHECKED":
            raise ValueError("平台构建矩阵包含未成功的任务")
        platform = str(task.get("platform") or "")
        if not platform or platform in seen:
            raise ValueError("平台构建矩阵平台缺失或重复")
        seen.add(platform)
        artifact = task.get("artifact") or {}
        artifact_path = Path(str(artifact.get("path") or "")).expanduser().resolve()
        if (
            not artifact_path.is_file()
            or artifact_path.stat().st_size != artifact.get("bytes")
            or sha256_file(artifact_path) != artifact.get("sha256")
        ):
            raise ValueError(f"{platform} 构建 artifact 不存在或已发生字节变化")
        receipt = task.get("builderReceipt")
        if receipt is not None:
            receipt_path = Path(str((receipt or {}).get("path") or "")).expanduser().resolve()
            if (
                not receipt_path.is_file()
                or receipt_path.stat().st_size != (receipt or {}).get("bytes")
                or sha256_file(receipt_path) != (receipt or {}).get("sha256")
            ):
                raise ValueError(f"{platform} builder receipt 不存在或已发生字节变化")
    if seen != set(targets):
        raise ValueError("平台构建矩阵 targets 与 tasks 不一致")
    if report.get("phase") == "final":
        freeze = report.get("sourceFreeze") or {}
        freeze_path = Path(str(freeze.get("path") or "")).expanduser().resolve()
        if not freeze_path.is_file() or sha256_file(freeze_path) != freeze.get("sha256"):
            raise ValueError("final 构建矩阵绑定的 source freeze 不存在或已变化")
    return report


def snapshot_artifact(source: Path, target_root: Path, expected_sha256: str) -> Path:
    resolved_source = source.expanduser().resolve()
    snapshot_root = target_root.expanduser().resolve() / "artifact"
    snapshot_root.mkdir(parents=True, exist_ok=False)
    snapshot = snapshot_root / resolved_source.name
    shutil.copyfile(resolved_source, snapshot)
    if sha256_file(snapshot) != expected_sha256:
        raise ValueError("exact artifact 稳定快照与构建矩阵哈希不一致")
    return snapshot


def check_matrix(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    adapter_path = args.adapter.expanduser().resolve()
    timeline_path = args.timeline.expanduser().resolve()
    output_root = args.output_root.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"平台检查矩阵报告已存在，不能复用：{output}")
    load_timeline(timeline_path)
    validation = validate_adapter(project_root, adapter_path)
    if not validation.get("valid"):
        raise ValueError("Adapter 未通过验证，不能执行平台检查矩阵")
    efficiency = validation.get("executionEfficiency") or {}
    if efficiency.get("enabled") is not True:
        raise ValueError("Adapter 未启用 executionEfficiency；请继续使用现有串行检查流程")
    adapter_sha = str((validation.get("adapter") or {}).get("sha256") or "")
    build_matrix_path = args.build_matrix.expanduser().resolve()
    build = validate_build_matrix(build_matrix_path, adapter_sha)
    phase = build.get("phase")
    tasks = build["tasks"]
    platforms = [str(task["platform"]) for task in tasks]
    baseline_candidate = None
    if phase == "plain" and platforms == ["applovin"]:
        if args.resource_state is None:
            raise ValueError("AppLovin plain 基线检查必须提供 --resource-state")
        candidate_mode = "baseline"
    elif phase == "plain":
        if "applovin" in platforms:
            raise ValueError("AppLovin plain 基线必须单独检查")
        if args.baseline_manifest is None:
            raise ValueError("其他平台 plain 检查必须提供 --baseline-manifest")
        baseline_candidate = verify_manifest_file(str(args.baseline_manifest.expanduser().resolve()))
        if baseline_candidate.get("status") != "BASELINE_READY":
            raise ValueError("plain 检查绑定的 AppLovin 清单不是 BASELINE_READY")
        candidate_mode = "platform"
    elif phase == "final":
        if args.resource_state is None:
            raise ValueError("final-recheck 检查必须提供 --resource-state")
        candidate_mode = "final-recheck"
    else:
        raise ValueError("平台构建矩阵 phase 无效")
    if args.resource_state is not None:
        resource_state_path = args.resource_state.expanduser().resolve()
    else:
        resource_state_reference = (baseline_candidate or {}).get("resourceState") or {}
        resource_state_path = Path(str(resource_state_reference.get("path") or "")).expanduser().resolve()
        if not resource_state_path.is_file() or sha256_file(resource_state_path) != resource_state_reference.get("sha256"):
            raise ValueError("平台检查无法从 AppLovin 基线恢复有效的资源状态")
    if args.runtime_timeout_seconds < 1:
        raise ValueError("runtime-timeout-seconds 必须为正整数")
    runtime_workers = int(efficiency.get("runtimeConcurrency") or 1)
    capabilities = validation.get("platformCapabilities") or {}
    output_root.mkdir(parents=True, exist_ok=True)

    def check_platform(task: dict[str, Any]) -> dict[str, Any]:
        platform = str(task["platform"])
        build_artifact = task.get("artifact") or {}
        build_artifact_path = Path(str(build_artifact.get("path") or "")).expanduser().resolve()
        task_root = output_root / platform
        if task_root.exists():
            raise ValueError(f"平台检查目录已存在，不能复用：{task_root}")
        task_root.mkdir(parents=True)
        event = start_event(
            timeline_path,
            phase=f"platform-{phase}-checks",
            operation=f"检查 {platform} {phase} exact artifact",
            time_class=args.time_class,
            platform=platform,
            delivery_key=args.delivery_key,
            input_hashes={
                "adapter": adapter_sha,
                "buildMatrix": sha256_file(build_matrix_path),
                "artifact": str(build_artifact.get("sha256") or ""),
            },
            concurrency_group=f"platform-{phase}-check-wave",
        )
        evidence: list[Path] = []
        commands: dict[str, Any] = {}
        try:
            artifact = snapshot_artifact(
                build_artifact_path,
                task_root,
                str(build_artifact.get("sha256") or ""),
            )
            evidence.append(artifact)
            batch_path = task_root / "check-batch.json"
            commands["checkBatch"] = command_result(
                [
                    sys.executable, str(SCRIPT_ROOT / "create_check_batch.py"),
                    "--platform", platform, "--artifact", str(artifact), "--output", str(batch_path),
                ],
                project_root,
                task_root / "check-batch.log",
                {0},
            )
            evidence.extend([batch_path, Path(commands["checkBatch"]["log"])])
            if not commands["checkBatch"]["accepted"]:
                raise ValueError("创建 check batch 失败")
            batch = load_json(batch_path)
            batch_id = str(batch.get("checkBatchId") or "")
            if not batch_id:
                raise ValueError("check batch 缺少唯一 ID")

            payload_path = task_root / "payload-report.json"
            payload_md = task_root / "payload-report.md"
            static_path = task_root / "static-report.json"
            static_md = task_root / "static-report.md"
            payload_command = [
                sys.executable, str(SCRIPT_ROOT / "scan_candidate_payloads.py"),
                "--artifact", str(artifact), "--platform", platform,
                "--output", str(payload_path), "--md-out", str(payload_md),
                "--check-batch-id", batch_id,
            ]
            static_command = [
                sys.executable, str(SCRIPT_ROOT / "check_artifact.py"),
                "--platform", platform, "--artifact", str(artifact), "--target-os", args.target_os,
                "--json-out", str(static_path), "--md-out", str(static_md),
                "--check-batch-id", batch_id,
            ]
            with ThreadPoolExecutor(max_workers=2) as executor:
                payload_future = executor.submit(
                    command_result, payload_command, project_root, task_root / "payload.log", {0}
                )
                static_future = executor.submit(
                    command_result, static_command, project_root, task_root / "static.log", {0, 2}
                )
                commands["payload"] = payload_future.result()
                commands["static"] = static_future.result()
            evidence.extend([
                payload_path, payload_md, Path(commands["payload"]["log"]),
                static_path, static_md, Path(commands["static"]["log"]),
            ])
            if not commands["payload"]["accepted"] or not commands["static"]["accepted"]:
                raise ValueError("载荷或静态检查存在 blocker")

            receipt_snapshot = None
            receipt_ref = task.get("builderReceipt")
            if isinstance(receipt_ref, dict):
                receipt_source = Path(str(receipt_ref.get("path") or "")).expanduser().resolve()
                receipt_snapshot = task_root / "builder-resource-receipt.json"
                shutil.copyfile(receipt_source, receipt_snapshot)
                if sha256_file(receipt_snapshot) != receipt_ref.get("sha256"):
                    raise ValueError("builder receipt 稳定快照与构建矩阵不一致")
                evidence.append(receipt_snapshot)
            consumption_path = task_root / "resource-consumption-proof.json"
            consumption_command = [
                sys.executable, str(SCRIPT_ROOT / "verify_resource_consumption.py"),
                "--artifact", str(artifact), "--platform", platform,
                "--payload-report", str(payload_path), "--resource-state", str(resource_state_path),
                "--output", str(consumption_path),
            ]
            if receipt_snapshot is not None:
                consumption_command.extend(["--builder-receipt", str(receipt_snapshot)])
            commands["resourceConsumption"] = command_result(
                consumption_command, project_root, task_root / "resource-consumption.log", {0}
            )
            evidence.extend([consumption_path, Path(commands["resourceConsumption"]["log"])])
            if not commands["resourceConsumption"]["accepted"]:
                raise ValueError("最终 artifact 未能证明真实消费候选资源")

            runtime_path = task_root / "runtime-report.json"
            runtime_command = [
                sys.executable, str(SCRIPT_ROOT / "runtime_check.py"),
                "--platform", platform, "--artifact", str(artifact),
                "--output", str(runtime_path), "--adapter", str(adapter_path),
                "--timeout-seconds", str(args.runtime_timeout_seconds), "--check-batch-id", batch_id,
            ]
            cta_selector = (capabilities.get(platform) or {}).get("ctaSelector")
            if cta_selector:
                runtime_command.extend(["--cta-selector", str(cta_selector)])
            commands["runtime"] = command_result(
                runtime_command, project_root, task_root / "runtime.log", {0, 2}
            )
            evidence.extend([runtime_path, Path(commands["runtime"]["log"])])
            if not commands["runtime"]["accepted"]:
                raise ValueError("浏览器运行时检查存在 blocker")

            manifest_path = task_root / "candidate-manifest.json"
            candidate_command = [
                sys.executable, str(SCRIPT_ROOT / "record_candidate.py"), "create",
                "--mode", candidate_mode, "--platform", platform, "--artifact", str(artifact),
                "--static-report", str(static_path), "--runtime-report", str(runtime_path),
                "--payload-report", str(payload_path), "--adapter", str(adapter_path),
                "--resource-consumption-proof", str(consumption_path),
                "--delivery-key", args.delivery_key, "--output", str(manifest_path),
            ]
            if candidate_mode in {"baseline", "final-recheck"}:
                candidate_command.extend(["--resource-state", str(args.resource_state.expanduser().resolve())])
            elif candidate_mode == "platform":
                candidate_command.extend(["--baseline-manifest", str(args.baseline_manifest.expanduser().resolve())])
            if candidate_mode == "final-recheck":
                candidate_command.extend([
                    "--source-freeze",
                    str((build.get("sourceFreeze") or {}).get("path") or ""),
                ])
            for warning in args.accept_warning:
                candidate_command.extend(["--accept-warning", warning])
            commands["candidateManifest"] = command_result(
                candidate_command, project_root, task_root / "candidate-manifest.log", {0}
            )
            evidence.extend([manifest_path, Path(commands["candidateManifest"]["log"])])
            if not commands["candidateManifest"]["accepted"]:
                raise ValueError("候选清单验签失败；warning 或证据仍未满足门禁")
            candidate = verify_manifest_file(str(manifest_path))
            finish_event(
                timeline_path,
                event_id=event["eventId"],
                status="SUCCEEDED",
                output_paths=evidence,
            )
            return {
                "platform": platform,
                "status": "CHECKED",
                "checkBatchId": batch_id,
                "artifact": candidate["artifact"],
                "candidateManifest": {
                    "path": str(manifest_path),
                    "sha256": candidate["manifestSha256"],
                    "status": candidate["status"],
                },
                "commands": commands,
                "timelineEventId": event["eventId"],
            }
        except Exception as exc:
            existing_evidence = [path for path in evidence if path.exists()]
            finish_event(
                timeline_path,
                event_id=event["eventId"],
                status="FAILED",
                output_paths=existing_evidence,
                failure_scope="platform-source",
                message=str(exc),
            )
            return {
                "platform": platform,
                "status": "FAILED",
                "artifact": task.get("artifact"),
                "error": str(exc),
                "commands": commands,
                "timelineEventId": event["eventId"],
            }

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=runtime_workers) as executor:
        futures = {executor.submit(check_platform, task): task["platform"] for task in tasks}
        for future in as_completed(futures):
            platform = str(futures[future])
            try:
                results.append(future.result())
            except Exception as exc:
                results.append({"platform": platform, "status": "FAILED", "error": str(exc)})
    results.sort(key=lambda item: platforms.index(item["platform"]))
    passed = all(item.get("status") == "CHECKED" for item in results)
    report = {
        "schemaVersion": "playable-platform-check-matrix-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "adapter": {"path": str(adapter_path), "sha256": adapter_sha},
        "buildMatrix": {"path": str(build_matrix_path), "sha256": sha256_file(build_matrix_path)},
        "phase": phase,
        "candidateMode": candidate_mode,
        "deliveryKey": args.delivery_key,
        "targetOs": args.target_os,
        "runtimeConcurrency": runtime_workers,
        "tasks": results,
        "checksPassed": passed,
        "userConclusion": (
            "全部 exact artifact 已使用独立 check batch 完成载荷、静态和浏览器运行时检查，并生成候选清单"
            if passed else
            "平台检查矩阵存在失败；必须修复真实生成链并按影响范围重建，不能进入 Checker"
        ),
    }
    write_json_atomic(output, report)
    return report


def main() -> int:
    args = parse_args()
    try:
        report = check_matrix(args)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["checksPassed"] else 1
    except (
        OSError,
        ValueError,
        json.JSONDecodeError,
        CandidateError,
        RulesetError,
        TimelineError,
        subprocess.SubprocessError,
    ) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
