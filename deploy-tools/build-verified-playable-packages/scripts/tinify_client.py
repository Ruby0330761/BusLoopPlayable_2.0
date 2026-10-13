#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import socket
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_ROOT = Path(__file__).resolve().parent
LIB_ROOT = SCRIPT_ROOT / "lib"
sys.path.insert(0, str(LIB_ROOT))

from resource_common import load_json, sha256_file, utc_now, write_json_atomic
from resource_metadata import probe_image
from tinify_config import load_api_key


DEFAULT_ENDPOINT = "https://api.tinify.com"
PIXEL_SENSITIVE = {
    "NORMAL", "NORMAL_MAP", "DATA", "DATA_IMAGE", "PIXEL_MASK", "LOOKUP_TABLE",
    "LUT", "INDEXED_IMAGE", "QR_CODE", "BARCODE", "PIXEL_PROTOCOL", "PIXEL_EQUIVALENT",
}
FORBIDDEN_SHRINK_PARAMETERS = {"resize", "convert", "metadata", "quality", "preserve"}


class TinifyError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _safe_endpoint(endpoint: str, *, allow_http_localhost: bool) -> str:
    value = endpoint.rstrip("/")
    parsed = urllib.parse.urlparse(value)
    if parsed.scheme == "https" and parsed.hostname:
        return value
    if allow_http_localhost and parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}:
        return value
    raise ValueError("Tinify endpoint 必须使用 HTTPS；HTTP 只允许本地假服务测试")


def _authorization(api_key: str) -> str:
    return "Basic " + base64.b64encode(("api:" + api_key).encode("utf-8")).decode("ascii")


def _request(request: urllib.request.Request, *, timeout: float) -> tuple[int, dict[str, str], bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, dict(exc.headers.items()), exc.read()
        finally:
            exc.close()
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as exc:
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 网络请求结果未知；为避免重复计费，未自动重试") from exc


def _error(status: int, body: bytes) -> TinifyError:
    try:
        parsed = json.loads(body.decode("utf-8"))
        error_type = str(parsed.get("error") or "") if isinstance(parsed, dict) else ""
        message = str(parsed.get("message") or "") if isinstance(parsed, dict) else ""
    except (UnicodeError, json.JSONDecodeError):
        error_type = ""
        message = ""
    lowered = (error_type + " " + message).lower()
    if status in {401, 403} or "credential" in lowered or "invalid api" in lowered:
        return TinifyError("AUTHENTICATION_FAILED", "Tinify 认证失败；请打开配置文件检查 API Key")
    if status == 429 and any(token in lowered for token in ("compression limit", "monthly limit", "quota", "account has reached")):
        return TinifyError("QUOTA_EXHAUSTED", "Tinify 明确返回本月压缩额度不足")
    if status == 429 or "rate limit" in lowered:
        return TinifyError("RATE_LIMITED", "Tinify 返回限流；未自动重试，也未切换本地方案")
    if status >= 500:
        return TinifyError("API_RESULT_UNKNOWN", "Tinify 返回未知服务响应；为避免重复计费，未自动重试")
    return TinifyError("API_REQUEST_FAILED", f"Tinify 请求失败（HTTP {status}）；未自动重试")


def _header(headers: dict[str, str], name: str) -> str | None:
    return next((value for key, value in headers.items() if key.lower() == name.lower()), None)


def shrink_one(
    *, source: Path, output: Path, api_key: str, endpoint: str = DEFAULT_ENDPOINT,
    timeout: float = 30, credential_source: str = "user-config-file",
    allow_http_localhost: bool = False, extra_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not isinstance(api_key, str) or not api_key:
        raise ValueError("Tinify API Key 不可用")
    extras = extra_operation or {}
    forbidden = sorted(FORBIDDEN_SHRINK_PARAMETERS & set(extras))
    if forbidden:
        raise ValueError("默认 shrink 不得混入 resize、convert、metadata 或 quality；请建立独立候选并单独授权")
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    if not source.is_file():
        raise ValueError("Tinify 输入图片不存在")
    base = _safe_endpoint(endpoint, allow_http_localhost=allow_http_localhost)
    before = probe_image(source)
    auth = _authorization(api_key)
    request = urllib.request.Request(
        base + "/shrink", data=source.read_bytes(), method="POST",
        headers={"Authorization": auth, "Content-Type": "application/octet-stream", "User-Agent": "build-verified-playable-packages/tinify"},
    )
    status, headers, body = _request(request, timeout=timeout)
    if status not in {200, 201}:
        raise _error(status, body)
    try:
        response = json.loads(body.decode("utf-8"))
        download_url = str((response.get("output") or {}).get("url") or "")
    except (UnicodeError, json.JSONDecodeError, AttributeError) as exc:
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 成功响应无法解析；为避免重复计费，未自动重试") from exc
    parsed_download = urllib.parse.urlparse(download_url)
    parsed_base = urllib.parse.urlparse(base)
    if not download_url or parsed_download.scheme not in {"https", "http"}:
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 响应缺少可下载候选；未自动重试")
    if parsed_download.scheme == "http" and not (
        allow_http_localhost and parsed_download.hostname in {"127.0.0.1", "localhost", "::1"}
    ):
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 候选下载地址不是 HTTPS；已停止")
    if parsed_base.scheme == "https" and parsed_download.scheme != "https":
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 候选下载发生不安全降级；已停止")
    download = urllib.request.Request(download_url, method="GET", headers={"Authorization": auth, "User-Agent": "build-verified-playable-packages/tinify"})
    download_status, _download_headers, candidate = _request(download, timeout=timeout)
    if download_status != 200 or not candidate:
        raise TinifyError("API_RESULT_UNKNOWN", "Tinify 候选下载失败；为避免重复上传，未自动重试")
    output.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".tinify-", suffix=source.suffix, dir=output.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(candidate)
        after = probe_image(temporary)
        blockers = []
        if after.get("format") != before.get("format"):
            blockers.append("format")
        if (after.get("widthPx"), after.get("heightPx")) != (before.get("widthPx"), before.get("heightPx")):
            blockers.append("dimensions")
        if after.get("alphaCapable") != before.get("alphaCapable"):
            blockers.append("alpha")
        if after.get("orientation") != before.get("orientation"):
            blockers.append("orientation")
        if temporary.stat().st_size >= source.stat().st_size:
            blockers.append("positive-byte-benefit")
        if blockers:
            raise TinifyError("CANDIDATE_FIDELITY_REJECTED", "Tinify 候选未保持默认 shrink 契约或没有正向 bytes 收益：" + ", ".join(blockers))
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    compression = _header(headers, "Compression-Count")
    return {
        "schemaVersion": "playable-tinify-receipt-v1", "generatedAt": utc_now(),
        "action": "TINIFY_SHRINK", "provider": "tinify",
        "sourceSha256": sha256_file(source), "candidateSha256": sha256_file(output),
        "input": {"bytes": source.stat().st_size, **before},
        "output": {"bytes": output.stat().st_size, **probe_image(output)},
        "savedBytes": source.stat().st_size - output.stat().st_size,
        "api": {
            "operation": "shrink", "requestCount": 1,
            "compressionCount": int(compression) if isinstance(compression, str) and compression.isdigit() else None,
            "httpStatus": status, "resizeUsed": False, "conversionUsed": False, "metadataUsed": False,
        },
        "credential": {"source": credential_source, "keyAvailable": True, "secretCopiedToEvidence": False},
        "decision": "pending_user_visual_review",
        "runtimeCompatibility": {"formatSupported": True, "decodeSucceeded": True},
    }


def _successful_by_sha(report: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    result = {}
    for item in (report or {}).get("items") or []:
        if not isinstance(item, dict) or item.get("status") not in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}:
            continue
        receipt = item.get("receipt") or {}
        source_sha = receipt.get("sourceSha256")
        if isinstance(source_sha, str):
            result[source_sha] = item
    return result


def batch_items_from_plan(plan: dict[str, Any], project_root: Path) -> list[dict[str, Any]]:
    resolved_root = project_root.expanduser().resolve()
    items = []
    for item in plan.get("items") or []:
        if not isinstance(item, dict) or item.get("action") != "TINIFY_SHRINK":
            continue
        relative = str(item.get("path") or "")
        source = (resolved_root / relative).resolve()
        try:
            source.relative_to(resolved_root)
        except ValueError as exc:
            raise ValueError(f"Tinify 输入超出当前项目：{item.get('actionId')}") from exc
        if not source.is_file() or item.get("currentSha256") != sha256_file(source) or item.get("currentBytes") != source.stat().st_size:
            raise ValueError(f"Tinify Gate A 输入已漂移：{item.get('actionId')}")
        audit = item.get("opportunityAudit") or {}
        items.append({
            "actionId": item.get("actionId"), "path": relative, "source": str(source),
            "outputPath": relative, "action": "TINIFY_SHRINK",
            "parameters": item.get("parameters") or {},
            "riskFeatures": audit.get("riskFeatures") or [],
            "pixelSensitive": audit.get("pixelSensitive") is True,
        })
    return items


def execute_batch(
    items: list[dict[str, Any]], approval: dict[str, Any], candidate_root: Path,
    api_key: str, endpoint: str = DEFAULT_ENDPOINT, *, allow_http_localhost: bool = False,
    credential_source: str = "user-config-file", resume_report: dict[str, Any] | None = None,
) -> dict[str, Any]:
    authorization = approval.get("tinifyAuthorization") or {}
    if approval.get("status") != "RESOURCE_TRIAL_APPROVED" or authorization.get("externalUploadAuthorized") is not True:
        raise ValueError("Gate A 尚未记录 Tinify 外部上传授权")
    if authorization.get("service") != "Tinify Developer API" or authorization.get("operation") != "shrink":
        raise ValueError("Gate A Tinify 服务或默认 shrink 动作无效")
    approved = authorization.get("approvedActionIds") or []
    approved_high_risk = set(authorization.get("approvedHighRiskActionIds") or [])
    if not isinstance(approved, list) or int(authorization.get("estimatedRequestCount") or -1) != len(approved):
        raise ValueError("Gate A Tinify allowlist 或预计额度无效")
    by_id = {str(item.get("actionId")): item for item in items}
    if list(by_id) != approved or len(by_id) != len(items):
        raise ValueError("Tinify 批次必须严格按 Gate A allowlist 顺序执行")
    for action_id, item in by_id.items():
        risks = {str(value).upper() for value in item.get("riskFeatures") or []}
        if risks & PIXEL_SENSITIVE and action_id not in approved_high_risk:
            raise ValueError(f"像素敏感/高风险图片缺少 Gate A 单项明确确认：{action_id}")
        parameters = item.get("parameters") or {}
        if item.get("action") != "TINIFY_SHRINK" or parameters.get("operation") != "shrink":
            raise ValueError(f"Tinify allowlist 中存在非默认 shrink 动作：{action_id}")
        if FORBIDDEN_SHRINK_PARAMETERS & set(parameters):
            raise ValueError(f"默认 shrink 夹带了必须独立授权的参数：{action_id}")
    candidate_root = candidate_root.expanduser().resolve()
    candidate_root.mkdir(parents=True, exist_ok=True)
    prior = _successful_by_sha(resume_report)
    records: list[dict[str, Any]] = []
    overall = "PASS"
    remaining: list[str] = []
    fallback_required = False
    for index, action_id in enumerate(approved):
        item = by_id[action_id]
        source = Path(str(item.get("source") or "")).expanduser().resolve()
        source_sha = sha256_file(source)
        target = (candidate_root / str(item.get("outputPath") or item.get("path") or "")).resolve()
        try:
            target.relative_to(candidate_root)
        except ValueError as exc:
            raise ValueError(f"Tinify 候选输出超出 candidateRoot：{action_id}") from exc
        existing = prior.get(source_sha)
        existing_receipt = (existing or {}).get("receipt") or {}
        if existing and target.is_file() and existing_receipt.get("candidateSha256") == sha256_file(target):
            records.append({"actionId": action_id, "path": item.get("path"), "status": "REUSED_SUCCESS_RECEIPT", "receipt": existing_receipt})
            continue
        try:
            receipt = shrink_one(
                source=source, output=target, api_key=api_key, endpoint=endpoint,
                credential_source=credential_source, allow_http_localhost=allow_http_localhost,
            )
            records.append({"actionId": action_id, "path": item.get("path"), "status": "SUCCESS", "receipt": receipt})
        except TinifyError as exc:
            target.unlink(missing_ok=True)
            if exc.code == "QUOTA_EXHAUSTED":
                overall = "QUOTA_EXHAUSTED"
                fallback_required = True
                remaining = approved[index:]
                records.extend({"actionId": value, "path": by_id[value].get("path"), "status": "NOT_TESTED_QUOTA"} for value in remaining)
            else:
                overall = exc.code
                remaining = approved[index:]
                records.append({"actionId": action_id, "path": item.get("path"), "status": exc.code, "message": str(exc)})
                records.extend({"actionId": value, "path": by_id[value].get("path"), "status": "NOT_TESTED_PAUSED"} for value in approved[index + 1:])
            break
    return {
        "schemaVersion": "playable-tinify-batch-report-v1", "generatedAt": utc_now(),
        "provider": "tinify", "operation": "shrink", "status": overall,
        "items": records, "completedActionIds": [item["actionId"] for item in records if item["status"] in {"SUCCESS", "REUSED_SUCCESS_RECEIPT"}],
        "remainingActionIds": remaining, "localFallbackDecisionRequired": fallback_required,
        "credential": {"source": credential_source, "keyAvailable": True, "secretCopiedToEvidence": False},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="按 Gate A allowlist 顺序生成 Tinify shrink 图片候选")
    parser.add_argument("--batch", type=Path, help="测试或兼容入口；标准流程使用 --plan-json 和 --project-root")
    parser.add_argument("--plan-json", type=Path)
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--approval", required=True, type=Path)
    parser.add_argument("--candidate-root", required=True, type=Path)
    parser.add_argument("--resume-report", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help=argparse.SUPPRESS)
    parser.add_argument("--allow-http-localhost", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.plan_json:
            if args.project_root is None:
                raise ValueError("使用 --plan-json 时必须提供 --project-root")
            plan = load_json(args.plan_json.expanduser().resolve())
            if not isinstance(plan, dict) or plan.get("schemaVersion") != "playable-resource-optimization-plan-v1":
                raise ValueError("Tinify 资源优化计划无效")
            core = {key: value for key, value in plan.items() if key not in {"generatedAt", "optimizationPlanHash"}}
            from resource_common import sha256_object
            if plan.get("optimizationPlanHash") != "sha256:" + sha256_object(core):
                raise ValueError("Tinify 资源优化计划哈希无效")
            batch = {"items": batch_items_from_plan(plan, args.project_root)}
        elif args.batch:
            batch = load_json(args.batch.expanduser().resolve())
        else:
            raise ValueError("必须提供 --plan-json 或 --batch")
        approval = load_json(args.approval.expanduser().resolve())
        resume = load_json(args.resume_report.expanduser().resolve()) if args.resume_report else None
        if not isinstance(batch, dict) or not isinstance(batch.get("items"), list) or not isinstance(approval, dict):
            raise ValueError("Tinify 批次或 Gate A 批准文件无效")
        api_key, credential = load_api_key()
        report = execute_batch(
            batch["items"], approval, args.candidate_root, api_key, args.endpoint,
            allow_http_localhost=args.allow_http_localhost,
            credential_source=credential["keySource"], resume_report=resume if isinstance(resume, dict) else None,
        )
        write_json_atomic(args.output, report)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        report = {"ok": False, "error": str(exc)}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": report["status"] == "PASS", "status": report["status"],
        "completed": report["completedActionIds"], "remaining": report["remainingActionIds"],
        "output": str(args.output.expanduser().resolve()),
    }, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
