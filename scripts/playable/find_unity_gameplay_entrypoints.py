#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path


SCRIPT_EXTENSIONS = {".cs"}
REFERENCE_EXTENSIONS = {".unity", ".prefab", ".asset"}
CONFIG_EXTENSIONS = {".json", ".csv", ".tsv", ".txt", ".yaml", ".yml"}

PATH_KEYWORD_WEIGHTS = {
    "scripts": 6,
    "game": 6,
    "gameplay": 8,
    "runtime": 8,
    "rule": 7,
    "level": 7,
    "manager": 5,
    "controller": 5,
    "board": 4,
    "queue": 4,
    "grid": 4,
    "vehicle": 4,
    "worker": 4,
    "bus": 4,
    "car": 3,
    "puzzle": 3,
    "fail": 3,
    "guide": 2,
}

VENDOR_PATH_PARTS = {
    "third",
    "thirdparty",
    "plugin",
    "plugins",
    "demo",
    "demos",
    "sample",
    "samples",
    "example",
    "examples",
}

SUPPORT_PATH_PARTS = {
    "editor",
    "framework",
    "localization",
}

GAMEPLAY_PATH_HINTS = {
    "game",
    "gameplay",
    "runtime",
    "rule",
    "level",
    "actor",
    "queue",
    "vehicle",
    "worker",
    "board",
    "grid",
    "puzzle",
}

GAMEPLAY_SIGNAL_HINTS = {
    "win",
    "fail",
    "input",
    "level",
    "rule",
}

CONTENT_SIGNALS = {
    "win": r"\b(win|clear|success)\b",
    "fail": r"\b(fail|lose|gameover|timeout)\b",
    "input": r"\b(click|tap|drag|swipe|pointer|touch)\b",
    "state": r"\b(state|status|phase|step)\b",
    "config": r"\b(config|table|csv|json|data)\b",
    "level": r"\b(level|stage|scene)\b",
    "rule": r"\b(rule|limit|constraint|condition)\b",
}

SCENE_SCRIPT_PATTERN = re.compile(r"m_Script:\s*\{fileID:\s*11500000,\s*guid:\s*([0-9a-f]{32})", re.I)
GUID_PATTERN = re.compile(r"guid:\s*([0-9a-f]{32})", re.I)
CLASS_PATTERN = re.compile(r"\bclass\s+([A-Za-z_][A-Za-z0-9_]*)")
METHOD_PATTERN = re.compile(
    r"\b(?:public|private|protected|internal)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_][A-Za-z0-9_<>\[\],?.]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\("
)


@dataclass
class ScriptCandidate:
    path: Path
    score: float
    classes: list[str]
    methods: list[str]
    scene_refs: int
    prefab_refs: int
    asset_refs: int
    signals: list[str]
    ref_examples: list[str]


def slug_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower())


def relative_to(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def has_path_part(path: Path, parts: set[str]) -> bool:
    return any(part.lower() in parts for part in path.parts)


def is_vendor_path(path: Path) -> bool:
    return has_path_part(path, VENDOR_PATH_PARTS)


def is_support_path(path: Path) -> bool:
    return has_path_part(path, SUPPORT_PATH_PARTS)


def gameplay_priority(path: Path, assets_root: Path, signals: list[str], scene_refs: int) -> tuple[int, int]:
    relative = path.relative_to(assets_root)
    path_text = slug_text(relative.as_posix())
    path_hits = sum(1 for hint in GAMEPLAY_PATH_HINTS if hint in path_text)
    signal_hits = sum(1 for hint in GAMEPLAY_SIGNAL_HINTS if hint in signals)
    return path_hits + signal_hits, scene_refs


def load_meta_guid_map(root: Path) -> dict[str, Path]:
    guid_to_asset: dict[str, Path] = {}
    for meta_path in root.rglob("*.meta"):
        asset_path = meta_path.with_suffix("")
        if not asset_path.exists():
            continue
        try:
            text = meta_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        match = re.search(r"^guid:\s*([0-9a-f]{32})\s*$", text, re.M | re.I)
        if match:
            guid_to_asset[match.group(1).lower()] = asset_path
    return guid_to_asset


def collect_script_references(
    assets_root: Path,
    guid_to_asset: dict[str, Path],
) -> tuple[dict[Path, Counter[str]], dict[Path, list[str]], Counter[Path]]:
    reference_counts: dict[Path, Counter[str]] = defaultdict(Counter)
    reference_examples: dict[Path, list[str]] = defaultdict(list)
    file_signal_counts: Counter[Path] = Counter()

    for path in assets_root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in REFERENCE_EXTENSIONS:
            continue
        relative = path.relative_to(assets_root)
        if is_vendor_path(relative) or is_support_path(relative):
            continue
        kind = {
            ".unity": "scene",
            ".prefab": "prefab",
            ".asset": "asset",
        }[path.suffix.lower()]
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        guids = SCENE_SCRIPT_PATTERN.findall(text)
        file_signal_counts[path] = len(guids)
        for guid in guids:
            asset_path = guid_to_asset.get(guid.lower())
            if not asset_path or asset_path.suffix.lower() not in SCRIPT_EXTENSIONS:
                continue
            reference_counts[asset_path][kind] += 1
            if len(reference_examples[asset_path]) < 4:
                reference_examples[asset_path].append(path.as_posix())
    return reference_counts, reference_examples, file_signal_counts


def collect_config_candidates(assets_root: Path) -> list[tuple[float, Path, list[str]]]:
    candidates: list[tuple[float, Path, list[str]]] = []
    for path in assets_root.rglob("*"):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        relative = path.relative_to(assets_root)
        if is_vendor_path(relative) or is_support_path(relative):
            continue
        path_text = slug_text(relative.as_posix())
        if suffix not in CONFIG_EXTENSIONS and "config" not in path_text and "table" not in path_text:
            continue
        score = 0.0
        hits: list[str] = []
        for keyword, weight in PATH_KEYWORD_WEIGHTS.items():
            if keyword in path_text:
                score += weight
                hits.append(keyword)
        if suffix in CONFIG_EXTENSIONS:
            score += 2
        if score <= 0:
            continue
        candidates.append((score, path, sorted(set(hits))))
    candidates.sort(key=lambda item: (-item[0], item[1].as_posix()))
    return candidates[:20]


def score_script(
    path: Path,
    assets_root: Path,
    text: str,
    references: Counter[str],
) -> tuple[float, list[str]]:
    score = 0.0
    hits: list[str] = []
    relative = path.relative_to(assets_root)
    path_text = slug_text(relative.as_posix())

    for keyword, weight in PATH_KEYWORD_WEIGHTS.items():
        if keyword in path_text:
            score += weight
            hits.append(keyword)

    if relative.parts and relative.parts[0].lower() == "scripts":
        score += 10
        hits.append("first-party")

    for signal, pattern in CONTENT_SIGNALS.items():
        count = len(re.findall(pattern, text, re.I))
        if count:
            score += min(count, 8) * 1.2
            hits.append(signal)

    scene_refs = references.get("scene", 0)
    prefab_refs = references.get("prefab", 0)
    asset_refs = references.get("asset", 0)
    score += math.log1p(scene_refs) * 18
    score += math.log1p(prefab_refs) * 6
    score += math.log1p(asset_refs) * 4

    if is_vendor_path(relative):
        score -= 60
    if is_support_path(relative):
        score -= 24

    score += min(len(CLASS_PATTERN.findall(text)), 4)
    score += math.log(max(1, len(text)), 10)
    return score, sorted(set(hits))


def build_report(unity_root: Path, output_path: Path) -> None:
    assets_root = unity_root / "Assets"
    if not assets_root.exists():
        raise SystemExit(f"Missing Assets directory: {assets_root}")

    guid_to_asset = load_meta_guid_map(assets_root)
    reference_counts, reference_examples, file_signal_counts = collect_script_references(assets_root, guid_to_asset)
    config_candidates = collect_config_candidates(assets_root)

    scripts: list[ScriptCandidate] = []
    for script_path in assets_root.rglob("*.cs"):
        try:
            text = script_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        references = reference_counts.get(script_path, Counter())
        score, signals = score_script(script_path, assets_root, text, references)
        if score <= 0:
            continue
        classes = CLASS_PATTERN.findall(text)[:4]
        methods = [name for name in METHOD_PATTERN.findall(text) if name not in classes][:8]
        scripts.append(
            ScriptCandidate(
                path=script_path,
                score=score,
                classes=classes,
                methods=methods[:5],
                scene_refs=references.get("scene", 0),
                prefab_refs=references.get("prefab", 0),
                asset_refs=references.get("asset", 0),
                signals=signals,
                ref_examples=reference_examples.get(script_path, []),
            )
        )

    scripts.sort(key=lambda item: (-item.score, item.path.as_posix()))

    scene_files = [
        (count, path)
        for path, count in file_signal_counts.items()
        if path.suffix.lower() == ".unity" and count > 0
    ]
    scene_files.sort(key=lambda item: (-item[0], item[1].as_posix()))

    prefab_files = [
        (count, path)
        for path, count in file_signal_counts.items()
        if path.suffix.lower() == ".prefab" and count > 0
    ]
    prefab_files.sort(key=lambda item: (-item[0], item[1].as_posix()))

    report_source = [
        item
        for item in scripts
        if not is_vendor_path(item.path.relative_to(assets_root))
        and not is_support_path(item.path.relative_to(assets_root))
    ]
    if not report_source:
        report_source = scripts

    report_scripts = sorted(
        report_source,
        key=lambda item: (
            -gameplay_priority(item.path, assets_root, item.signals, item.scene_refs)[0],
            -gameplay_priority(item.path, assets_root, item.signals, item.scene_refs)[1],
            -item.score,
            item.path.as_posix(),
        ),
    )

    lines: list[str] = []
    lines.append("# Unity Gameplay Entrypoint Report")
    lines.append("")
    lines.append(f"- Unity root: `{unity_root}`")
    lines.append(f"- Assets root: `{assets_root}`")
    lines.append(f"- Script files scanned: `{sum(1 for _ in assets_root.rglob('*.cs'))}`")
    lines.append(f"- Scene files scanned: `{sum(1 for _ in assets_root.rglob('*.unity'))}`")
    lines.append(f"- Prefab files scanned: `{sum(1 for _ in assets_root.rglob('*.prefab'))}`")
    lines.append("")
    lines.append("## Recommended Reading Order")
    lines.append("")
    lines.append("1. Read the top gameplay script candidates below.")
    lines.append("2. Open the scenes and prefabs that reference those scripts.")
    lines.append("3. Open the config files near `Config`, `Level`, `Table`, `Data` paths.")
    lines.append("4. Do not auto-copy art assets from Unity at this stage.")
    lines.append("")
    lines.append("## Top Gameplay Script Candidates")
    lines.append("")
    lines.append("| Rank | Score | Scene refs | Prefab refs | Script | Classes | Signals |")
    lines.append("| --- | ---: | ---: | ---: | --- | --- | --- |")
    for index, item in enumerate(report_scripts[:20], start=1):
        lines.append(
            f"| {index} | {item.score:.1f} | {item.scene_refs} | {item.prefab_refs} | "
            f"`{relative_to(item.path, unity_root)}` | `{', '.join(item.classes) or '-'}` | "
            f"`{', '.join(item.signals[:5]) or '-'}` |"
        )

    lines.append("")
    lines.append("## Script Notes")
    lines.append("")
    for item in report_scripts[:12]:
        lines.append(f"### `{relative_to(item.path, unity_root)}`")
        if item.methods:
            lines.append(f"- Methods: `{', '.join(item.methods)}`")
        lines.append(
            f"- References: scene `{item.scene_refs}`, prefab `{item.prefab_refs}`, asset `{item.asset_refs}`"
        )
        if item.ref_examples:
            lines.append("- Referenced by:")
            for example in item.ref_examples[:3]:
                lines.append(f"  - `{Path(example).relative_to(unity_root).as_posix()}`")
        lines.append("")

    lines.append("## Scene Candidates")
    lines.append("")
    for count, path in scene_files[:12]:
        lines.append(f"- `{relative_to(path, unity_root)}`: `{count}` script refs")
    lines.append("")

    lines.append("## Prefab Candidates")
    lines.append("")
    for count, path in prefab_files[:12]:
        lines.append(f"- `{relative_to(path, unity_root)}`: `{count}` script refs")
    lines.append("")

    lines.append("## Config Candidates")
    lines.append("")
    for score, path, hits in config_candidates:
        lines.append(f"- `{relative_to(path, unity_root)}`: score `{score:.1f}`, signals `{', '.join(hits) or '-'}`")
    lines.append("")

    lines.append("## Next Manual Steps")
    lines.append("")
    lines.append("- Confirm the exact gameplay loop from the top-ranked scripts and scenes.")
    lines.append("- Write the extracted rules into `docs/01-core-rules.md` before building the playable runtime.")
    lines.append("- Ask collaborators to copy required art assets and config tables into the standalone playable project.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan a Unity project and report likely gameplay entrypoints.")
    parser.add_argument("--unity-root", required=True, help="Absolute path to the Unity project root.")
    parser.add_argument("--output", required=True, help="Where to write the markdown report.")
    args = parser.parse_args()

    unity_root = Path(args.unity_root).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    build_report(unity_root, output_path)
    print(f"[OK] Wrote report: {output_path}")


if __name__ == "__main__":
    main()
