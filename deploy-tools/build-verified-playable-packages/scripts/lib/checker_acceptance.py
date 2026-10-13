from __future__ import annotations

import hashlib
import json
import re
import struct
import zlib
from pathlib import Path
from typing import Any

from artifact import load_artifact
from resource_common import load_json, sha256_file


SCHEMA = "playable-ad-checker-acceptance-v2"
OBSERVATION_SCHEMA = "playable-ad-checker-observations-v2"
OBSERVATION_ITEM_SCHEMA = "playable-checker-observation-v2"
EXTERNAL_PROVENANCE_SCHEMA = "playable-checker-external-browser-provenance-v1"
EXTERNAL_CAPTURE_SCHEMA = "playable-checker-cdp-capture-v1"
EXTERNAL_COLLECTOR_VERSION = "checker-browser-cdp-collector@2"
PASSING_SUMMARIES = {"PASS"}
PLATFORM_CONCLUSIONS = {
    "PASS",
    "WARNING",
    "FAIL",
    "UNAVAILABLE",
    "OBSERVATION_RETRY",
    "NOT_RUN",
}
NODE_STATUSES = {"PASS", "WARNING", "FAIL"}
FORBIDDEN_DECLARATIONS = {
    "static",
    "runtime",
    "warningDetails",
    "acceptedNotice",
    "acceptedNotices",
    "ctaCaptured",
    "lifecycleCaptured",
}
BRIDGE_REQUIREMENTS = {
    "applovin": ("mraid", "open"),
    "unityads": ("mraid", "open"),
    "google-ads": ("exitapi", "exit"),
    "meta": ("fbplayablead", "onctaclick"),
    "moloco": ("fbplayablead", "onctaclick"),
    "mintegral": ("window", "install"),
    "tiktok": ("window", "openappstore"),
}


class CheckerAcceptanceError(ValueError):
    pass


def _normalize_canonical_numbers(value: object) -> object:
    if isinstance(value, dict):
        return {key: _normalize_canonical_numbers(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_canonical_numbers(item) for item in value]
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def canonical_hash(value: object) -> str:
    payload = json.dumps(
        _normalize_canonical_numbers(value),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def file_ref(path: Path) -> dict[str, Any]:
    resolved = path.expanduser().resolve()
    if not resolved.is_file():
        raise CheckerAcceptanceError(f"证据文件不存在：{resolved}")
    return {
        "path": str(resolved),
        "bytes": resolved.stat().st_size,
        "sha256": sha256_file(resolved),
    }


def verify_file_ref(reference: object, label: str) -> Path:
    if not isinstance(reference, dict):
        raise CheckerAcceptanceError(f"{label} 缺少文件引用")
    path = Path(str(reference.get("path") or "")).expanduser().resolve()
    if (
        not path.is_file()
        or reference.get("bytes") != path.stat().st_size
        or reference.get("sha256") != sha256_file(path)
    ):
        raise CheckerAcceptanceError(f"{label} 不存在或已变化：{path}")
    return path


def normalize_file_reference(value: object, label: str) -> dict[str, Any]:
    if isinstance(value, str):
        return file_ref(Path(value))
    path = verify_file_ref(value, label)
    return file_ref(path)


def paeth(left: int, above: int, upper_left: int) -> int:
    estimate = left + above - upper_left
    left_distance = abs(estimate - left)
    above_distance = abs(estimate - above)
    upper_left_distance = abs(estimate - upper_left)
    if left_distance <= above_distance and left_distance <= upper_left_distance:
        return left
    if above_distance <= upper_left_distance:
        return above
    return upper_left


def png_pixels(path: Path) -> tuple[int, int, list[tuple[int, int, int, int]]]:
    payload = path.read_bytes()
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise CheckerAcceptanceError("Checker 最终截图必须是可解码的 PNG，不能只改扩展名")
    offset = 8
    width = height = bit_depth = color_type = interlace = None
    compressed = bytearray()
    palette: list[tuple[int, int, int, int]] = []
    transparency = b""
    while offset + 12 <= len(payload):
        length = struct.unpack(">I", payload[offset:offset + 4])[0]
        kind = payload[offset + 4:offset + 8]
        content_start = offset + 8
        content_end = content_start + length
        if content_end + 4 > len(payload):
            raise CheckerAcceptanceError("Checker PNG chunk 已截断")
        content = payload[content_start:content_end]
        expected_crc = struct.unpack(">I", payload[content_end:content_end + 4])[0]
        if (zlib.crc32(kind + content) & 0xFFFFFFFF) != expected_crc:
            raise CheckerAcceptanceError("Checker PNG chunk CRC 无效")
        if kind == b"IHDR":
            if len(content) != 13:
                raise CheckerAcceptanceError("Checker PNG IHDR 无效")
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", content)
        elif kind == b"PLTE":
            if len(content) % 3:
                raise CheckerAcceptanceError("Checker PNG palette 无效")
            palette = [
                (content[index], content[index + 1], content[index + 2], 255)
                for index in range(0, len(content), 3)
            ]
        elif kind == b"tRNS":
            transparency = content
        elif kind == b"IDAT":
            compressed.extend(content)
        elif kind == b"IEND":
            break
        offset = content_end + 4
    if not all(isinstance(item, int) and item > 0 for item in (width, height)):
        raise CheckerAcceptanceError("Checker PNG 缺少有效尺寸")
    if bit_depth != 8 or interlace != 0 or color_type not in {0, 2, 3, 4, 6}:
        raise CheckerAcceptanceError("Checker PNG 必须为非隔行 8-bit 灰度、RGB、索引或 RGBA")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[int(color_type)]
    row_bytes = int(width) * channels
    try:
        raw = zlib.decompress(bytes(compressed))
    except zlib.error as exc:
        raise CheckerAcceptanceError("Checker PNG 像素数据无法解压") from exc
    if len(raw) != int(height) * (row_bytes + 1):
        raise CheckerAcceptanceError("Checker PNG 像素数据长度与尺寸不一致")
    rows: list[bytes] = []
    cursor = 0
    for _ in range(int(height)):
        filter_type = raw[cursor]
        encoded = raw[cursor + 1:cursor + 1 + row_bytes]
        cursor += row_bytes + 1
        previous = rows[-1] if rows else bytes(row_bytes)
        decoded = bytearray(row_bytes)
        for index, value in enumerate(encoded):
            left = decoded[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                result = value
            elif filter_type == 1:
                result = value + left
            elif filter_type == 2:
                result = value + above
            elif filter_type == 3:
                result = value + ((left + above) // 2)
            elif filter_type == 4:
                result = value + paeth(left, above, upper_left)
            else:
                raise CheckerAcceptanceError("Checker PNG 使用了未知像素过滤器")
            decoded[index] = result & 0xFF
        rows.append(bytes(decoded))
    pixels: list[tuple[int, int, int, int]] = []
    for row in rows:
        for index in range(0, len(row), channels):
            values = row[index:index + channels]
            if color_type == 0:
                pixels.append((values[0], values[0], values[0], 255))
            elif color_type == 2:
                pixels.append((values[0], values[1], values[2], 255))
            elif color_type == 3:
                palette_index = values[0]
                if palette_index >= len(palette):
                    raise CheckerAcceptanceError("Checker PNG palette 索引越界")
                red, green, blue, _ = palette[palette_index]
                alpha = transparency[palette_index] if palette_index < len(transparency) else 255
                pixels.append((red, green, blue, alpha))
            elif color_type == 4:
                pixels.append((values[0], values[0], values[0], values[1]))
            else:
                pixels.append((values[0], values[1], values[2], values[3]))
    return int(width), int(height), pixels


def validate_screenshot(reference: object, label: str) -> dict[str, Any]:
    normalized = normalize_file_reference(reference, label)
    path = Path(normalized["path"])
    width, height, pixels = png_pixels(path)
    if width < 8 or height < 8:
        raise CheckerAcceptanceError(f"{label} 尺寸过小，无法包含当前页签与结果区域")
    visible = [pixel for pixel in pixels if pixel[3] > 8]
    unique = set(visible)
    if not visible or len(unique) <= 1:
        raise CheckerAcceptanceError(f"{label} 是空白或纯色截图")
    if all(red >= 248 and green >= 248 and blue >= 248 for red, green, blue, _ in visible):
        raise CheckerAcceptanceError(f"{label} 是空白或近纯白截图")
    declared_width = reference.get("width") if isinstance(reference, dict) else None
    declared_height = reference.get("height") if isinstance(reference, dict) else None
    if declared_width is not None and declared_width != width:
        raise CheckerAcceptanceError(f"{label} 声明宽度与实际 PNG 不一致")
    if declared_height is not None and declared_height != height:
        raise CheckerAcceptanceError(f"{label} 声明高度与实际 PNG 不一致")
    return {
        **normalized,
        "width": width,
        "height": height,
        "uniqueColorCount": len(unique),
        "contentCheck": "NON_BLANK_NON_SOLID",
    }


def number(value: object, label: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise CheckerAcceptanceError(f"{label} 必须是数字")
    return float(value)


def validate_rects(value: object, *, available: bool) -> dict[str, dict[str, float]]:
    if not isinstance(value, dict):
        raise CheckerAcceptanceError("Checker 观察缺少可见区域坐标")
    required = ["viewport", "activeTab"]
    if available:
        required.extend(["currentFile", "staticResults", "runtimeResults"])
    normalized: dict[str, dict[str, float]] = {}
    for name in required:
        item = value.get(name)
        if not isinstance(item, dict):
            raise CheckerAcceptanceError(f"Checker 观察缺少 {name} 可见区域")
        rect = {field: number(item.get(field), f"visibleRects.{name}.{field}") for field in ("x", "y", "width", "height")}
        if rect["width"] <= 0 or rect["height"] <= 0:
            raise CheckerAcceptanceError(f"visibleRects.{name} 必须可见且面积大于 0")
        normalized[name] = rect
    viewport = normalized["viewport"]
    for name, rect in normalized.items():
        if name == "viewport":
            continue
        if (
            rect["x"] < viewport["x"]
            or rect["y"] < viewport["y"]
            or rect["x"] + rect["width"] > viewport["x"] + viewport["width"]
            or rect["y"] + rect["height"] > viewport["y"] + viewport["height"]
        ):
            raise CheckerAcceptanceError(f"visibleRects.{name} 不在当前 viewport 内")
    return normalized


def normalize_nodes(value: object, label: str, *, required: bool = True) -> list[dict[str, str]]:
    if not isinstance(value, list) or (required and not value):
        raise CheckerAcceptanceError(f"{label} 必须是非空结果节点数组")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise CheckerAcceptanceError(f"{label}[{index}] 必须是对象")
        node_id = str(item.get("id") or "").strip()
        status = str(item.get("status") or "").strip().upper()
        message = str(item.get("message") or "").strip()
        if not node_id or node_id in seen or status not in NODE_STATUSES or not message:
            raise CheckerAcceptanceError(f"{label}[{index}] 缺少唯一 id、合法 status 或页面原文")
        seen.add(node_id)
        result.append({"id": node_id, "status": status, "message": message})
    return result


def counts(nodes: list[dict[str, str]]) -> dict[str, int]:
    return {
        "total": len(nodes),
        "passed": sum(item["status"] == "PASS" for item in nodes),
        "warnings": sum(item["status"] == "WARNING" for item in nodes),
        "failures": sum(item["status"] == "FAIL" for item in nodes),
    }


def normalized_calls(value: object, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CheckerAcceptanceError(f"{label} 必须是数组")
    result = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise CheckerAcceptanceError(f"{label}[{index}] 必须是对象")
        method = str(item.get("method") or "").strip()
        at_ms = number(item.get("atMs"), f"{label}[{index}].atMs")
        if not method:
            raise CheckerAcceptanceError(f"{label}[{index}] 缺少 method")
        normalized = {"method": method, "atMs": at_ms}
        if item.get("bridge") is not None:
            bridge = str(item.get("bridge") or "").strip()
            if not bridge:
                raise CheckerAcceptanceError(f"{label}[{index}].bridge 不能为空")
            normalized["bridge"] = bridge
        result.append(normalized)
    return result


def trusted_inputs(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise CheckerAcceptanceError("inputEvents 必须是数组")
    result = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise CheckerAcceptanceError(f"inputEvents[{index}] 必须是对象")
        event_type = str(item.get("type") or "").strip().lower()
        target = str(item.get("target") or "").strip()
        at_ms = number(item.get("atMs"), f"inputEvents[{index}].atMs")
        if event_type not in {"pointerdown", "pointerup", "click", "touchstart", "touchend"} or not target:
            raise CheckerAcceptanceError(f"inputEvents[{index}] 不是可验证的 pointer/touch CTA 输入")
        result.append({"type": event_type, "isTrusted": item.get("isTrusted") is True, "target": target, "atMs": at_ms})
    return result


def matching_cta_capture(platform: str, calls: list[dict[str, Any]], inputs: list[dict[str, Any]]) -> bool:
    expected = BRIDGE_REQUIREMENTS.get(platform)
    if expected is None:
        return False
    expected_bridge, expected_method = expected
    trusted_times = [item["atMs"] for item in inputs if item["isTrusted"]]
    if not trusted_times:
        return False
    for call in calls:
        bridge = str(call.get("bridge") or "").replace(".", "").lower()
        method = str(call.get("method") or "").lower()
        if bridge == expected_bridge and method == expected_method and any(at_ms <= call["atMs"] for at_ms in trusted_times):
            return True
    return False


def lifecycle_capture(nodes: list[dict[str, str]], calls: list[dict[str, Any]]) -> bool:
    r5 = next((item for item in nodes if item["id"].upper() == "R5"), None)
    if r5 is None or r5["status"] != "PASS":
        return False
    required = ["gameReady", "gameStart", "gameEnd"]
    positions: list[tuple[int, float]] = []
    cursor = 0
    for index, item in enumerate(calls):
        if cursor < len(required) and item["method"] == required[cursor]:
            positions.append((index, item["atMs"]))
            cursor += 1
    return cursor == len(required) and all(
        positions[index][1] <= positions[index + 1][1]
        for index in range(len(positions) - 1)
    )


def artifact_store_notice(manifest: dict[str, Any], warning_nodes: list[dict[str, str]]) -> list[dict[str, Any]]:
    if len(warning_nodes) != 1 or warning_nodes[0]["id"] != "COMMON-STA-004":
        return []
    if str((manifest.get("deliveryContext") or {}).get("targetOs") or "") != "android":
        return []
    artifact_path = Path(str((manifest.get("artifact") or {}).get("path") or "")).expanduser().resolve()
    text = load_artifact(str(artifact_path)).combined_text
    google_urls = sorted(set(re.findall(r"https://play\.google\.com/[^\s'\"<>`\\]+", text, re.IGNORECASE)))
    apple_urls = re.findall(r"https://(?:apps|itunes)\.apple\.com/[^\s'\"<>`\\]+", text, re.IGNORECASE)
    if not google_urls or apple_urls:
        return []
    return [{
        "id": "COMMON-STA-004",
        "message": warning_nodes[0]["message"],
        "targetOs": "android",
        "googlePlayUrl": google_urls[0],
        "reason": "当前 artifact 与候选清单共同验签的 Android 单端缺 iOS 商店链接 notice",
    }]


def manifest_artifact(manifest: dict[str, Any]) -> dict[str, Any]:
    artifact = manifest.get("artifact") or {}
    return {
        "path": artifact.get("path"),
        "bytes": artifact.get("size") if artifact.get("size") is not None else artifact.get("bytes"),
        "sha256": artifact.get("sha256"),
    }


def observation_content_hash(observation: dict[str, Any]) -> str:
    """Hash the observation facts without its provenance envelope."""

    payload = dict(observation)
    payload.pop("externalProvenance", None)
    payload.pop("externalProvenanceFile", None)
    payload.pop("derived", None)
    screenshot = payload.get("screenshot")
    if isinstance(screenshot, dict):
        payload["screenshot"] = {
            field: screenshot.get(field)
            for field in ("path", "bytes", "sha256")
        }
    return canonical_hash(payload)


def validate_external_browser_provenance(
    provenance: object,
    observation: dict[str, Any],
    manifest: dict[str, Any],
    *,
    expected_attempt_id: str | None = None,
) -> dict[str, Any]:
    """Validate a fixed-CDP collector receipt.

    The receipt is intentionally not a conclusion field.  It must be an
    immutable output of the shared collector, bind the exact attempt/artifact
    and observation digest, and carry a CDP target/session plus a real PNG
    capture.  ``isTrusted``/visibleText/bridgeCalls remain inputs to the
    derived checker semantics and can never create this provenance.
    """

    if not isinstance(provenance, dict) or set(provenance) != {
        "schemaVersion", "collectorVersion", "status", "attemptId", "checkerUrl",
        "platform", "deliveryKey", "artifact", "observationSha256", "capture",
    }:
        raise CheckerAcceptanceError("缺少不可自签的 external browser provenance envelope")
    if provenance.get("schemaVersion") != EXTERNAL_PROVENANCE_SCHEMA:
        raise CheckerAcceptanceError("external browser provenance schemaVersion 无效")
    if provenance.get("collectorVersion") != EXTERNAL_COLLECTOR_VERSION:
        raise CheckerAcceptanceError("external browser provenance 必须来自固定 CDP collector")
    platform = str(manifest.get("platform") or "")
    delivery_key = str(manifest.get("deliveryKey") or "")
    if (
        provenance.get("status") != "verified"
        or provenance.get("attemptId") != observation.get("attemptId")
        or (expected_attempt_id is not None and provenance.get("attemptId") != expected_attempt_id)
        or provenance.get("checkerUrl") != observation.get("checkerUrl")
        or provenance.get("platform") != platform
        or provenance.get("deliveryKey") != delivery_key
        or provenance.get("artifact") != manifest_artifact(manifest)
    ):
        raise CheckerAcceptanceError("external browser provenance 未绑定当前 Checker/平台/attempt/artifact")
    capture = provenance.get("capture")
    observation_for_hash = dict(observation)
    if isinstance(capture, dict) and isinstance(capture.get("screenshot"), dict):
        observation_for_hash["screenshot"] = capture["screenshot"]
    if provenance.get("observationSha256") != observation_content_hash(observation_for_hash):
        raise CheckerAcceptanceError("external browser provenance 与 observation canonical hash 不一致")
    if not isinstance(capture, dict) or set(capture) != {
        "schemaVersion", "captureId", "capturedAt", "checkerUrl", "platform", "deliveryKey",
        "attemptId", "artifact", "browser", "page", "resultNodes", "screenshot", "runner",
    }:
        raise CheckerAcceptanceError("external browser provenance 缺少固定 collector capture")
    if capture.get("schemaVersion") != EXTERNAL_CAPTURE_SCHEMA or not str(capture.get("captureId") or ""):
        raise CheckerAcceptanceError("external browser capture schema/captureId 无效")
    if (
        capture.get("checkerUrl") != observation.get("checkerUrl")
        or capture.get("platform") != platform
        or capture.get("deliveryKey") != delivery_key
        or capture.get("attemptId") != observation.get("attemptId")
        or capture.get("artifact") != manifest_artifact(manifest)
    ):
        raise CheckerAcceptanceError("external browser capture 未绑定当前页面与 exact artifact")
    browser = capture.get("browser")
    if not isinstance(browser, dict) or not all(
        isinstance(browser.get(field), str) and browser.get(field)
        for field in ("product", "protocolVersion", "targetId", "sessionId")
    ):
        raise CheckerAcceptanceError("external browser capture 缺少 CDP browser/target/session identity")
    if browser.get("product", "").lower().find("chrome") < 0:
        raise CheckerAcceptanceError("external browser capture 必须来自 Chrome CDP")
    page = capture.get("page")
    if not isinstance(page, dict) or page.get("url") != observation.get("checkerUrl"):
        raise CheckerAcceptanceError("external browser capture page URL 与 Checker 不一致")
    result_nodes = capture.get("resultNodes")
    expected_result_nodes = [
        (group, item)
        for group, values in (
            ("static", observation.get("staticNodes")),
            ("runtime", observation.get("runtimeNodes")),
        )
        for item in (values if isinstance(values, list) else [])
        if isinstance(item, dict)
    ]
    if not isinstance(result_nodes, list) or len(result_nodes) != len(expected_result_nodes):
        raise CheckerAcceptanceError("external browser capture 未覆盖 current Checker 全部结果节点")
    for index, ((expected_group, expected), captured) in enumerate(
        zip(expected_result_nodes, result_nodes, strict=True)
    ):
        if not isinstance(captured, dict) or set(captured) != {
            "group", "id", "status", "text", "rect",
        }:
            raise CheckerAcceptanceError(f"external browser resultNodes[{index}] 不是固定 DOM 测量")
        if (
            captured.get("group") != expected_group
            or captured.get("id") != expected.get("id")
            or captured.get("status") != expected.get("status")
            or str(expected.get("message") or "").strip() not in str(captured.get("text") or "")
        ):
            raise CheckerAcceptanceError(f"external browser resultNodes[{index}] 与 observation 不一致")
        rect = captured.get("rect")
        if not isinstance(rect, dict) or any(
            not isinstance(rect.get(field), (int, float)) or isinstance(rect.get(field), bool)
            for field in ("x", "y", "width", "height")
        ) or rect.get("width", 0) <= 0 or rect.get("height", 0) <= 0:
            raise CheckerAcceptanceError(f"external browser resultNodes[{index}] 不可见")
    screenshot = validate_screenshot(capture.get("screenshot"), "external browser capture screenshot")
    if screenshot["sha256"] != str((observation.get("screenshot") or {}).get("sha256") or ""):
        raise CheckerAcceptanceError("external browser capture screenshot 未绑定当前 observation")
    runner = capture.get("runner")
    if not isinstance(runner, dict) or runner.get("version") != EXTERNAL_COLLECTOR_VERSION:
        raise CheckerAcceptanceError("external browser capture 缺少固定 runner receipt")
    if runner.get("externalBrowserUsed") is not True or not str(runner.get("replayNonce") or ""):
        raise CheckerAcceptanceError("external browser provenance 不是固定 runner 产生的真实浏览器 receipt")
    return {
        "schemaVersion": EXTERNAL_PROVENANCE_SCHEMA,
        "collectorVersion": EXTERNAL_COLLECTOR_VERSION,
        "status": "verified",
        "attemptId": observation["attemptId"],
        "checkerUrl": observation["checkerUrl"],
        "platform": platform,
        "deliveryKey": delivery_key,
        "artifact": manifest_artifact(manifest),
        "observationSha256": observation_content_hash(observation_for_hash),
        "capture": capture,
    }


def validate_observation(
    observation: object,
    manifest: dict[str, Any],
    *,
    checker_url: str,
    expected_attempt_id: str | None = None,
    forbidden_screenshot_hashes: set[str] | None = None,
    require_external_provenance: bool = False,
) -> dict[str, Any]:
    if not isinstance(observation, dict) or observation.get("schemaVersion") != OBSERVATION_ITEM_SCHEMA:
        raise CheckerAcceptanceError(f"单平台观察 schemaVersion 必须为 {OBSERVATION_ITEM_SCHEMA}")
    forbidden = sorted(FORBIDDEN_DECLARATIONS & set(observation))
    if forbidden:
        raise CheckerAcceptanceError("结构化观察禁止调用方声明结论字段：" + ", ".join(forbidden))
    platform = str(manifest.get("platform") or "")
    delivery_key = str(manifest.get("deliveryKey") or "")
    attempt_id = str(observation.get("attemptId") or "").strip()
    if not attempt_id or (expected_attempt_id is not None and attempt_id != expected_attempt_id):
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation 未绑定当前 attemptId")
    if (
        observation.get("platform") != platform
        or observation.get("deliveryKey") != delivery_key
        or str(observation.get("checkerUrl") or "").rstrip("/") != checker_url.rstrip("/")
    ):
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation 未绑定当前 Checker、平台与 deliveryKey")
    if not str(observation.get("capturedAt") or "").strip():
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation 缺少观察时间")
    page_identity = observation.get("pageIdentity")
    if not isinstance(page_identity, dict) or not all(
        str(page_identity.get(name) or "").strip() for name in ("title", "visibleMarker")
    ):
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation 缺少当前 Checker 页面身份")
    visible_text = str(observation.get("visibleText") or "").strip()
    if not visible_text or str(page_identity["visibleMarker"]) not in visible_text:
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} 页面可见摘要未包含 Checker 身份")
    active_tab = observation.get("activeTab")
    if not isinstance(active_tab, dict) or active_tab.get("status") not in {"AVAILABLE", "UNAVAILABLE"}:
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} activeTab.status 无效")
    tab_status = str(active_tab["status"])
    available = tab_status == "AVAILABLE"
    tab_label = str(active_tab.get("label") or "").strip()
    tab_platform = str(active_tab.get("platform") or "").strip()
    if available and (tab_platform != platform or not tab_label or tab_label not in visible_text):
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} active tab 未绑定当前平台可见页签")
    visible_tabs = observation.get("visibleTabs")
    if not isinstance(visible_tabs, list) or not all(isinstance(item, str) and item.strip() for item in visible_tabs):
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} visibleTabs 必须是页面可见页签数组")
    if not available:
        reason = str(active_tab.get("reason") or "").strip()
        if not reason or platform.lower() not in visible_text.lower():
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} 页签不可用时必须记录当前页面可见依据")
    if observation.get("resultsStable") is not True and available:
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} 页面结果节点尚未稳定")
    rects = validate_rects(observation.get("visibleRects"), available=available)
    screenshot = validate_screenshot(observation.get("screenshot"), f"{platform}/{delivery_key} Checker 最终截图")
    if forbidden_screenshot_hashes and screenshot["sha256"] in forbidden_screenshot_hashes:
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} Checker 最终截图与 preflight、其他平台或旧 attempt 重复")
    expected_artifact = manifest_artifact(manifest)
    if observation.get("artifact") != expected_artifact:
        raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation 未绑定 exact artifact")
    external_provenance = observation.get("externalProvenance")
    if require_external_provenance or external_provenance is not None:
        if external_provenance is None:
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} 缺少 external browser provenance")
        provenance_file = observation.get("externalProvenanceFile")
        if not isinstance(provenance_file, dict):
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} 缺少 collector provenance 文件引用")
        provenance_path = verify_file_ref(provenance_file, f"{platform}/{delivery_key} external provenance")
        persisted_provenance = load_json(provenance_path)
        if persisted_provenance != external_provenance:
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} observation provenance 与 collector 文件不一致")
        # Verify against the raw observation before normalization; the
        # canonical hash intentionally excludes this envelope itself.
        external_provenance = validate_external_browser_provenance(
            external_provenance,
            observation,
            manifest,
            expected_attempt_id=expected_attempt_id,
        )
    current_file = observation.get("currentFile")
    if available:
        expected_file = {"name": Path(str(expected_artifact["path"])).name, **expected_artifact}
        if current_file != expected_file or expected_file["name"] not in visible_text:
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} 页面当前文件不是 exact artifact")
    static_nodes = normalize_nodes(observation.get("staticNodes"), f"{platform}.staticNodes", required=available)
    runtime_nodes = normalize_nodes(observation.get("runtimeNodes"), f"{platform}.runtimeNodes", required=available)
    bridge_calls = normalized_calls(observation.get("bridgeCalls"), f"{platform}.bridgeCalls")
    lifecycle_calls = normalized_calls(observation.get("lifecycleCalls"), f"{platform}.lifecycleCalls")
    inputs = trusted_inputs(observation.get("inputEvents") or [])
    for node in static_nodes + runtime_nodes:
        if node["id"] not in visible_text:
            raise CheckerAcceptanceError(f"{platform}/{delivery_key} 页面摘要缺少结果节点 {node['id']}")
    r2 = next((item for item in runtime_nodes if item["id"].upper() == "R2"), None)
    cta_captured = bool(r2 and r2["status"] == "PASS" and matching_cta_capture(platform, bridge_calls, inputs))
    lifecycle_captured = lifecycle_capture(runtime_nodes, lifecycle_calls) if platform == "mintegral" else None
    warning_nodes = [item for item in static_nodes + runtime_nodes if item["status"] == "WARNING"]
    accepted_notices = artifact_store_notice(manifest, warning_nodes)
    static_problem = any(item["status"] in {"WARNING", "FAIL"} for item in static_nodes)
    if accepted_notices and len(warning_nodes) == 1 and not any(item["status"] == "FAIL" for item in static_nodes):
        static_problem = False
    non_capture_runtime_problem = any(
        item["status"] in {"WARNING", "FAIL"} and item["id"].upper() not in {"R2", "R5"}
        for item in runtime_nodes
    )
    if not available:
        classification = "EXTERNAL_CHECKER_BLOCK"
        conclusion = "UNAVAILABLE"
    elif static_problem or non_capture_runtime_problem:
        classification = "ARTIFACT_REWORK"
        conclusion = "FAIL" if any(item["status"] == "FAIL" for item in static_nodes + runtime_nodes) else "WARNING"
    elif r2 is not None and r2["status"] == "FAIL":
        classification = "ARTIFACT_REWORK" if any(item["isTrusted"] for item in inputs) else "OBSERVATION_RETRY"
        conclusion = "FAIL" if classification == "ARTIFACT_REWORK" else "OBSERVATION_RETRY"
    elif r2 is None or not cta_captured:
        classification = "OBSERVATION_RETRY"
        conclusion = "OBSERVATION_RETRY"
    elif platform == "mintegral" and (
        next((item for item in runtime_nodes if item["id"].upper() == "R5"), None) is None
        or not lifecycle_captured
    ):
        r5 = next((item for item in runtime_nodes if item["id"].upper() == "R5"), None)
        classification = "ARTIFACT_REWORK" if r5 and r5["status"] == "FAIL" else "OBSERVATION_RETRY"
        conclusion = "FAIL" if classification == "ARTIFACT_REWORK" else "OBSERVATION_RETRY"
    elif warning_nodes and not accepted_notices:
        classification = "ARTIFACT_REWORK"
        conclusion = "WARNING"
    else:
        classification = "PASS"
        conclusion = "PASS"
    result = {
        "schemaVersion": OBSERVATION_ITEM_SCHEMA,
        "attemptId": attempt_id,
        "capturedAt": observation["capturedAt"],
        "checkerUrl": checker_url,
        "platform": platform,
        "deliveryKey": delivery_key,
        "pageIdentity": dict(page_identity),
        "activeTab": dict(active_tab),
        "visibleTabs": list(visible_tabs),
        "currentFile": dict(current_file) if isinstance(current_file, dict) else None,
        "artifact": expected_artifact,
        "resultsStable": observation.get("resultsStable") is True,
        "staticNodes": static_nodes,
        "runtimeNodes": runtime_nodes,
        "bridgeCalls": bridge_calls,
        "lifecycleCalls": lifecycle_calls,
        "inputEvents": inputs,
        "visibleText": visible_text,
        "visibleRects": rects,
        "screenshot": screenshot,
        "derived": {
            "static": counts(static_nodes),
            "runtime": counts(runtime_nodes),
            "ctaCaptured": cta_captured,
            "lifecycleCaptured": lifecycle_captured,
            "warningDetails": warning_nodes,
            "acceptedNotices": accepted_notices,
            "classification": classification,
            "conclusion": conclusion,
        },
    }
    if external_provenance is not None:
        result["externalProvenance"] = external_provenance
        result["externalProvenanceFile"] = dict(observation["externalProvenanceFile"])
    return result


def count_group(value: object, label: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise CheckerAcceptanceError(f"{label} 缺少计数")
    result: dict[str, int] = {}
    for name in ("total", "passed", "warnings", "failures"):
        item = value.get(name)
        if not isinstance(item, int) or isinstance(item, bool) or item < 0:
            raise CheckerAcceptanceError(f"{label}.{name} 必须是非负整数")
        result[name] = item
    if result["total"] != result["passed"] + result["warnings"] + result["failures"]:
        raise CheckerAcceptanceError(f"{label} 总数与通过、警告、失败之和不一致")
    return result


def platform_conclusion(entry: dict[str, Any]) -> str:
    classification = entry.get("classification")
    if classification == "PASS":
        return "PASS"
    if classification == "EXTERNAL_CHECKER_BLOCK":
        return "UNAVAILABLE"
    if classification == "OBSERVATION_RETRY":
        return "OBSERVATION_RETRY"
    if classification == "ARTIFACT_REWORK":
        static = entry.get("static") or {}
        runtime = entry.get("runtime") or {}
        return "FAIL" if static.get("failures", 0) + runtime.get("failures", 0) else "WARNING"
    return "NOT_RUN"


def summary_conclusion(entries: list[dict[str, Any]], target_count: int) -> str:
    if len(entries) != target_count or any(item.get("conclusion") == "NOT_RUN" for item in entries):
        return "INCOMPLETE"
    if any(item.get("classification") == "ARTIFACT_REWORK" or item.get("conclusion") in {"WARNING", "FAIL"} for item in entries):
        return "REWORK_REQUIRED"
    if any(item.get("classification") == "OBSERVATION_RETRY" or item.get("conclusion") == "OBSERVATION_RETRY" for item in entries):
        return "OBSERVATION_RETRY"
    if any(item.get("classification") == "EXTERNAL_CHECKER_BLOCK" or item.get("conclusion") == "UNAVAILABLE" for item in entries):
        return "BLOCKED_EXTERNAL"
    if entries and all(item.get("conclusion") == "PASS" for item in entries):
        return "PASS"
    return "INCOMPLETE"


def user_platform_conclusion(entry: dict[str, Any]) -> str:
    platform = entry.get("platform")
    conclusion = entry.get("conclusion")
    if conclusion == "PASS":
        if entry.get("acceptedNotices"):
            return f"{platform} 页签除封闭规则验签的 Android 单端商店链接 notice 外均通过"
        return f"{platform} 页签静态与运行时检查均为零 warning 且可信 CTA 已捕获"
    if conclusion == "UNAVAILABLE":
        return f"Checker 当前没有 {platform} 页签；这不是 Checker 通过，但不使本地 ruleset 已通过的候选资格失效"
    if conclusion == "OBSERVATION_RETRY":
        return f"{platform} 当前观察证据不足或相互矛盾；本地候选资格保留，如继续 Checker 必须保持 artifact SHA 并用新 attempt 重录"
    if conclusion == "WARNING":
        return f"{platform} 页签仍有非豁免 warning，必须修复真实生成链并重建"
    if conclusion == "FAIL":
        return f"{platform} 页签存在已确认的 artifact failure，必须修复真实生成链并重建"
    return f"{platform} 页签补充验证尚未完成"


def user_summary(conclusion: str, entries: list[dict[str, Any]]) -> str:
    affected = [str(item.get("platform")) for item in entries if item.get("conclusion") != "PASS"]
    if conclusion == "PASS":
        return "Checker 中所有目标平台页签均存在，且静态、运行时、CTA 与生命周期证据全部通过；该结果仅作为外部补充证据"
    if conclusion == "REWORK_REQUIRED":
        return "Checker 证明 artifact 或生成链仍有问题，必须继续返工并复检：" + "、".join(affected)
    if conclusion == "OBSERVATION_RETRY":
        return "Checker 页面观察证据无效或不完整；本地候选资格保留，如继续 Checker 必须保持 artifact 不变并创建新 attempt：" + "、".join(affected)
    if conclusion == "BLOCKED_EXTERNAL":
        return "Checker 不可覆盖全部目标平台；这不是 Checker 通过，本地候选资格保留并需在后续外部验收中补测：" + "、".join(affected)
    return "Checker 补充验证记录不完整；不得宣称 Checker 通过，本地候选资格由 Skill 内置 ruleset 单独判定"


def acceptance_entry(observation: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    derived = observation["derived"]
    manifest_path = Path(str(manifest.get("manifestPath") or "")).resolve()
    entry = {
        "platform": manifest.get("platform"),
        "deliveryKey": manifest.get("deliveryKey"),
        "deliveryContext": manifest.get("deliveryContext") or {},
        "artifact": manifest_artifact(manifest),
        "candidateManifest": file_ref(manifest_path),
        "attemptId": observation["attemptId"],
        "capturedAt": observation["capturedAt"],
        "tab": {
            "status": observation["activeTab"]["status"],
            "label": observation["activeTab"].get("label"),
            "reason": observation["activeTab"].get("reason"),
        },
        "static": derived["static"],
        "runtime": {
            **derived["runtime"],
            "ctaCaptured": derived["ctaCaptured"],
            "lifecycleCaptured": derived["lifecycleCaptured"],
        },
        "warningDetails": derived["warningDetails"],
        "acceptedNotices": derived["acceptedNotices"],
        "classification": derived["classification"],
        "conclusion": derived["conclusion"],
        "evidence": [observation["screenshot"]],
        "observation": observation,
        "observationSha256": canonical_hash(observation),
    }
    entry["userConclusion"] = user_platform_conclusion(entry)
    return entry


def build_acceptance(observations: dict[str, Any], manifests: list[dict[str, Any]]) -> dict[str, Any]:
    if observations.get("schemaVersion") != OBSERVATION_SCHEMA:
        raise CheckerAcceptanceError(f"观察记录 schemaVersion 必须为 {OBSERVATION_SCHEMA}")
    checker_url = str(observations.get("checkerUrl") or "").strip().rstrip("/")
    if not checker_url:
        raise CheckerAcceptanceError("观察记录缺少 checkerUrl")
    raw_entries = observations.get("platforms")
    if not isinstance(raw_entries, list):
        raise CheckerAcceptanceError("观察记录 platforms 必须是数组")
    observation_map: dict[tuple[str, str], dict[str, Any]] = {}
    for item in raw_entries:
        if not isinstance(item, dict):
            raise CheckerAcceptanceError("观察记录平台项必须是对象")
        key = (str(item.get("platform") or ""), str(item.get("deliveryKey") or ""))
        if not all(key) or key in observation_map:
            raise CheckerAcceptanceError(f"观察记录平台与交付组合缺失或重复：{key}")
        observation_map[key] = item
    preflight_refs = [
        normalize_file_reference(item, f"preflightEvidence[{index}]")
        for index, item in enumerate(observations.get("preflightEvidence") or [])
    ]
    used_screenshot_hashes = {str(item["sha256"]) for item in preflight_refs}
    entries: list[dict[str, Any]] = []
    seen_targets: set[tuple[str, str]] = set()
    for manifest in manifests:
        platform = str(manifest.get("platform") or "")
        delivery_key = str(manifest.get("deliveryKey") or "")
        key = (platform, delivery_key)
        if not all(key) or key in seen_targets:
            raise CheckerAcceptanceError(f"候选清单平台与交付组合缺失或重复：{key}")
        seen_targets.add(key)
        raw = observation_map.pop(key, None)
        if raw is None:
            manifest_path = Path(str(manifest.get("manifestPath") or "")).resolve()
            entry = {
                "platform": platform,
                "deliveryKey": delivery_key,
                "deliveryContext": manifest.get("deliveryContext") or {},
                "artifact": manifest_artifact(manifest),
                "candidateManifest": file_ref(manifest_path),
                "tab": {"status": "UNKNOWN", "label": None, "reason": "本轮没有当前 artifact 的结构化观察"},
                "static": {"total": 0, "passed": 0, "warnings": 0, "failures": 0},
                "runtime": {"total": 0, "passed": 0, "warnings": 0, "failures": 0, "ctaCaptured": False, "lifecycleCaptured": None},
                "warningDetails": [],
                "acceptedNotices": [],
                "classification": "OBSERVATION_RETRY",
                "conclusion": "NOT_RUN",
                "evidence": [],
            }
            entry["userConclusion"] = user_platform_conclusion(entry)
        else:
            normalized = validate_observation(
                raw,
                manifest,
                checker_url=checker_url,
                forbidden_screenshot_hashes=used_screenshot_hashes,
                require_external_provenance=(
                    (raw.get("activeTab") or {}).get("status") == "AVAILABLE"
                ),
            )
            used_screenshot_hashes.add(str(normalized["screenshot"]["sha256"]))
            entry = acceptance_entry(normalized, manifest)
        entries.append(entry)
    if observation_map:
        extra = "、".join(f"{platform}/{key}" for platform, key in sorted(observation_map))
        raise CheckerAcceptanceError("观察记录包含候选清单外平台：" + extra)
    conclusion = summary_conclusion(entries, len(manifests))
    return {
        "schemaVersion": SCHEMA,
        "checkerUrl": checker_url,
        "recordedAt": observations.get("recordedAt"),
        "preflightEvidence": preflight_refs,
        "targetCount": len(manifests),
        "platforms": entries,
        "summary": {"conclusion": conclusion},
        "userConclusion": user_summary(conclusion, entries),
    }


def validate_acceptance(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict) or data.get("schemaVersion") != SCHEMA:
        raise CheckerAcceptanceError(f"Checker 验收 schemaVersion 必须为 {SCHEMA}")
    checker_url = str(data.get("checkerUrl") or "").strip().rstrip("/")
    if not checker_url or not str(data.get("recordedAt") or "").strip():
        raise CheckerAcceptanceError("Checker 验收缺少 checkerUrl 或 recordedAt")
    preflight_refs = data.get("preflightEvidence") or []
    if not isinstance(preflight_refs, list):
        raise CheckerAcceptanceError("Checker 验收 preflightEvidence 必须是数组")
    used_hashes: set[str] = set()
    for index, reference in enumerate(preflight_refs):
        verify_file_ref(reference, f"Checker preflight 证据 {index + 1}")
        used_hashes.add(str(reference.get("sha256")))
    entries = data.get("platforms")
    target_count = data.get("targetCount")
    if not isinstance(entries, list) or not isinstance(target_count, int) or target_count < 1:
        raise CheckerAcceptanceError("Checker 验收缺少目标平台记录")
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise CheckerAcceptanceError("Checker 平台记录必须是对象")
        key = (str(entry.get("platform") or ""), str(entry.get("deliveryKey") or ""))
        if not all(key) or key in seen:
            raise CheckerAcceptanceError(f"Checker 平台与交付组合缺失或重复：{key}")
        seen.add(key)
        manifest_path = verify_file_ref(entry.get("candidateManifest"), f"{key} 候选清单")
        manifest = load_json(manifest_path)
        if not isinstance(manifest, dict):
            raise CheckerAcceptanceError(f"{key} 候选清单必须是对象")
        manifest["manifestPath"] = str(manifest_path)
        if entry.get("artifact") != manifest_artifact(manifest):
            raise CheckerAcceptanceError(f"{key} Checker 记录未绑定候选清单中的 exact artifact")
        artifact_path = Path(str(entry["artifact"].get("path") or "")).expanduser().resolve()
        if (
            not artifact_path.is_file()
            or artifact_path.stat().st_size != entry["artifact"].get("bytes")
            or sha256_file(artifact_path) != entry["artifact"].get("sha256")
        ):
            raise CheckerAcceptanceError(f"{key} exact artifact 不存在或已变化")
        observation = entry.get("observation")
        if isinstance(observation, dict):
            normalized = validate_observation(
                observation,
                manifest,
                checker_url=checker_url,
                expected_attempt_id=str(entry.get("attemptId") or ""),
                forbidden_screenshot_hashes=used_hashes,
                require_external_provenance=(
                    (observation.get("activeTab") or {}).get("status") == "AVAILABLE"
                ),
            )
            expected_entry = acceptance_entry(normalized, manifest)
            comparable = {
                name: entry.get(name)
                for name in (
                    "platform", "deliveryKey", "deliveryContext", "artifact", "candidateManifest",
                    "attemptId", "capturedAt", "tab", "static", "runtime", "warningDetails",
                    "acceptedNotices", "classification", "conclusion", "evidence", "observation",
                    "observationSha256", "userConclusion",
                )
            }
            if comparable != expected_entry:
                raise CheckerAcceptanceError(f"{key} Checker 派生结论与结构化页面观察不一致")
            used_hashes.add(str(normalized["screenshot"]["sha256"]))
        elif entry.get("conclusion") != "NOT_RUN":
            raise CheckerAcceptanceError(f"{key} 缺少可重放的结构化页面观察")
        derived = platform_conclusion(entry)
        if entry.get("conclusion") not in PLATFORM_CONCLUSIONS or entry.get("conclusion") != derived:
            raise CheckerAcceptanceError(f"{key} Checker 逐平台结论与证据不一致")
    expected_summary = summary_conclusion(entries, target_count)
    if (data.get("summary") or {}).get("conclusion") != expected_summary:
        raise CheckerAcceptanceError("Checker 总体结论与逐平台证据不一致")
    return data


def load_and_validate(path: Path) -> dict[str, Any]:
    data = load_json(path.expanduser().resolve())
    if not isinstance(data, dict):
        raise CheckerAcceptanceError("Checker 验收文件必须是 JSON 对象")
    return validate_acceptance(data)


def render_markdown(data: dict[str, Any]) -> str:
    conclusion = (data.get("summary") or {}).get("conclusion")
    next_step = {
        "PASS": "把 Checker 作为补充证据写入交付报告，并继续正式平台与人工验收。",
        "REWORK_REQUIRED": "必须继续修复真实生成链、重建受影响平台、supersede 新 SHA 并复检；不得在此停止。",
        "OBSERVATION_RETRY": "保留本地候选资格；如继续 Checker，保持 artifact SHA 不变并用新浏览器 attempt 重录。",
        "BLOCKED_EXTERNAL": "保留本地 final-recheck并写入外部补测提醒；等待 Checker 恢复、页签可用或转入对应真实平台验证。",
    }.get(str(conclusion), "如继续 Checker，补齐当前 artifact 的结构化页面观察；不得宣称 Checker 通过。")
    lines = [
        "# Playable Ad Checker 验收结果",
        "",
        f"> {data.get('userConclusion')}",
        "",
        "## 一眼结论",
        "",
        f"- 检查对象：本轮 {data.get('targetCount')} 个 exact final artifact，均绑定绝对路径、大小和 SHA-256。",
        f"- 当前结果：{data.get('userConclusion')}。",
        f"- 下一步：{next_step}",
        "- 证据口径：计数、CTA 与 Mintegral 生命周期全部从结构化页面节点、可信输入和桥接调用派生；命令行不能填写结论布尔值。",
        "",
        "## 逐平台结果",
        "",
        "| 交付组合 | 平台 | attempt | 分类 | 静态 | 运行时 | CTA | 生命周期 | 中文结论 |",
        "|---|---|---|---|---:|---:|---|---|---|",
    ]
    for entry in data.get("platforms") or []:
        static = entry.get("static") or {}
        runtime = entry.get("runtime") or {}
        static_text = f"通过 {static.get('passed', 0)} / 警告 {static.get('warnings', 0)} / 失败 {static.get('failures', 0)}"
        runtime_text = f"通过 {runtime.get('passed', 0)} / 警告 {runtime.get('warnings', 0)} / 失败 {runtime.get('failures', 0)}"
        lines.append(
            f"| {entry.get('deliveryKey')} | {entry.get('platform')} | {entry.get('attemptId') or '未完成'} | {entry.get('classification')} | "
            f"{static_text} | {runtime_text} | {'已派生捕获' if runtime.get('ctaCaptured') is True else '未捕获'} | "
            f"{'已派生捕获' if runtime.get('lifecycleCaptured') is True else ('不适用' if entry.get('platform') != 'mintegral' else '未捕获')} | {entry.get('userConclusion')} |"
        )
    notices = [
        (entry, notice)
        for entry in data.get("platforms") or []
        for notice in entry.get("acceptedNotices") or []
    ]
    if notices:
        lines.extend(["", "## 封闭规则验签的商店链接 notice", ""])
        for entry, notice in notices:
            lines.append(
                f"- {entry.get('platform')} / {entry.get('deliveryKey')}：规则 `{notice.get('id')}`；"
                f"当前 artifact 的 Google Play 地址为 `{notice.get('googlePlayUrl')}`。"
            )
    lines.append("")
    return "\n".join(lines)
