#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
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
from resource_common import load_json, sha256_file, sha256_paths, utc_now, write_json_atomic
from source_freeze import validate_freeze, verify_freeze
from validate_adapter import PLATFORMS, validate as validate_adapter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="按 Adapter 受控并行执行隔离的平台构建命令")
    parser.add_argument("--project-root", required=True, type=Path)
    parser.add_argument("--adapter", required=True, type=Path)
    parser.add_argument("--phase", required=True, choices=("plain", "final"))
    parser.add_argument("--platform", action="append", required=True, choices=sorted(PLATFORMS))
    parser.add_argument("--baseline-manifest", type=Path)
    parser.add_argument("--resource-state", type=Path)
    parser.add_argument("--source-freeze", type=Path)
    parser.add_argument("--timeline", required=True, type=Path)
    parser.add_argument("--time-class", choices=("automatic", "rework"), default="automatic")
    parser.add_argument("--max-workers", type=int)
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def artifact_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise ValueError(f"构建成功但最终输出不存在：{resolved}")
    return {"path": str(resolved), "bytes": resolved.stat().st_size, "sha256": sha256_file(resolved)}


def builder_receipt_ref(path_value: object, artifact: dict[str, Any]) -> dict[str, Any] | None:
    if not path_value:
        return None
    path = Path(str(path_value)).expanduser().resolve()
    if not path.is_file():
        raise ValueError(f"Adapter 声明了 resourceReceipt，但构建后文件不存在：{path}")
    value = load_json(path)
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != "playable-resource-builder-receipt-v1"
        or (value.get("artifact") or {}).get("sha256") != artifact.get("sha256")
    ):
        raise ValueError("resourceReceipt schema 无效或未绑定当前 final artifact")
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256_file(path)}


def baseline_ref(path: Path | None) -> dict[str, Any] | None:
    if path is None:
        return None
    manifest = verify_manifest_file(str(path.expanduser().resolve()))
    if manifest.get("platform") != "applovin" or manifest.get("status") != "BASELINE_READY":
        raise ValueError("其他平台 plain 构建必须绑定有效的 AppLovin BASELINE_READY 清单")
    resolved = path.expanduser().resolve()
    return {
        "path": str(resolved),
        "sha256": sha256_file(resolved),
        "applicationMode": manifest.get("applicationMode"),
        "consumedResourceTree": manifest.get("consumedResourceTree"),
    }


def resource_state_ref(path: Path, project_root: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    state = load_json(resolved)
    if not isinstance(state, dict) or state.get("schemaVersion") != "playable-resource-state-verification-v1":
        raise ValueError("resource state schemaVersion 无效")
    if state.get("status") != "RESOURCE_READY" or Path(str(state.get("projectRoot") or "")).resolve() != project_root:
        raise ValueError("平台构建必须绑定当前项目有效的 RESOURCE_READY")
    tree = state.get("consumedResourceTree") or {}
    roots = tree.get("roots")
    if not isinstance(roots, list) or len(roots) != 1 or not isinstance(roots[0], str):
        raise ValueError("效率构建当前要求 resource state 绑定唯一 consumed resource root")
    root = Path(roots[0]).expanduser().resolve()
    if not root.is_dir() or sha256_paths([root], base=project_root) != tree.get("sha256"):
        raise ValueError("resource state 实际消费资源树不存在或已漂移")
    allowlist = (state.get("evidence") or {}).get("allowlist") or {}
    allowlist_path = Path(str(allowlist.get("path") or "")).expanduser().resolve()
    if (
        not allowlist_path.is_file()
        or allowlist_path.stat().st_size != allowlist.get("bytes")
        or sha256_file(allowlist_path) != allowlist.get("sha256")
    ):
        raise ValueError("resource state 绑定的 allowlist 不存在或已漂移")
    return {
        "path": str(resolved),
        "sha256": sha256_file(resolved),
        "applicationMode": state.get("applicationMode"),
        "consumedResourceTree": tree,
        "resourceRoot": str(root),
        "allowlist": {
            "path": str(allowlist_path),
            "bytes": allowlist_path.stat().st_size,
            "sha256": sha256_file(allowlist_path),
        },
    }


def verify_resource_binding(binding: dict[str, Any], project_root: Path) -> None:
    root = Path(binding["resourceRoot"])
    allowlist = binding["allowlist"]
    allowlist_path = Path(allowlist["path"])
    if sha256_paths([root], base=project_root) != binding["consumedResourceTree"]["sha256"]:
        raise ValueError("平台构建期间实际消费资源树发生漂移")
    if sha256_file(allowlist_path) != allowlist["sha256"]:
        raise ValueError("平台构建期间 allowlist 发生漂移")


def run_matrix(args: argparse.Namespace) -> dict[str, Any]:
    project_root = args.project_root.expanduser().resolve()
    adapter_path = args.adapter.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise ValueError(f"矩阵报告已存在，不能复用：{output}")
    timeline_path = args.timeline.expanduser().resolve()
    load_timeline(timeline_path)
    validation = validate_adapter(project_root, adapter_path)
    if not validation.get("valid"):
        raise ValueError("Adapter 未通过验证，不能执行平台矩阵")
    efficiency = validation.get("executionEfficiency") or {}
    if efficiency.get("enabled") is not True:
        raise ValueError("Adapter 未启用 executionEfficiency；请继续使用现有串行构建流程")
    targets = list(dict.fromkeys(args.platform))
    if args.phase == "plain" and "applovin" in targets and len(targets) > 1:
        raise ValueError("AppLovin plain 基线必须单独构建并通过后，才能并行其他平台")
    baseline = baseline_ref(args.baseline_manifest)
    if args.phase == "plain" and any(item != "applovin" for item in targets) and baseline is None:
        raise ValueError("其他平台 plain 构建缺少 --baseline-manifest")

    resource_args_config = efficiency.get("resourceArgs")
    resource_state = resource_state_ref(args.resource_state, project_root) if args.resource_state else None
    if resource_args_config is not None and resource_state is None:
        raise ValueError("Adapter 已声明 resourceArgs，平台构建必须提供 --resource-state")
    if resource_state is not None and resource_args_config is None:
        raise ValueError("Adapter 未声明 resourceArgs，不能证明平台构建实际消费 RESOURCE_READY")
    if baseline and resource_state and (
        baseline.get("applicationMode") != resource_state.get("applicationMode")
        or baseline.get("consumedResourceTree") != resource_state.get("consumedResourceTree")
    ):
        raise ValueError("其他平台构建的资源状态与 AppLovin 基线不一致")
    resource_command_args: list[str] = []
    if resource_state:
        verify_resource_binding(resource_state, project_root)
        resource_command_args = [
            resource_args_config["resourceRootFlag"], resource_state["resourceRoot"],
            resource_args_config["allowlistFlag"], resource_state["allowlist"]["path"],
        ]

    freeze_ref = None
    if args.phase == "final":
        if args.source_freeze is None:
            raise ValueError("final 矩阵必须提供 --source-freeze")
        freeze_path = args.source_freeze.expanduser().resolve()
        freeze = validate_freeze(load_json(freeze_path))
        verification = verify_freeze(freeze_path)
        if not verification.get("valid"):
            raise ValueError(verification["userConclusion"])
        if set(targets) != set(freeze.get("platforms") or []):
            raise ValueError("final 矩阵必须完整覆盖源码冻结的全部目标平台")
        freeze_ref = {"path": str(freeze_path), "sha256": sha256_file(freeze_path), "sourceFingerprint": freeze.get("sourceFingerprint")}

    capabilities = validation.get("platformCapabilities") or {}
    missing = [item for item in targets if item not in capabilities]
    if missing:
        raise ValueError("Adapter 缺少平台构建：" + "、".join(missing))
    output_paths = [Path(str(capabilities[item].get("output") or "")).resolve() for item in targets]
    if len({str(item) for item in output_paths}) != len(output_paths):
        raise ValueError("并行平台输出路径必须完全隔离，不能共用最终文件")

    configured_workers = int(efficiency.get("buildConcurrency") or 1)
    workers = args.max_workers if args.max_workers is not None else configured_workers
    if not isinstance(workers, int) or isinstance(workers, bool) or workers < 1 or workers > configured_workers:
        raise ValueError(f"max-workers 必须在 1 到 Adapter buildConcurrency={configured_workers} 之间")
    if workers > 1 and efficiency.get("parallelBuilds") is not True:
        raise ValueError("Adapter 未显式声明 parallelBuilds=true，不能并行构建")
    if workers > 1:
        output_roots = [item.parent for item in output_paths]
        for index, left in enumerate(output_roots):
            for right in output_roots[index + 1:]:
                if left == right or left in right.parents or right in left.parents:
                    raise ValueError("并行平台必须使用互不重叠的输出目录；当前 Adapter 只能串行构建")
    if args.timeout_seconds < 1:
        raise ValueError("timeout-seconds 必须为正整数")

    phase_args = efficiency.get("plainArgs" if args.phase == "plain" else "finalArgs") or []
    logs_root = output.parent / f"{output.stem}-logs"
    logs_root.mkdir(parents=True, exist_ok=True)
    adapter_sha = (validation.get("adapter") or {}).get("sha256")

    def execute(platform: str) -> dict[str, Any]:
        capability = capabilities[platform]
        command = [*(capability.get("command") or []), *phase_args, *resource_command_args]
        artifact_path = Path(str(capability.get("output") or "")).expanduser().resolve()
        before = artifact_ref(artifact_path) if artifact_path.is_file() else None
        event = start_event(
            timeline_path,
            phase=f"platform-{args.phase}",
            operation=f"构建 {platform} {args.phase} artifact",
            time_class=args.time_class,
            platform=platform,
            input_hashes={
                "adapter": str(adapter_sha),
                **({"baselineManifest": baseline["sha256"]} if baseline else {}),
                **({"sourceFreeze": freeze_ref["sourceFingerprint"]} if freeze_ref else {}),
                **({"resourceState": resource_state["sha256"]} if resource_state else {}),
            },
            cache_status="NOT_APPLICABLE",
            concurrency_group=f"platform-{args.phase}-build-wave",
        )
        log_path = logs_root / f"{platform}.log"
        try:
            completed = subprocess.run(
                command,
                cwd=project_root,
                env={**os.environ, "NO_PROXY": "*", "no_proxy": "*", "CI": "1"},
                capture_output=True,
                text=True,
                timeout=args.timeout_seconds,
                check=False,
            )
            log_path.write_text(
                "命令：" + json.dumps(command, ensure_ascii=False) + "\n"
                + f"退出码：{completed.returncode}\n"
                + "标准输出：\n" + (completed.stdout or "")
                + "\n标准错误：\n" + (completed.stderr or ""),
                encoding="utf-8",
            )
            if completed.returncode != 0:
                finish_event(
                    timeline_path,
                    event_id=event["eventId"],
                    status="FAILED",
                    output_paths=[log_path],
                    failure_scope="platform-source",
                    message=f"构建命令退出码 {completed.returncode}",
                )
                return {
                    "platform": platform,
                    "status": "FAILED",
                    "command": command,
                    "returnCode": completed.returncode,
                    "artifact": None,
                    "log": str(log_path),
                    "timelineEventId": event["eventId"],
                }
            if resource_state:
                verify_resource_binding(resource_state, project_root)
            after = artifact_ref(artifact_path)
            receipt = builder_receipt_ref(capability.get("resourceReceipt"), after)
            finish_event(
                timeline_path,
                event_id=event["eventId"],
                status="SUCCEEDED",
                output_paths=[artifact_path, log_path, *([Path(receipt["path"])] if receipt else [])],
            )
            return {
                "platform": platform,
                "status": "BUILT_NOT_YET_CHECKED",
                "command": command,
                "returnCode": completed.returncode,
                "artifact": after,
                "builderReceipt": receipt,
                "previousArtifact": before,
                "byteIdenticalToPrevious": bool(before and before["sha256"] == after["sha256"]),
                "log": str(log_path),
                "timelineEventId": event["eventId"],
            }
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            stderr = exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")
            log_path.write_text(
                "命令：" + json.dumps(command, ensure_ascii=False) + "\n"
                + f"结果：超过 {args.timeout_seconds} 秒\n"
                + "标准输出：\n" + stdout + "\n标准错误：\n" + stderr,
                encoding="utf-8",
            )
            finish_event(
                timeline_path,
                event_id=event["eventId"],
                status="FAILED",
                output_paths=[log_path],
                failure_scope="platform-source",
                message=f"构建超过 {args.timeout_seconds} 秒",
            )
            return {
                "platform": platform,
                "status": "FAILED",
                "command": command,
                "returnCode": None,
                "artifact": None,
                "error": f"构建超过 {args.timeout_seconds} 秒",
                "log": str(log_path),
                "timelineEventId": event["eventId"],
            }
        except Exception as exc:
            finish_event(
                timeline_path,
                event_id=event["eventId"],
                status="FAILED",
                failure_scope="platform-source",
                message=str(exc),
            )
            return {
                "platform": platform,
                "status": "FAILED",
                "command": command,
                "returnCode": None,
                "artifact": None,
                "error": str(exc),
                "timelineEventId": event["eventId"],
            }

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(execute, platform): platform for platform in targets}
        for future in as_completed(futures):
            platform = futures[future]
            try:
                results.append(future.result())
            except Exception as exc:
                results.append({"platform": platform, "status": "FAILED", "artifact": None, "error": str(exc)})
    results.sort(key=lambda item: targets.index(item["platform"]))
    ready = all(item.get("status") == "BUILT_NOT_YET_CHECKED" for item in results)
    report = {
        "schemaVersion": "playable-platform-build-matrix-v1",
        "generatedAt": utc_now(),
        "projectRoot": str(project_root),
        "adapter": {"path": str(adapter_path), "sha256": adapter_sha},
        "phase": args.phase,
        "timeClass": args.time_class,
        "targets": targets,
        "maxWorkers": workers,
        "baselineManifest": baseline,
        "resourceState": resource_state,
        "sourceFreeze": freeze_ref,
        "tasks": results,
        "buildsSucceeded": ready,
        "candidateChecksRequired": True,
        "userConclusion": (
            "目标平台构建命令已完成；这些文件尚未通过载荷、静态和运行时检查，不能进入 Checker"
            if ready else
            "平台构建矩阵存在失败；修复真实生成链后按失败范围重新执行"
        ),
    }
    write_json_atomic(output, report)
    return report


def main() -> int:
    args = parse_args()
    try:
        report = run_matrix(args)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["buildsSucceeded"] else 1
    except (OSError, ValueError, json.JSONDecodeError, CandidateError, TimelineError, subprocess.SubprocessError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
