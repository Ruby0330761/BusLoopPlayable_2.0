#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


TERMINAL = "__include_whole_value__"


def decode_pointer(pointer: str) -> list[str]:
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise ValueError(f"JSON Pointer 必须以 / 开头：{pointer}")
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def build_trie(pointers: list[str]) -> dict[str, Any]:
    trie: dict[str, Any] = {}
    for pointer in pointers:
        node = trie
        parts = decode_pointer(pointer)
        if not parts:
            node[TERMINAL] = True
            continue
        for part in parts:
            node = node.setdefault(part, {})
        node[TERMINAL] = True
    return trie


def select(value: Any, trie: dict[str, Any], pointer: str = "") -> Any:
    if trie.get(TERMINAL) is True:
        return value
    if isinstance(value, dict):
        result = {}
        for key, child in trie.items():
            if key == TERMINAL:
                continue
            if key not in value:
                raise ValueError(f"引用闭包指向不存在的配置路径：{pointer}/{key}")
            result[key] = select(value[key], child, f"{pointer}/{key}")
        return result
    if isinstance(value, list):
        # 精确裁剪数组会改变索引语义；引用进入数组时保守保留整个数组。
        for key in trie:
            if key == TERMINAL:
                continue
            if not key.isdigit() or int(key) >= len(value):
                raise ValueError(f"引用闭包指向不存在的数组位置：{pointer}/{key}")
        return value
    if trie:
        raise ValueError(f"引用闭包继续进入标量值：{pointer}")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="仅按显式 JSON Pointer 引用闭包生成配置候选")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reachable-pointers-json", required=True)
    args = parser.parse_args()
    try:
        source = args.input.expanduser().resolve()
        output = args.output.expanduser().resolve()
        if source.suffix.lower() != ".json" or not source.is_file():
            raise ValueError("配置闭包执行器当前只接受本地 JSON 文件")
        pointers = json.loads(args.reachable_pointers_json)
        if not isinstance(pointers, list) or not pointers or not all(isinstance(item, str) for item in pointers):
            raise ValueError("reachablePointers 必须是非空 JSON Pointer 数组")
        value = json.loads(source.read_text(encoding="utf-8"))
        candidate = select(value, build_trie(pointers))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(candidate, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "output": str(output), "reachablePointers": pointers}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
