from __future__ import annotations

import hashlib
import json
import posixpath
import re
from pathlib import Path
from typing import Any

from artifact import (
    Artifact,
    ArtifactError,
    checker_visible_http_urls,
    external_resource_urls,
    missing_packaged_refs,
    read_json_entry,
    unresolved_self_contained_refs,
)

SKILL_ROOT = Path(__file__).resolve().parents[2]
RULES_ROOT = SKILL_ROOT / "rules"
MANIFEST_PATH = RULES_ROOT / "manifest.json"

KNOWN_CHECK_TYPES = {
    "all_regex_present",
    "any_regex_present",
    "artifact_kind",
    "audio_gate",
    "checker_visible_http_urls_allowlist",
    "dynamic_image_assets_embedded",
    "external_urls_allowlist",
    "global_functions",
    "html_scaffold",
    "json_fields_enum",
    "json_fields_equal",
    "manual",
    "max_bytes",
    "max_file_count",
    "max_main_html_bytes",
    "max_newlines",
    "max_uncompressed_bytes",
    "meta_content_regex",
    "mintegral_structure",
    "no_auto_redirect",
    "no_junk_entries",
    "no_nested_zip",
    "regex_absent",
    "regex_count",
    "regex_present",
    "required_root_files",
    "resource_references_exist",
    "self_contained_html",
    "store_links",
    "strict_html_end",
    "zip_name_max_chars",
    "zip_name_regex",
}


class RulesetError(RuntimeError):
    pass


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RulesetError(f"规则文件无法读取: {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise RulesetError(f"规则文件顶层必须是对象: {path}")
    return data


def canonical_ruleset_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths, key=lambda item: item.name):
        digest.update(path.name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def regex_fields(check: dict) -> list[str]:
    fields: list[str] = []
    if isinstance(check.get("pattern"), str):
        fields.append(check["pattern"])
    if isinstance(check.get("patterns"), list):
        fields.extend(value for value in check["patterns"] if isinstance(value, str))
    if check.get("type") == "external_urls_allowlist":
        fields.extend(value for value in check.get("allow", []) if isinstance(value, str))
    if check.get("type") == "checker_visible_http_urls_allowlist":
        fields.extend(value for value in check.get("allow", []) if isinstance(value, str))
        for values in check.get("allowByPlatform", {}).values():
            if isinstance(values, list):
                fields.extend(value for value in values if isinstance(value, str))
    return fields


def verify_ruleset() -> dict:
    manifest = load_json(MANIFEST_PATH)
    if manifest.get("schemaVersion") != "playable-ruleset-manifest-v1":
        raise RulesetError("manifest schemaVersion 不受支持")
    version = manifest.get("rulesetVersion")
    if not isinstance(version, str) or not version:
        raise RulesetError("manifest 缺少 rulesetVersion")
    platforms = manifest.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        raise RulesetError("manifest 缺少平台映射")

    paths = [MANIFEST_PATH]
    seen_ids: set[str] = set()
    platform_rule_ids: dict[str, set[str]] = {}
    platform_counts: dict[str, int] = {}
    for platform, config in platforms.items():
        files = config.get("files") if isinstance(config, dict) else None
        if not isinstance(files, list) or not files:
            raise RulesetError(f"{platform} 缺少规则文件列表")
        count = 0
        for file_name in files:
            path = RULES_ROOT / str(file_name)
            if not path.is_file():
                raise RulesetError(f"{platform} 规则文件不存在: {file_name}")
            if path not in paths:
                paths.append(path)
            document = load_json(path)
            rules = document.get("rules")
            if not isinstance(rules, list):
                raise RulesetError(f"{file_name} 缺少 rules 数组")
            for rule in rules:
                if not isinstance(rule, dict):
                    raise RulesetError(f"{file_name} 包含非对象规则")
                rule_id = rule.get("id")
                if not isinstance(rule_id, str) or not rule_id:
                    raise RulesetError(f"{file_name} 包含无 ID 规则")
                if rule_id in seen_ids and document.get("platform") != "common":
                    raise RulesetError(f"规则 ID 重复: {rule_id}")
                seen_ids.add(rule_id)
                for required in (
                    "title", "stage", "severity", "sourceClass",
                    "sourceVersion", "check", "repairHint", "autoRepair",
                ):
                    if required not in rule:
                        raise RulesetError(f"{rule_id} 缺少字段 {required}")
                if rule["severity"] not in {"blocker", "warning", "manual"}:
                    raise RulesetError(f"{rule_id} severity 不合法")
                check = rule["check"]
                if not isinstance(check, dict) or check.get("type") not in KNOWN_CHECK_TYPES:
                    raise RulesetError(f"{rule_id} check.type 不受支持")
                for pattern in regex_fields(check):
                    try:
                        re.compile(pattern, re.IGNORECASE | re.MULTILINE)
                    except re.error as exc:
                        raise RulesetError(f"{rule_id} 正则无效: {exc}") from exc
                count += 1
        platform_counts[platform] = count
        platform_rule_ids[platform] = {
            str(rule.get("id"))
            for file_name in files
            for rule in (load_json(RULES_ROOT / str(file_name)).get("rules") or [])
            if isinstance(rule, dict) and rule.get("id")
        }

    matrix_name = manifest.get("checkerParityMatrix")
    if not isinstance(matrix_name, str) or not matrix_name.strip():
        raise RulesetError("manifest 缺少 checkerParityMatrix")
    matrix_path = (RULES_ROOT / matrix_name).resolve()
    if not matrix_path.is_file() or RULES_ROOT.resolve() not in matrix_path.parents:
        raise RulesetError("checker parity 矩阵不存在或越出 rules 目录")
    matrix = load_json(matrix_path)
    if matrix.get("schemaVersion") != "playable-checker-parity-matrix-v1":
        raise RulesetError("checker parity 矩阵 schemaVersion 无效")
    entries = matrix.get("entries")
    if not isinstance(entries, list) or not entries:
        raise RulesetError("checker parity 矩阵缺少 entries")
    covered_platforms: set[str] = set()
    allowed_exemptions = {"none", "android-missing-ios-store-only"}
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise RulesetError(f"checker parity entries[{index}] 必须是对象")
        platform = str(entry.get("platform") or "")
        if platform not in platforms:
            raise RulesetError(f"checker parity entries[{index}] 平台无效: {platform}")
        covered_platforms.add(platform)
        for field in ("ruleId", "checkerNode", "severity", "exemptCategory", "fixture"):
            if not isinstance(entry.get(field), str) or not entry[field].strip():
                raise RulesetError(f"checker parity entries[{index}] 缺少 {field}")
        if entry["severity"] not in {"blocker", "warning", "manual"}:
            raise RulesetError(f"checker parity entries[{index}] severity 无效")
        if entry["exemptCategory"] not in allowed_exemptions:
            raise RulesetError(f"checker parity entries[{index}] exemptCategory 不属于封闭集合")
        local_rules = entry.get("localRules")
        if not isinstance(local_rules, list) or not local_rules or not all(isinstance(item, str) for item in local_rules):
            raise RulesetError(f"checker parity entries[{index}] localRules 无效")
        missing_rules = sorted(set(local_rules) - platform_rule_ids[platform])
        if missing_rules:
            raise RulesetError(f"checker parity entries[{index}] 引用了未加载规则: {', '.join(missing_rules)}")
        if entry["exemptCategory"] != "none" and set(local_rules) != {"COMMON-STA-004"}:
            raise RulesetError("只有 COMMON-STA-004 可声明商店链接 notice 豁免")
        fixture_path = (RULES_ROOT / entry["fixture"]).resolve()
        if not fixture_path.is_file() or SKILL_ROOT.resolve() not in fixture_path.parents:
            raise RulesetError(f"checker parity fixture 不存在或越出 Skill: {entry['fixture']}")
        if fixture_path not in paths:
            paths.append(fixture_path)
    if covered_platforms != set(platforms):
        missing = sorted(set(platforms) - covered_platforms)
        raise RulesetError("checker parity 矩阵未覆盖全部平台: " + ", ".join(missing))
    paths.append(matrix_path)

    return {
        "schemaVersion": manifest["schemaVersion"],
        "rulesetVersion": version,
        "rulesetSha256": canonical_ruleset_hash(paths),
        "platforms": platform_counts,
        "sourceProvenance": manifest.get("sourceProvenance", []),
        "checkerParityMatrix": entries,
        "paths": [str(path) for path in paths],
    }


def load_platform_rules(platform: str) -> tuple[dict, list[dict]]:
    verification = verify_ruleset()
    manifest = load_json(MANIFEST_PATH)
    platform_config = manifest["platforms"].get(platform)
    if not platform_config:
        raise RulesetError(f"不支持的平台: {platform}")
    rules: list[dict] = []
    for file_name in platform_config["files"]:
        document = load_json(RULES_ROOT / file_name)
        rules.extend(document["rules"])
    verification["platform"] = platform
    verification["delivery"] = platform_config.get("delivery")
    return verification, rules


def target_text(artifact: Artifact, check: dict) -> str:
    target = check.get("target", "combined")
    if target == "main_html":
        return artifact.main_html_text
    return artifact.combined_text


def compile_pattern(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE | re.MULTILINE)


def attr_value(tag: str, name: str) -> str:
    match = re.search(
        rf"\b{re.escape(name)}\s*=\s*(['\"])(.*?)\1",
        tag,
        re.IGNORECASE | re.DOTALL,
    )
    return match.group(2) if match else ""


def meta_content(html_text: str, name: str) -> str:
    for match in re.finditer(r"<meta\b[^>]*>", html_text or "", re.IGNORECASE):
        tag = match.group(0)
        if attr_value(tag, "name").lower() == name.lower():
            return attr_value(tag, "content")
    return ""


def global_function_present(text: str, name: str) -> bool:
    escaped = re.escape(name)
    patterns = [
        rf"\bfunction\s+{escaped}\s*\(",
        rf"(?:window|globalThis)\s*\.\s*{escaped}\s*=\s*(?:function\b|(?:async\s*)?\([^)]*\)\s*=>|(?:async\s*)?[A-Za-z_$][\w$]*\s*=>)",
        rf"(?:window|globalThis)\s*\[\s*['\"]{escaped}['\"]\s*\]\s*=\s*(?:function\b|(?:async\s*)?\([^)]*\)\s*=>|(?:async\s*)?[A-Za-z_$][\w$]*\s*=>)",
    ]
    return any(re.search(pattern, text, re.IGNORECASE | re.MULTILINE) for pattern in patterns)


def decode_js_string(value: str) -> str:
    """Decode the small escape subset used by asset paths in JS/JSON literals."""
    return (
        value.replace(r"\/", "/")
        .replace(r"\\\"", '"')
        .replace(r"\\'", "'")
        .replace(r"\\\\", "\\")
    )


def quoted_literal_patterns(prefix: str) -> list[re.Pattern[str]]:
    return [
        re.compile(
            prefix + r'\s*"(?P<value>(?:\\.|[^"\\])*)"',
            re.IGNORECASE | re.MULTILINE,
        ),
        re.compile(
            prefix + r"\s*'(?P<value>(?:\\.|[^'\\])*)'",
            re.IGNORECASE | re.MULTILINE,
        ),
    ]


def dynamic_image_asset_references(text: str) -> list[str]:
    prefix = r'(?:["\']?imageAsset["\']?)\s*:'
    values: set[str] = set()
    for pattern in quoted_literal_patterns(prefix):
        for match in pattern.finditer(text or ""):
            value = decode_js_string(match.group("value")).strip()
            if value:
                values.add(value)
    return sorted(values)


def string_literal_mappings(text: str) -> dict[str, str]:
    pair_patterns = [
        re.compile(
            r'"(?P<key>(?:\\.|[^"\\])*)"\s*:\s*"(?P<value>(?:\\.|[^"\\])*)"',
            re.IGNORECASE | re.MULTILINE,
        ),
        re.compile(
            r"'(?P<key>(?:\\.|[^'\\])*)'\s*:\s*'(?P<value>(?:\\.|[^'\\])*)'",
            re.IGNORECASE | re.MULTILINE,
        ),
        re.compile(
            r'"(?P<key>(?:\\.|[^"\\])*)"\s*:\s*\'(?P<value>(?:\\.|[^\'\\])*)\'',
            re.IGNORECASE | re.MULTILINE,
        ),
        re.compile(
            r"'(?P<key>(?:\\.|[^'\\])*)'\s*:\s*\"(?P<value>(?:\\.|[^\"\\])*)\"",
            re.IGNORECASE | re.MULTILINE,
        ),
    ]
    mappings: dict[str, tuple[int, str]] = {}
    for pattern in pair_patterns:
        for match in pattern.finditer(text or ""):
            key = decode_js_string(match.group("key")).strip()
            value = decode_js_string(match.group("value")).strip()
            previous = mappings.get(key)
            if previous is None or match.start() > previous[0]:
                mappings[key] = (match.start(), value)
    return {key: value for key, (_, value) in mappings.items()}


def is_container_safe_image_value(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered.startswith("data:image/") or lowered.startswith("blob:")


def describe_image_mapping(reference: str, mapped: str | None) -> str:
    if reference.lower().startswith("data:image/"):
        reference_label = f"<直接内联 imageAsset，{len(reference)} 字符>"
    elif reference.lower().startswith("blob:"):
        reference_label = "<直接 Blob imageAsset>"
    else:
        reference_label = reference if len(reference) <= 240 else reference[:237] + "..."
    if mapped is None:
        return f"{reference_label} -> <缺少容器安全映射>"
    if mapped.lower().startswith("data:image/"):
        media_type = mapped.split(";", 1)[0]
        return f"{reference_label} -> {media_type};...（内联，{len(mapped)} 字符）"
    if mapped.lower().startswith("blob:"):
        return f"{reference_label} -> blob:...（运行时 Blob URL）"
    shortened = mapped if len(mapped) <= 240 else mapped[:237] + "..."
    return f"{reference_label} -> {shortened}"


def evaluate_check(
    artifact: Artifact,
    check: dict,
    context: dict[str, Any] | None = None,
) -> tuple[bool | None, str, list[str]]:
    check_type = check["type"]
    text = target_text(artifact, check)
    context = context or {}

    if check_type == "manual":
        return None, "需要真实平台或人工复核", []

    if check_type == "artifact_kind":
        expected = check["value"]
        ok = artifact.kind == expected
        return ok, f"当前 {artifact.kind}，要求 {expected}", []

    if check_type == "max_bytes":
        limit = int(check["value"])
        ok = artifact.size <= limit
        return ok, f"{artifact.size} / {limit} bytes", []

    if check_type == "max_uncompressed_bytes":
        limit = int(check["value"])
        ok = artifact.uncompressed_size <= limit
        return ok, f"{artifact.uncompressed_size} / {limit} bytes", []

    if check_type == "max_main_html_bytes":
        size = len(artifact.main_html_text.encode("utf-8"))
        limit = int(check["value"])
        ok = size <= limit
        return ok, f"{size} / {limit} bytes", []

    if check_type == "max_file_count":
        count = len(artifact.entries)
        limit = int(check["value"])
        return count <= limit, f"{count} / {limit} entries", []

    if check_type == "html_scaffold":
        flags = {
            "html": bool(re.search(r"<html[\s>]", artifact.main_html_text, re.IGNORECASE)),
            "head": bool(re.search(r"<head[\s>]", artifact.main_html_text, re.IGNORECASE)),
            "body": bool(re.search(r"<body[\s>]", artifact.main_html_text, re.IGNORECASE)),
        }
        missing = [name for name, present in flags.items() if not present]
        return not missing, "HTML 结构完整" if not missing else "缺少 " + ", ".join(missing), missing

    if check_type == "no_junk_entries":
        bad: list[str] = []
        for name in artifact.entry_names:
            if any(compile_pattern(pattern).search(name) for pattern in check.get("patterns", [])):
                bad.append(name)
        return not bad, "未发现垃圾文件" if not bad else f"发现 {len(bad)} 个垃圾条目", bad

    if check_type == "no_nested_zip":
        nested = [name for name in artifact.entry_names if name.lower().endswith(".zip")]
        return not nested, "未发现嵌套 ZIP" if not nested else "发现嵌套 ZIP", nested

    if check_type == "no_auto_redirect":
        patterns = [
            r"<meta[^>]+http-equiv\s*=\s*['\"]refresh['\"]",
            r"location\.(?:assign|replace)\s*\(",
            r"location\.href\s*=",
            r"window\.location\s*=",
        ]
        hits = [pattern for pattern in patterns if compile_pattern(pattern).search(text)]
        return not hits, "未发现自动跳转模式" if not hits else "发现自动跳转模式", hits

    if check_type == "regex_present":
        pattern = compile_pattern(check["pattern"])
        ok = bool(pattern.search(text))
        return ok, "已检测到目标模式" if ok else "未检测到目标模式", []

    if check_type == "regex_absent":
        pattern = compile_pattern(check["pattern"])
        matches = [match.group(0)[:240] for match in pattern.finditer(text)]
        return not matches, "未检测到禁止模式" if not matches else f"检测到 {len(matches)} 处禁止模式", matches[:20]

    if check_type == "all_regex_present":
        missing = [
            pattern for pattern in check.get("patterns", [])
            if not compile_pattern(pattern).search(text)
        ]
        return not missing, "全部目标模式存在" if not missing else f"缺少 {len(missing)} 个目标模式", missing

    if check_type == "any_regex_present":
        present = [
            pattern for pattern in check.get("patterns", [])
            if compile_pattern(pattern).search(text)
        ]
        return bool(present), "检测到允许模式" if present else "未检测到任何允许模式", present

    if check_type == "regex_count":
        count = len(list(compile_pattern(check["pattern"]).finditer(text)))
        expected = int(check["value"])
        return count == expected, f"检测到 {count} 次，要求 {expected} 次", []

    if check_type == "max_newlines":
        count = text.count("\n") + text.count("\r")
        limit = int(check["value"])
        return count <= limit, f"检测到 {count} 个换行字符，要求 ≤ {limit}", []

    if check_type == "strict_html_end":
        ok = artifact.main_html_text.endswith("</html>")
        return ok, "严格结束于 </html>" if ok else "</html> 后存在内容或缺少结束标签", []

    if check_type == "self_contained_html":
        unresolved = unresolved_self_contained_refs(
            artifact.main_html_text,
            check.get("allow", []),
        )
        return not unresolved, "HTML 完全自包含" if not unresolved else f"发现 {len(unresolved)} 个非内联引用", unresolved

    if check_type == "required_root_files":
        roots = {
            name.lower() for name in artifact.entry_names
            if "/" not in name.rstrip("/") and not name.endswith("/")
        }
        missing = [name for name in check.get("values", []) if name.lower() not in roots]
        return not missing, "根目录文件齐全" if not missing else "缺少根目录文件", missing

    if check_type == "resource_references_exist":
        missing = missing_packaged_refs(artifact, check.get("allow", []))
        return not missing, "资源引用完整" if not missing else f"缺少 {len(missing)} 个资源", missing

    if check_type == "dynamic_image_assets_embedded":
        references = dynamic_image_asset_references(text)
        if not references:
            return True, "未检测到 imageAsset 动态图片配置", []
        mappings = string_literal_mappings(text)
        unsafe: list[str] = []
        evidence: list[str] = []
        for reference in references:
            mapped = reference if is_container_safe_image_value(reference) else mappings.get(reference)
            if mapped is None and reference.startswith("./"):
                mapped = mappings.get(reference[2:])
            evidence.append(describe_image_mapping(reference, mapped))
            if mapped is None or not is_container_safe_image_value(mapped):
                unsafe.append(reference)
        if unsafe:
            return (
                False,
                f"{len(unsafe)} / {len(references)} 个动态图片资源未使用 data URI 或 Blob URL",
                evidence,
            )
        return True, f"{len(references)} 个动态图片资源均使用容器安全映射", evidence

    if check_type == "external_urls_allowlist":
        urls = external_resource_urls(text)
        allow_patterns = [compile_pattern(pattern) for pattern in check.get("allow", [])]
        blocked = [
            url for url in urls
            if not any(pattern.fullmatch(url) for pattern in allow_patterns)
        ]
        return not blocked, "未发现非白名单外链" if not blocked else f"发现 {len(blocked)} 个非白名单外链", blocked

    if check_type == "checker_visible_http_urls_allowlist":
        urls = checker_visible_http_urls(text)
        allow = list(check.get("allow", []))
        platform = str(context.get("platform", ""))
        platform_allow = check.get("allowByPlatform", {}).get(platform, [])
        if isinstance(platform_allow, list):
            allow.extend(platform_allow)
        allow_patterns = [compile_pattern(pattern) for pattern in allow]
        blocked = [
            url for url in urls
            if not any(pattern.fullmatch(url) for pattern in allow_patterns)
        ]
        return (
            not blocked,
            "checker 可见 URL 仅包含商店地址或当前平台官方 SDK"
            if not blocked else
            f"发现 {len(blocked)} 个会触发 checker 网络请求警告的 URL 字面量",
            blocked,
        )

    if check_type == "audio_gate":
        has_audio = bool(re.search(
            r"AudioContext|webkitAudioContext|\.play\s*\(|<audio[\s>]|data:audio/",
            text,
            re.IGNORECASE,
        ))
        has_gate = bool(re.search(
            r"pointerdown|click|touchstart|mousedown|touchend",
            text,
            re.IGNORECASE,
        ))
        ok = not has_audio or has_gate
        summary = "未使用音频 API" if not has_audio else (
            "检测到用户交互门控" if has_gate else "使用音频但未检测到交互门控"
        )
        return ok, summary, []

    if check_type == "store_links":
        ios = bool(re.search(r"apps\.apple\.com|itunes\.apple\.com", text, re.IGNORECASE))
        android = bool(re.search(r"play\.google\.com", text, re.IGNORECASE))
        target_os = str(context.get("targetOs", "unspecified")).lower()
        if target_os not in {"android", "ios", "both", "unspecified"}:
            raise RulesetError(f"不支持的 targetOs: {target_os}")
        if target_os == "android":
            return (
                android,
                "Android 投放的 Google Play 地址已配置" if android else "Android 投放缺少 Google Play 地址",
                [] if android else ["Google Play URL"],
            )
        if target_os == "ios":
            return (
                ios,
                "iOS 投放的 App Store 地址已配置" if ios else "iOS 投放缺少 App Store 地址",
                [] if ios else ["App Store URL"],
            )
        if target_os == "both":
            missing = []
            if not ios:
                missing.append("App Store URL")
            if not android:
                missing.append("Google Play URL")
            return (
                ios and android,
                "双端投放的商店地址齐全" if not missing else "双端投放的商店地址不完整",
                missing,
            )
        if ios and android:
            return True, "未声明目标端，但双端商店地址均已配置", []
        detected = []
        if ios:
            detected.append("已检测到 App Store URL")
        if android:
            detected.append("已检测到 Google Play URL")
        if not detected:
            detected.append("未检测到 App Store 或 Google Play URL")
        return None, "未声明投放目标端，请确认商店地址与实际投放端一致", detected

    if check_type == "zip_name_regex":
        base = Path(artifact.file_name).stem
        ok = bool(re.fullmatch(check["pattern"], base))
        return ok, f"ZIP 基础名: {base}", []

    if check_type == "zip_name_max_chars":
        base = Path(artifact.file_name).stem
        count = len(base)
        limit = int(check["value"])
        return count <= limit, f"{count} / {limit} 字符", []

    if check_type == "json_fields_enum":
        try:
            data = read_json_entry(artifact, check["file"])
        except ArtifactError as exc:
            return False, str(exc), []
        invalid = []
        for field, values in check.get("fields", {}).items():
            if data.get(field) not in values:
                invalid.append(f"{field}={data.get(field)!r}")
        return not invalid, "JSON 字段合法" if not invalid else "JSON 字段缺失或非法", invalid

    if check_type == "json_fields_equal":
        try:
            data = read_json_entry(artifact, check["file"])
        except ArtifactError as exc:
            return False, str(exc), []
        mismatched = [
            f"{field}={data.get(field)!r}, expected={expected!r}"
            for field, expected in check.get("values", {}).items()
            if data.get(field) != expected
        ]
        return not mismatched, "JSON 字段符合推荐值" if not mismatched else "JSON 字段不符合推荐值", mismatched

    if check_type == "meta_content_regex":
        value = meta_content(artifact.main_html_text, check["name"])
        normalized = re.sub(r"\s+", "", value) if check.get("normalizeWhitespace") else value
        ok = bool(re.fullmatch(check["pattern"], normalized, re.IGNORECASE))
        return ok, f"{check['name']}={value!r}", []

    if check_type == "global_functions":
        missing = [
            name for name in check.get("names", [])
            if not global_function_present(text, name)
        ]
        return not missing, "全局函数声明完整" if not missing else "缺少真实全局函数声明", missing

    if check_type == "mintegral_structure":
        if artifact.kind != "zip":
            return False, "Mintegral 结构要求 ZIP", []
        base = Path(artifact.file_name).stem
        files = [name for name in artifact.entry_names if not name.endswith("/")]
        root_files = [name for name in files if "/" not in name]
        root_dirs = sorted({name.split("/")[0] for name in files if "/" in name})
        main = artifact.main_html_path or ""
        problems = []
        if root_files:
            problems.append("ZIP 根目录存在文件: " + ", ".join(root_files[:10]))
        if root_dirs != [base]:
            problems.append(f"唯一目录应为 {base}，当前 {root_dirs}")
        if not main.startswith(base + "/"):
            problems.append(f"主 HTML 不在 {base}/ 内: {main or '<missing>'}")
        elif Path(posixpath.basename(main)).stem != base:
            problems.append(f"主 HTML 基础名应为 {base}: {main}")
        return not problems, "ZIP、目录与主 HTML 同名" if not problems else "同名结构不符合", problems

    raise RulesetError(f"未实现的 check.type: {check_type}")


def evaluate_rules(
    artifact: Artifact,
    rules: list[dict],
    context: dict[str, Any] | None = None,
) -> tuple[list[dict], dict, str]:
    results: list[dict] = []
    summary = {"pass": 0, "warning": 0, "manual": 0, "fail": 0}
    for rule in rules:
        try:
            passed, check_summary, evidence = evaluate_check(
                artifact,
                rule["check"],
                context=context,
            )
        except (ArtifactError, RulesetError, KeyError, TypeError, ValueError) as exc:
            passed = False
            check_summary = f"检查执行失败: {exc}"
            evidence = []
        if passed is None or rule["severity"] == "manual":
            status = "manual"
        elif passed:
            status = "pass"
        elif rule["severity"] == "blocker":
            status = "fail"
        else:
            status = "warning"
        summary[status] += 1
        result = {
            "id": rule["id"],
            "title": rule["title"],
            "stage": rule["stage"],
            "severity": rule["severity"],
            "status": status,
            "summary": check_summary,
            "evidence": evidence,
            "sourceClass": rule["sourceClass"],
            "sourceVersion": rule["sourceVersion"],
            "repairHint": rule["repairHint"],
            "autoRepair": rule["autoRepair"],
        }
        if rule.get("manualGate"):
            result["manualGate"] = rule["manualGate"]
        results.append(result)
    if summary["fail"]:
        conclusion = "FAIL"
    elif summary["warning"]:
        conclusion = "REVIEW"
    else:
        conclusion = "PASS"
    return results, summary, conclusion
