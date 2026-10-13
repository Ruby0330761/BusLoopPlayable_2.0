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


VALID_ACTIONS = {
    "KEEP", "EXCLUDE", "DEDUP", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS",
    "SUBSET_FONT", "PRUNE_CONFIG", "TINIFY_SHRINK",
}

ACTION_LABELS = {
    "KEEP": "保持不变",
    "EXCLUDE": "不放进本次包",
    "DEDUP": "去除本次包内重复载荷",
    "RESIZE": "缩小尺寸",
    "REENCODE": "重新编码",
    "SIMPLIFY": "减少三维物体面数",
    "REPACK_ATLAS": "生成图片合集",
    "SUBSET_FONT": "按字符覆盖证明精简字体",
    "PRUNE_CONFIG": "按引用闭包精简配置",
    "TINIFY_SHRINK": "Tinify 保持尺寸压缩",
}

KEEP_REASON_LABELS = {
    "RESOURCE-OPP-UNREFERENCED": "当前玩法没有引用；只是不放进本次候选，项目原文件继续保留",
    "RESOURCE-OPP-IMAGE-NO-UPSCALE": "图片尺寸已符合显示需求，格式和质量也没有已证明的正收益",
    "RESOURCE-OPP-IMAGE-AUDITED-NO-BENEFIT": "图片的尺寸、格式和质量都已检查，当前没有安全正收益",
    "RESOURCE-OPP-AUDIO-WITHIN-BUDGET": "音频参数已在当前分类的预算范围内",
    "RESOURCE-OPP-ATLAS-GROUP-MEMBER": "单图由图片合集动作统一处理，项目原文件暂时保留",
    "RESOURCE-OPP-ATLAS-RUNTIME-OR-INPUTS-NOT-READY": "图片合集条件尚未满足，暂时保持各单图",
    "RESOURCE-OPP-MODEL-RUNTIME-FORMAT-PROTECTED": "运行时只支持当前三维物体格式，转换不会带来安全收益",
    "RESOURCE-OPP-MODEL-WITHIN-EVIDENCE": "三维物体已在当前几何和运行时预算内",
    "RESOURCE-OPP-CONFIG-DYNAMIC-INCOMPLETE": "配置存在未闭合的动态读取，暂时保持完整文件",
    "RESOURCE-OPP-CONFIG-CLOSURE-USES-ALL": "当前玩法确实会读取全部配置内容",
    "RESOURCE-OPP-FONT-DYNAMIC-INCOMPLETE": "历史字体动态文案证据不完整，只按旧结果保留",
    "RESOURCE-OPP-FONT-LEGACY-GLOBAL-COVERAGE": "历史字体只有项目级字符证据，只按旧结果保留",
    "RESOURCE-OPP-NO-REGISTERED-RULE": "当前没有已登记且能证明安全正收益的转换方式",
}

BUCKET_LABELS = {
    "audio": "音频",
    "textures": "图片",
    "atlas": "图片合集",
    "models": "三维物体资源",
    "fonts": "字体",
    "config": "配置",
    "other": "其他资源",
}


def keep_reason_label(rule_id: str) -> str:
    return KEEP_REASON_LABELS.get(rule_id, "其他资源已完成审计，当前保持原文件")


def bucket_label(bucket: str) -> str:
    return BUCKET_LABELS.get(bucket, "其他资源")


def user_facing_text(value: object) -> str:
    return (
        str(value or "")
        .replace("A/B", "优化前后对比")
        .replace("A-B", "优化前后对比")
        .replace("Gate A", "试做确认")
        .replace("Gate B", "覆盖确认")
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="生成供用户确认的资源优化计划 Markdown 与 JSON")
    parser.add_argument("--effect-baseline", required=True, type=Path)
    parser.add_argument("--ledger", required=True, type=Path)
    parser.add_argument("--reference-graph", required=True, type=Path)
    parser.add_argument("--allowlist", required=True, type=Path)
    parser.add_argument("--opportunity-audit", required=True, type=Path, help="资源机会审计；禁止调用方直接用全 KEEP 跳过主动检测")
    parser.add_argument("--actions", type=Path, help="可选；资源动作与精确参数声明")
    parser.add_argument("--toolchain", type=Path, help="可选；待确认工具链声明或锁文件")
    parser.add_argument("--json-out", required=True, type=Path)
    parser.add_argument("--md-out", required=True, type=Path)
    parser.add_argument("--technical-md-out", type=Path, help="可选；完整技术账本，与用户确认单分开")
    return parser.parse_args()


def require_object(path: Path, schema: str) -> dict[str, Any]:
    value = load_json(path.expanduser().resolve())
    if not isinstance(value, dict) or value.get("schemaVersion") != schema:
        raise ValueError(f"{path} schemaVersion 必须为 {schema}")
    return value


def load_actions(path: Path | None) -> dict[str, dict[str, Any]]:
    if path is None:
        return {}
    value = require_object(path, "playable-resource-plan-actions-v1")
    items = value.get("actions")
    if not isinstance(items, list):
        raise ValueError("actions 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("每个 action 必须包含 path")
        action = item.get("action")
        if action not in VALID_ACTIONS:
            raise ValueError(f"资源动作无效：{action}")
        if action not in {"KEEP", "EXCLUDE", "DEDUP"} and not isinstance(item.get("parameters"), dict):
            raise ValueError(f"有损动作必须提供精确 parameters：{item['path']}")
        if item["path"] in result:
            raise ValueError(f"资源动作重复：{item['path']}")
        result[item["path"]] = item
    return result


def load_scope(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    value = require_object(path, "playable-resource-plan-actions-v1")
    scope = value.get("scope") or {}
    return scope if isinstance(scope, dict) else {}


def load_opportunity_audit(path: Path, ledger_path: Path, toolchain_path: Path | None) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    audit_path = path.expanduser().resolve()
    value = require_object(audit_path, "resource-opportunity-audit-v1")
    core = {key: item for key, item in value.items() if key not in {"generatedAt", "auditHash"}}
    if value.get("auditHash") != "sha256:" + sha256_object(core):
        raise ValueError("资源机会审计哈希无效")
    inputs = value.get("inputs") or {}
    ledger_ref = inputs.get("ledger") or {}
    if ledger_ref.get("path") != str(ledger_path.resolve()) or ledger_ref.get("sha256") != sha256_file(ledger_path.resolve()):
        raise ValueError("资源机会审计未绑定当前资源账本")
    if toolchain_path is None:
        raise ValueError("资源机会审计必须与 --toolchain 一起使用")
    toolchain_ref = inputs.get("toolchain") or {}
    if toolchain_ref.get("path") != str(toolchain_path.resolve()) or toolchain_ref.get("sha256") != sha256_file(toolchain_path.resolve()):
        raise ValueError("资源机会审计未绑定当前工具锁")
    items = value.get("items")
    if not isinstance(items, list):
        raise ValueError("资源机会审计 items 必须是数组")
    result: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError("资源机会审计项缺少 path")
        if item.get("decision") not in {"OPTIMIZE", "KEEP", "UNSUPPORTED"}:
            raise ValueError(f"资源机会审计结论无效：{item.get('path')}")
        if item["path"] in result:
            raise ValueError(f"资源机会审计路径重复：{item['path']}")
        result[item["path"]] = item
    return value, result


def default_action(resource: dict[str, Any]) -> str:
    if resource.get("classification") == "UNREFERENCED":
        return "EXCLUDE"
    return "KEEP"


def required_capability(item: dict[str, Any]) -> str | None:
    if item.get("action") == "TINIFY_SHRINK":
        return None
    if isinstance(item.get("requiredCapability"), str):
        return item["requiredCapability"]
    action = item.get("action")
    if action == "REENCODE":
        return (
            "audio-reencode" if item.get("bucket") == "audio"
            else "model-convert" if item.get("bucket") == "models"
            else "image-reencode"
        )
    return {
        "RESIZE": "image-resize",
        "SIMPLIFY": "model-simplify",
        "REPACK_ATLAS": "atlas-repack",
        "SUBSET_FONT": "font-subset",
        "PRUNE_CONFIG": "config-prune",
    }.get(action)


def capability_label(capability: str) -> str:
    return {
        "audio-reencode": "音频候选重编码",
        "image-resize": "图片降采样",
        "image-reencode": "图片格式或质量候选",
        "atlas-repack": "图片合集生成",
        "model-convert": "三维物体格式转换",
        "model-compact": "三维物体紧凑存储",
        "model-simplify": "三维物体减面",
        "font-subset": "字体字符精简",
        "config-prune": "配置引用闭包精简",
    }.get(capability, "对应资源候选转换")


def safe_cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def human_bytes(value: int) -> str:
    if value >= 1024 * 1024:
        return f"{value / (1024 * 1024):.2f} MiB"
    if value >= 1024:
        return f"{value / 1024:.1f} KiB"
    return f"{value} B"


def resource_group(path: str, bucket: str) -> str:
    if "/backgrounds/" in path:
        return "背景图"
    if "/unity-bubbles/" in path or "/bubbles/" in path:
        return "泡泡贴图"
    if "/unity-icons/" in path or "/images/icons/" in path:
        return "词条图标"
    if "/unity-ui/" in path:
        return "玩法 UI 图片"
    if "/images/ui/" in path:
        return "通用 UI 图片"
    return {
        "audio": "音频",
        "fonts": "字体",
        "config": "配置",
        "models": "三维物体资源",
        "atlas": "图片合集",
        "textures": "其他图片",
    }.get(bucket, "其他资源")


def action_description(action: str, parameters: dict[str, Any]) -> str:
    ranges = parameters.get("parameterRanges") or {}
    if action == "RESIZE" and ranges.get("maxWidthPx") and ranges.get("maxHeightPx"):
        width = "/".join(str(item) for item in ranges["maxWidthPx"])
        height = "/".join(str(item) for item in ranges["maxHeightPx"])
        alpha = "，保留 alpha" if parameters.get("preserveAlpha") else ""
        return f"等比缩小到不超过 {width}×{height}px，保持原格式和色彩空间{alpha}"
    if action == "RESIZE" and parameters.get("maxDimensionPx"):
        suffix = "，保持宽高比和文件格式" if parameters.get("preserveAspectRatio") and parameters.get("format") == "unchanged" else ""
        return f"等比缩小到最长边不超过 {parameters['maxDimensionPx']}px{suffix}"
    if action == "REENCODE":
        if parameters.get("candidateVariable") in {"format", "quality"}:
            variable = "格式" if parameters["candidateVariable"] == "format" else "质量"
            values = ranges.get(parameters["candidateVariable"], [])
            shown_values = "/".join(str(item) for item in values) if isinstance(values, list) else str(values)
            safety = "只允许无损处理" if parameters.get("losslessOnly") else "保持 alpha 与色彩空间"
            return f"图片{variable}单变量候选：{shown_values or '按批准范围'}；{safety}"
        def shown(name: str, suffix: str = "") -> str:
            value = ranges.get(name, parameters.get(name, "未声明"))
            if isinstance(value, list):
                return "/".join(str(item) for item in value) + suffix
            return f"{value}{suffix}"
        audio_class = parameters.get("audioClass", "未分类")
        return (
            f"{audio_class} 音频重新编码：{parameters.get('format', '原格式')} / "
            f"{shown('bitRateKbps', ' kbps')} / {shown('sampleRateHz', ' Hz')} / "
            f"{shown('channels', ' 声道')} / 元数据 {shown('metadata')}"
        )
    if action == "TINIFY_SHRINK":
        return "通过 Tinify Developer API 试做 shrink；保持原格式、宽高、宽高比和透明能力，不夹带 resize、convert、metadata 或 quality"
    if action == "DEDUP":
        return "让当前 exact candidate 中的重复内容只保留一份载荷，不删除项目文件"
    if action == "SIMPLIFY":
        return "按确认参数减少三维物体面数，并保护贴图位置、法线、切线、透明面、骨骼和动画"
    if action == "REPACK_ATLAS":
        return "把已稳定的小图片合成图片合集，并生成位置表、padding 和边缘扩展记录"
    if action == "SUBSET_FONT":
        return "按静态文案、动态文案和全部目标语言字符覆盖证明精简字体"
    if action == "PRUNE_CONFIG":
        return "只按已闭合的配置引用路径排除确定不可达内容"
    return ACTION_LABELS.get(action, action)


def user_scope(value: object) -> str:
    scope = str(value or "当前选定玩法")
    if scope.lower() == "q134-six-variants":
        return "Q134 六个变体（3 组词 × 海底/星空）"
    return scope


def project_label(value: object) -> str:
    path = Path(str(value or ""))
    name = path.parent.name if path.name.lower() == "playable" else path.name
    return name.upper() if name and len(name) <= 12 else "当前项目"


def build_user_summary(
    items: list[dict[str, Any]],
    summary: dict[str, Any],
    variant: object,
    project_root: object,
    ledger: dict[str, Any],
    scope_context: dict[str, Any],
    tools: list[dict[str, Any]],
    *,
    bucket_audit: dict[str, dict[str, Any]] | None = None,
    audit_blockers: list[dict[str, Any]] | None = None,
    audit_warnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    optimization_groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    excluded_groups: dict[str, dict[str, Any]] = {}
    for item in items:
        action = item["action"]
        group = resource_group(item["path"], item["bucket"])
        if action == "EXCLUDE":
            record = excluded_groups.setdefault(group, {"group": group, "count": 0, "bytes": 0, "examples": []})
            record["count"] += 1
            record["bytes"] += item["currentBytes"]
            if len(record["examples"]) < 3:
                record["examples"].append(Path(item["path"]).name)
        elif action not in {"KEEP", "EXCLUDE"}:
            parameters = item.get("parameters") or {}
            description = action_description(action, parameters)
            key = (group, action, json.dumps(parameters, ensure_ascii=False, sort_keys=True))
            record = optimization_groups.setdefault(key, {
                "group": group,
                "action": action,
                "actionLabel": ACTION_LABELS[action],
                "description": description,
                "count": 0,
                "paths": [],
                "estimatedSavingsBytes": 0,
                "currentBytes": 0,
                "parameters": parameters,
                "risks": [],
                "validations": [],
            })
            record["count"] += 1
            record["paths"].append(item["path"])
            record["estimatedSavingsBytes"] += item["estimatedSavingsBytes"]
            record["currentBytes"] += item["currentBytes"]
            risk = user_facing_text(item.get("risk"))
            validation = user_facing_text(item.get("validation"))
            if risk and risk not in record["risks"]:
                record["risks"].append(risk)
            if validation and validation not in record["validations"]:
                record["validations"].append(validation)
    for record in optimization_groups.values():
        current = record["currentBytes"]
        record["estimatedSavingsPercent"] = round(record["estimatedSavingsBytes"] * 100 / current, 1) if current else 0.0
    scope = user_scope(scope_context.get("variant") or variant)
    primary_risks: list[str] = []
    for record in optimization_groups.values():
        for risk in record["risks"]:
            if isinstance(risk, str) and risk and risk not in primary_risks:
                primary_risks.append(risk)
    if excluded_groups:
        primary_risks.append("引用范围判断错误可能导致候选缺少资源；需用同链路重建和运行时完整性验证")
    optimization_group_list = sorted(optimization_groups.values(), key=lambda item: (item["group"], item["description"]))
    excluded_group_list = sorted(excluded_groups.values(), key=lambda item: (-item["bytes"], item["group"]))
    change_summary = [
        f"{record['group']} {record['count']} 项{record['actionLabel']}"
        for record in optimization_group_list
    ]
    top_assets = sorted(
        ({"path": item["path"], "bytes": item["currentBytes"], "bucket": item["bucket"]} for item in items),
        key=lambda item: (-item["bytes"], item["path"]),
    )[:10]
    bucket_audit = bucket_audit or {}
    bucket_audits = []
    keep_reason_distribution: dict[str, int] = {}
    for bucket, record in sorted(bucket_audit.items()):
        normalized = {"bucket": bucket, **record}
        bucket_audits.append(normalized)
        for rule, count in (record.get("keepReasons") or {}).items():
            keep_reason_distribution[str(rule)] = keep_reason_distribution.get(str(rule), 0) + int(count)
    font_audits = []
    for item in items:
        if item.get("bucket") != "fonts":
            continue
        opportunity = item.get("opportunityAudit") or {}
        proof = opportunity.get("coverageProof") or {}
        decision = opportunity.get("decision")
        font_audits.append({
            "path": item.get("path"),
            "decision": decision,
            "decisionLabel": "可以精简" if decision == "OPTIMIZE" else "待补证据" if decision == "UNSUPPORTED" else "保持原文件",
            "roles": proof.get("roles") or [],
            "targetLanguages": proof.get("targetLanguages") or [],
            "requiredCharacterCount": proof.get("requiredCharacterCount"),
            "dynamicSourcesComplete": proof.get("dynamicSourcesComplete"),
            "fallbackChain": proof.get("fallbackChain") or [],
            "reason": opportunity.get("reason"),
        })
    audit_messages = [
        user_facing_text(item.get("message") or item.get("code"))
        for item in [*(audit_warnings or []), *(audit_blockers or [])]
    ]
    return {
        "scope": scope,
        "level": scope_context.get("level") or scope_context.get("levelId") or "当前确认关卡",
        "platforms": scope_context.get("platforms") or ["AppLovin 基线"],
        "targetOs": scope_context.get("targetOs") or "待平台构建时确认",
        "sourceResourceCount": summary["resourceCount"],
        "includedResourceCount": sum(item["classification"] in {"REQUIRED", "CONDITIONAL"} for item in items),
        "notPackagedCount": summary["excludeCount"],
        "optimizedResourceCount": summary["optimizeCount"],
        "unchangedResourceCount": summary["keepCount"],
        "needsDecisionCount": summary["needsDecisionCount"],
        "sourceFilesWillBeDeleted": False,
        "sourceFilesWillBeOverwritten": False,
        "platformPackageBuilt": False,
        "externalServicesUsed": any(item.get("action") == "TINIFY_SHRINK" for item in items),
        "newExternalAssetsUsed": False,
        "estimatedWorksetSavingsBytes": summary["estimatedSavingsBytes"],
        "sizeEstimateNote": "这是源资源工作集估算，不是最终 HTML/ZIP 包大小；平台包需要构建后单独测量。",
        "optimizationGroups": optimization_group_list,
        "excludedGroups": excluded_group_list,
        "primaryRisks": primary_risks,
        "changeSummary": change_summary,
        "estimatedExcludedBytes": sum(record["bytes"] for record in excluded_group_list),
        "estimatedDedupSavingsBytes": sum(
            record["estimatedSavingsBytes"] for record in optimization_group_list if record["action"] == "DEDUP"
        ),
        "estimatedContentSavingsBytes": sum(
            record["estimatedSavingsBytes"] for record in optimization_group_list if record["action"] != "DEDUP"
        ),
        "usesPackageDedup": any(record["action"] == "DEDUP" for record in optimization_group_list),
        "bucketTotals": ledger.get("bucketTotals") or {},
        "topAssets": top_assets,
        "tools": [{"name": item.get("name"), "version": item.get("version")} for item in tools],
        "bucketAudits": bucket_audits,
        "keepReasonDistribution": dict(sorted(keep_reason_distribution.items())),
        "highRiskImageOptimizeCount": sum(
            int(record.get("highRiskOptimizeCount") or 0)
            for bucket, record in bucket_audit.items() if bucket in {"textures", "atlas"}
        ),
        "suppressedImageOpportunityCount": sum(
            int(record.get("suppressedOpportunityCount") or 0)
            for bucket, record in bucket_audit.items() if bucket in {"textures", "atlas"}
        ),
        "auditMessages": audit_messages,
        "fontAudits": font_audits,
        "approvalPhrase": (
            f"确认允许将 {project_label(project_root)} 清单中的候选图片副本上传至 Tinify API 进行隔离试做"
            if any(item.get("action") == "TINIFY_SHRINK" for item in items)
            else f"确认允许试做 {project_label(project_root)} 资源优化提案"
        ),
    }


def render_markdown(plan: dict[str, Any]) -> str:
    user = plan["userSummary"]
    lines = [
        "# 资源优化提案",
        "",
        "> 这一步只决定是否允许在候选目录试做。不会覆盖 playable 工程，也不会删除项目资源。",
        "",
        "## 你先看这五项",
        "",
        f"- 改什么：{'；'.join(user['changeSummary']) if user['changeSummary'] else '不改变资源内容'}；另有 {user['notPackagedCount']} 项仅从本次包排除并继续保留。",
        f"- 预计节省：源资源工作集约 {human_bytes(user['estimatedWorksetSavingsBytes'])}，其中本次不打包 {human_bytes(user['estimatedExcludedBytes'])}、包内去重 {human_bytes(user['estimatedDedupSavingsBytes'])}、资源试做 {human_bytes(user['estimatedContentSavingsBytes'])}；最终 HTML/ZIP 以同链路重建后的实测为准。",
        f"- 主要风险：{'；'.join(user['primaryRisks']) if user['primaryRisks'] else '本轮不改变资源内容，未发现有损处理风险'}。",
        *([f"- 证据异常：{'；'.join(user['auditMessages'])}。尚不能确认对应资源无需优化。"] if user.get("auditMessages") else []),
        "- 是否覆盖：不会。这一步只允许在候选目录试做，工程资源保持不变。",
        "- 失败怎么处理：直接放弃失败候选并回到最近通过版本；此时没有工程回滚，因为工程尚未被覆盖。",
        "",
        "## 范围",
        "",
        f"- 素材/变体：{user['scope']}。",
        f"- 关卡：{user['level']}。",
        f"- 目标平台：{'、'.join(str(item) for item in user['platforms'])}；投放端：{user['targetOs']}。",
        f"- 当前玩法需要：{user['includedResourceCount']} 项资源。",
        f"- 不放进本次包：{user['notPackagedCount']} 项；它们仍保留在项目中，不会被删除。",
        f"- 建议调整：{user['optimizedResourceCount']} 项；其余 {user['unchangedResourceCount']} 项保持不变。",
        "- 这次确认只允许在稳定候选目录试做，不会覆盖 playable 工程资源。",
        "- 本次不打包的资源继续保留在项目中；不会删除、移动、改名或改写。",
        (
            "- 使用 Tinify Developer API；只上传下方明确列出的图片副本并执行默认 shrink，不上传其他资源。"
            if user.get("externalServicesUsed")
            else "- 不上传在线压缩、云转码或远程 AI 服务。"
        ),
        "- 不引入新的外部贴图、模型、音频、字体或配置。",
        "- 当前还没有生成任何平台包。",
        "",
        "## 工具与处理环境",
        "",
    ]
    if user.get("externalServicesUsed"):
        lines.append("- 在线候选服务：Tinify Developer API；API Key 只从当前用户配置或 CI 进程秘密读取，不进入计划和报告。")
    if user["tools"]:
        for tool in user["tools"]:
            lines.append(f"- 本地试做工具：{tool.get('name')} / {tool.get('version')}；只离线执行。")
    elif not user.get("externalServicesUsed"):
        lines.append("- 不使用额外转换工具；只运行项目和 Skill 已有脚本。")
    if user["usesPackageDedup"]:
        lines.append("- 包内去重由项目现有资源映射生成链执行；保留逻辑路径，不修改或删除项目文件。")
    lines.extend([
        "",
        "## 优化前资源概览",
        "",
    ])
    for bucket, record in sorted(user["bucketTotals"].items(), key=lambda item: -int(item[1].get("bytes", 0))):
        lines.append(f"- {bucket_label(bucket)}：{record.get('files', 0)} 项，{human_bytes(int(record.get('bytes', 0)))}。")
    lines.extend(["", "### Top 大资源", ""])
    for item in user["topAssets"]:
        lines.append(f"- `{item['path']}`：{human_bytes(item['bytes'])}（{bucket_label(item['bucket'])}）。")
    lines.extend(["", "## 建议试做的资源", ""])
    if user["optimizationGroups"]:
        for group in user["optimizationGroups"]:
            lines.append(f"- {group['group']}（{group['count']} 项）：{group['description']}。")
            lines.append(
                f"  - 预计节省：{human_bytes(group['estimatedSavingsBytes'])} / {group['estimatedSavingsPercent']}%；"
                f"风险：{'；'.join(str(item) for item in group['risks'])}；验证：{'；'.join(str(item) for item in group['validations'])}。"
            )
            for path in group["paths"]:
                lines.append(f"  - `{path}`")
    else:
        lines.append("- 本轮不建议改变任何资源内容。")
    lines.extend(["", "## 各类资源检查结果", ""])
    if user.get("bucketAudits"):
        for record in user["bucketAudits"]:
            lines.append(
                f"- {bucket_label(str(record['bucket']))}：可试做 {record.get('OPTIMIZE', 0)}、保持原文件 {record.get('KEEP', 0)}、"
                f"暂时无法优化 {record.get('UNSUPPORTED', 0)}；"
                f"审计{'完整' if record.get('auditComplete') else '不完整'}。"
            )
        lines.append(f"- 风险较高但仍可试做：{user.get('highRiskImageOptimizeCount', 0)} 张；必须检查整体画面、局部放大、透明背景和真实游戏场景的优化前后对比。")
        lines.append(f"- 明明可以缩小却被保持原样：{user.get('suppressedImageOpportunityCount', 0)} 张；只要不是 0，就不能继续确认。")
    else:
        lines.append("- 历史计划未记录分资源桶审计；只按旧契约读取，不能作为新审计通过。")
    lines.extend(["", "### 为什么这些资源保持原样", ""])
    if user.get("keepReasonDistribution"):
        reason_counts: dict[str, int] = {}
        for rule, count in user["keepReasonDistribution"].items():
            label = keep_reason_label(str(rule))
            reason_counts[label] = reason_counts.get(label, 0) + int(count)
        for label, count in sorted(reason_counts.items()):
            lines.append(f"- {label}：{count} 项。")
    else:
        lines.append("- 没有需要保持原样的已引用资源。")
    if user.get("fontAudits"):
        lines.extend(["", "## 字体逐项结论", ""])
        for font in user["fontAudits"]:
            lines.append(
                f"- `{font['path']}`：{font['decisionLabel']}；用途 {font['roles'] or '未证明'}；"
                f"语言 {font['targetLanguages'] or '未证明'}；字符 {font['requiredCharacterCount'] if font['requiredCharacterCount'] is not None else '未知'}；"
                f"动态来源{'已闭合' if font['dynamicSourcesComplete'] else '未闭合'}；fallback {font['fallbackChain'] or '未证明'}。"
            )
    lines.extend(["", "## 不放进本次包的资源", ""])
    if user["excludedGroups"]:
        for group in user["excludedGroups"]:
            examples = "、".join(group["examples"])
            lines.append(f"- {group['group']}：{group['count']} 项，约 {human_bytes(group['bytes'])}；例如 {examples}。")
        lines.append("- 这些文件只是不进入本次候选包，项目中的原文件全部保留。")
    else:
        lines.append("- 没有资源会从本次包中排除。")
    lines.extend([
        "",
        "## 体积说明",
        "",
        f"- 预计从本次源资源工作集中减少约 {human_bytes(user['estimatedWorksetSavingsBytes'])}。",
        f"- {user['sizeEstimateNote']}",
        "",
        "## 你需要确认什么",
        "",
        "这一步只确认以下两点：",
        "",
        f"1. 同意上述 {user['notPackagedCount']} 项资源不进入本次候选，但继续完整保留在项目中。",
        f"2. 同意在候选目录试做上述 {user['optimizedResourceCount']} 项资源，并在效果不变时才采用候选。",
        "",
        "这次确认不授权覆盖 playable 工程。候选完成后，会再给你一份包含实际收益、优化前后对比和回滚位置的《资源覆盖确认单》。",
        "",
        f"如果全部同意，回复：`{user['approvalPhrase']}`。如果不同意，直接指出要保留或调整的资源即可。",
        "",
    ])
    if plan["blockers"]:
        lines.extend(["## 还不能执行的原因", ""])
        for blocker in plan["blockers"]:
            lines.append(f"- {blocker.get('message') or blocker.get('paths') or blocker['code']}")
        lines.append("")
    return "\n".join(lines)


def render_technical_markdown(plan: dict[str, Any]) -> str:
    summary = plan["summary"]
    lines = [
        "# 资源处理技术账本",
        "",
        "> 本文件供执行、复核和追溯，不作为用户必须阅读的确认界面。",
        "",
        f"- 计划哈希：`{plan['optimizationPlanHash']}`",
        f"- 源资源盘点：{summary['currentBytes']} bytes / {summary['resourceCount']} 项",
        f"- 资源工作集估算：{summary['estimatedBytes']} bytes；估算减少 {summary['estimatedSavingsBytes']} bytes",
        f"- 本地工具：{len(plan['externalDependencies']['tools'])} 项",
    ]
    for tool in plan["externalDependencies"]["tools"]:
        lines.append(
            f"  - {tool.get('name')} / {tool.get('version')} / {tool.get('executable')} / "
            f"license={tool.get('license')} / offline={tool.get('offline')}"
        )
    lines.extend([
        "",
        "### 逐项账本",
        "",
        "| 资源 | 类型 | 引用分类 | 动作 | 精确参数 | 当前 bytes | 预计节省 | 风险/验证 |",
        "|---|---|---|---|---|---:|---:|---|",
    ])
    for item in plan["items"]:
        parameters = json.dumps(item.get("parameters") or {}, ensure_ascii=False, sort_keys=True)
        risk = safe_cell(f"{item.get('risk', '')} / {item.get('validation', '')}")
        lines.append(
            f"| {safe_cell(item['path'])} | {item['bucket']} | {item['classification']} | "
            f"{item['action']} | {safe_cell(parameters)} | {item['currentBytes']} | "
            f"{item['estimatedSavingsBytes']} | {risk} |"
        )
    if plan["blockers"]:
        lines.extend(["", "### 执行前阻塞", ""])
        for blocker in plan["blockers"]:
            lines.append(f"- `{blocker['code']}`：{blocker.get('message') or blocker.get('paths')}")
    lines.append("")
    return "\n".join(lines)


def build_plan(args: argparse.Namespace) -> dict[str, Any]:
    effect = require_object(args.effect_baseline, "playable-effect-baseline-assessment-v1")
    ledger = require_object(args.ledger, "playable-resource-ledger-v2")
    graph = require_object(args.reference_graph, "playable-resource-reference-graph-v1")
    allowlist = require_object(args.allowlist, "playable-resource-allowlist-v1")
    if effect.get("status") != "EFFECT_BASELINE_FROZEN":
        raise ValueError("效果基线尚未固定，不能生成可执行资源优化计划")
    if len({effect.get("projectRoot"), ledger.get("projectRoot"), graph.get("projectRoot"), allowlist.get("projectRoot")}) != 1:
        raise ValueError("效果基线、账本、引用图和白名单不属于同一项目")

    opportunity_audit, opportunity_map = load_opportunity_audit(args.opportunity_audit, args.ledger, args.toolchain)
    if opportunity_audit.get("projectRoot") != ledger.get("projectRoot"):
        raise ValueError("资源机会审计与当前项目不一致")
    action_map = load_actions(args.actions)
    scope_context = load_scope(args.actions)
    known_paths = {item["path"] for item in ledger.get("files", []) if isinstance(item, dict) and isinstance(item.get("path"), str)}
    unknown_actions = sorted(set(action_map) - known_paths)
    if unknown_actions:
        raise ValueError("动作声明包含账本外资源：" + ", ".join(unknown_actions))
    missing_opportunities = sorted(known_paths - set(opportunity_map))
    extra_opportunities = sorted(set(opportunity_map) - known_paths)
    if missing_opportunities or extra_opportunities:
        raise ValueError(
            "资源机会审计与账本集合不一致：缺少 " + ", ".join(missing_opportunities)
            + "；额外 " + ", ".join(extra_opportunities)
        )

    items = []
    blockers = [
        *(allowlist.get("blockers") or []),
        *(opportunity_audit.get("blockers") or []),
    ]
    for resource in ledger.get("files", []):
        declared = action_map.get(resource["path"], {})
        opportunity = opportunity_map[resource["path"]]
        audit_input = opportunity.get("input") or {}
        if audit_input.get("sha256") != resource.get("sha256") or audit_input.get("bytes") != resource.get("bytes"):
            blockers.append({
                "code": "RESOURCE_OPPORTUNITY_AUDIT_DRIFT",
                "message": f"机会审计与当前资源字节不一致：{resource['path']}",
            })
        action = declared.get("action") or default_action(resource)
        explicitly_declared = bool(declared)
        estimated = declared.get("estimatedSavingsBytes")
        if estimated is None:
            estimated = resource["bytes"] if action == "EXCLUDE" else 0
        if not isinstance(estimated, int) or estimated < 0 or estimated > resource["bytes"]:
            raise ValueError(f"预计节省 bytes 无效：{resource['path']}")
        item = {
            "actionId": "resource-" + sha256_object({"path": resource["path"], "action": action})[:12],
            "resourceId": resource["resourceId"],
            "path": resource["path"],
            "bucket": resource["bucket"],
            "classification": resource["classification"],
            "referenceEvidence": resource.get("evidence", []),
            "currentBytes": resource["bytes"],
            "currentSha256": resource["sha256"],
            "action": action,
            "actionSource": "declared" if explicitly_declared else "implicit-unreferenced" if action == "EXCLUDE" else "implicit-blocked",
            "parameters": declared.get("parameters", {}),
            "estimatedSavingsBytes": estimated,
            "risk": declared.get("risk", "无损排除需以引用闭包完整为前提" if action == "EXCLUDE" else "保持现状"),
            "validation": declared.get("validation", "重建后执行资源完整性、运行时与人工保真检查"),
            "rollback": declared.get("rollback", {"sha256": resource["sha256"], "sourcePath": resource["path"]}),
            "source": declared.get("source", "project-owned"),
            "needsDecision": resource["classification"] == "UNKNOWN",
            "opportunityAudit": {
                "decision": opportunity.get("decision"),
                "ruleId": opportunity.get("ruleId"),
                "reason": opportunity.get("reason"),
                "metadata": opportunity.get("metadata"),
                "tool": opportunity.get("tool"),
                "riskProfile": opportunity.get("riskProfile"),
                "riskFeatures": opportunity.get("riskFeatures") or [],
                "transformConstraints": opportunity.get("transformConstraints") or [],
                "opportunityChecks": opportunity.get("opportunityChecks"),
                "coverageProof": opportunity.get("coverageProof"),
                "abRequirements": opportunity.get("abRequirements") or [],
                "pixelSensitive": opportunity.get("pixelSensitive") is True,
                "semanticValidationRequirements": opportunity.get("semanticValidationRequirements") or [],
            },
            "requiredCapability": (opportunity.get("suggestedAction") or {}).get("requiredCapability"),
            "provider": declared.get("provider") or (opportunity.get("suggestedAction") or {}).get("provider"),
            "localFallbackCandidates": opportunity.get("localFallbackCandidates") or [],
        }
        if resource["classification"] in {"REQUIRED", "CONDITIONAL"} and not explicitly_declared:
            blockers.append({
                "code": "RESOURCE_ACTION_UNDECLARED",
                "message": f"已引用资源缺少显式动作：{resource['path']}",
            })
        if resource["classification"] in {"REQUIRED", "CONDITIONAL"} and action == "EXCLUDE":
            blockers.append({
                "code": "REQUIRED_RESOURCE_EXCLUDED",
                "message": f"已引用资源不能从候选载荷排除：{resource['path']}",
            })
        if explicitly_declared and action == "KEEP":
            keep_reason = declared.get("keepReason")
            keep_evidence = declared.get("keepEvidence")
            if not isinstance(keep_reason, str) or not keep_reason.strip() or not isinstance(keep_evidence, list) or not keep_evidence:
                blockers.append({
                    "code": "RESOURCE_KEEP_EVIDENCE_MISSING",
                    "message": f"KEEP 必须提供 keepReason 和 keepEvidence：{resource['path']}",
                })
            else:
                item["keepReason"] = keep_reason.strip()
                item["keepEvidence"] = keep_evidence
        audit_decision = opportunity.get("decision")
        suggested = opportunity.get("suggestedAction") or {}
        if audit_decision == "UNSUPPORTED":
            blockers.append({
                "code": "RESOURCE_OPPORTUNITY_UNSUPPORTED",
                "message": f"机会审计发现尚不能处置的资源：{resource['path']}；{opportunity.get('reason')}",
            })
        elif resource["classification"] in {"REQUIRED", "CONDITIONAL"} and audit_decision == "OPTIMIZE":
            if not explicitly_declared or action == "KEEP":
                blockers.append({
                    "code": "RESOURCE_OPTIMIZATION_OPPORTUNITY_IGNORED",
                    "message": f"已发现可执行优化机会但计划未处置：{resource['path']}；建议 {suggested.get('action')}；{opportunity.get('reason')}",
                })
            elif action != suggested.get("action"):
                blockers.append({
                    "code": "RESOURCE_OPPORTUNITY_ACTION_MISMATCH",
                    "message": f"计划动作与机会审计不一致：{resource['path']} / 计划 {action} / 审计 {suggested.get('action')}",
                })
        elif resource["classification"] in {"REQUIRED", "CONDITIONAL"} and audit_decision == "KEEP" and action not in {"KEEP", "DEDUP"}:
            blockers.append({
                "code": "RESOURCE_ACTION_NOT_AUDITED",
                "message": f"计划包含机会审计未建议的资源变换：{resource['path']} / {action}",
            })
        if item["needsDecision"]:
            blockers.append({"code": "RESOURCE_REFERENCE_UNRESOLVED", "message": resource["path"]})
        if item["bucket"] == "audio" and action == "REENCODE":
            audio_class = item["parameters"].get("audioClass")
            ranges = item["parameters"].get("parameterRanges")
            if audio_class not in {"BGM", "SFX", "VOICE"} or not isinstance(ranges, dict) or not ranges:
                raise ValueError(f"音频重编码必须声明 audioClass 和 parameterRanges：{resource['path']}")
        items.append(item)

    tools = []
    toolchain_ref = None
    if args.toolchain:
        toolchain = load_json(args.toolchain.expanduser().resolve())
        if not isinstance(toolchain, dict) or not isinstance(toolchain.get("tools"), list):
            raise ValueError("工具链声明必须包含 tools 数组")
        tools = toolchain["tools"]
        toolchain_ref = {"path": str(args.toolchain.resolve()), "sha256": sha256_file(args.toolchain.resolve())}
    available_capabilities = {
        capability
        for tool in tools if isinstance(tool, dict)
        for capability in tool.get("capabilities", []) if isinstance(capability, str)
    }
    inferred_capabilities = set(available_capabilities)
    for tool in tools:
        name = str(tool.get("name") or "").lower() if isinstance(tool, dict) else ""
        if name == "ffmpeg":
            inferred_capabilities.update({"audio-reencode", "image-reencode", "image-resize"})
        if name in {"gltf-transform", "gltf_transform"}:
            inferred_capabilities.add("model-simplify")
    for item in items:
        capability = required_capability(item)
        if capability and capability not in inferred_capabilities:
            blockers.append({
                "code": "TOOLCHAIN_MISSING",
                "message": (
                    f"{item['path']} 暂时缺少用于{capability_label(capability)}的本地工具；已暂停对应候选。"
                    "请按项目文档或工具官方说明安装；不安装会保持原文件但无法完成该项优化。"
                    "安装后重新执行当前运行的工具发现和版本、路径、SHA-256 验签即可继续。"
                    "本流程不会自动安装，也不会使用在线服务"
                ),
            })

    current_bytes = ledger["totalBytes"]
    estimated_savings = sum(item["estimatedSavingsBytes"] for item in items)
    summary = {
        "resourceCount": len(items),
        "currentBytes": current_bytes,
        "estimatedBytes": current_bytes - estimated_savings,
        "estimatedSavingsBytes": estimated_savings,
        "excludeCount": sum(item["action"] == "EXCLUDE" for item in items),
        "optimizeCount": sum(item["action"] not in {"KEEP", "EXCLUDE"} for item in items),
        "keepCount": sum(item["action"] == "KEEP" for item in items),
        "needsDecisionCount": sum(item["needsDecision"] for item in items),
        "resourceResultIntent": (
            "optimized"
            if any(item["action"] in {"TINIFY_SHRINK", "RESIZE", "REENCODE", "SIMPLIFY", "REPACK_ATLAS", "SUBSET_FONT", "PRUNE_CONFIG"} for item in items)
            else "package-only"
            if any(item["action"] in {"EXCLUDE", "DEDUP"} for item in items)
            else "unchanged-explicitly-approved"
        ),
    }
    plan_core = {
        "schemaVersion": "playable-resource-optimization-plan-v1",
        "auditContractVersion": (
            "per-resource-v2"
            if (opportunity_audit.get("compatibility") or {}).get("usageEvidenceMode") == "per-resource-v2"
            else "legacy-read-only"
        ),
        "projectRoot": ledger["projectRoot"],
        "variant": ledger.get("variant"),
        "effectFingerprint": effect["effectFingerprint"],
        "inputs": {
            "effectBaseline": {"path": str(args.effect_baseline.resolve()), "sha256": sha256_file(args.effect_baseline.resolve())},
            "ledger": {"path": str(args.ledger.resolve()), "sha256": sha256_file(args.ledger.resolve())},
            "referenceGraph": {"path": str(args.reference_graph.resolve()), "sha256": sha256_file(args.reference_graph.resolve())},
            "allowlist": {"path": str(args.allowlist.resolve()), "sha256": sha256_file(args.allowlist.resolve())},
            "opportunityAudit": {"path": str(args.opportunity_audit.resolve()), "sha256": sha256_file(args.opportunity_audit.resolve()), "auditHash": opportunity_audit.get("auditHash")},
            "toolchain": toolchain_ref,
        },
        "externalDependencies": {
            "externalAssetPolicy": "DENY_EXTERNAL_ASSETS",
            "externalAssetCount": 0,
            "networkPolicy": "TINIFY_ALLOWLIST_ONLY" if any(item["action"] == "TINIFY_SHRINK" for item in items) else "DENY",
            "remoteServices": ([{
                "provider": "tinify", "service": "Tinify Developer API", "operation": "shrink",
                "runtimeDependency": False,
            }] if any(item["action"] == "TINIFY_SHRINK" for item in items) else []),
            "tools": tools,
        },
        "items": items,
        "bucketAudit": opportunity_audit.get("bucketAudit") or {},
        "auditWarnings": opportunity_audit.get("warnings") or [],
        "summary": summary,
        "userSummary": build_user_summary(
            items,
            summary,
            ledger.get("variant"),
            ledger.get("projectRoot"),
            ledger,
            scope_context,
            tools,
            bucket_audit=opportunity_audit.get("bucketAudit") or {},
            audit_blockers=opportunity_audit.get("blockers") or [],
            audit_warnings=opportunity_audit.get("warnings") or [],
        ),
        "blockers": blockers,
    }
    plan = dict(plan_core)
    plan["generatedAt"] = utc_now()
    plan["optimizationPlanHash"] = "sha256:" + sha256_object(plan_core)
    return plan


def main() -> int:
    args = parse_args()
    try:
        plan = build_plan(args)
        write_json_atomic(args.json_out, plan)
        md_path = args.md_out.expanduser().resolve()
        md_path.parent.mkdir(parents=True, exist_ok=True)
        md_path.write_text(render_markdown(plan), encoding="utf-8")
        technical_path = args.technical_md_out.expanduser().resolve() if args.technical_md_out else None
        if technical_path:
            technical_path.parent.mkdir(parents=True, exist_ok=True)
            technical_path.write_text(render_technical_markdown(plan), encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({
        "ok": True,
        "userConclusion": "资源优化提案已生成：确认后只在候选目录试做，不覆盖工程；本次不打包的资源继续保留在项目中",
        "optimizationPlanHash": plan["optimizationPlanHash"],
        "json": str(args.json_out.resolve()),
        "markdown": str(args.md_out.resolve()),
        "technicalMarkdown": str(technical_path) if technical_path else None,
        "blockers": plan["blockers"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
