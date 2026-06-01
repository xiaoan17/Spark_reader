#!/usr/bin/env python3
"""
MinerU 开放 API 端到端验证脚本(Phase 0 spike)
流程:申请预签名上传链接 -> PUT 上传 -> 轮询 batch 结果 -> 下载解压 zip -> 解析 middle.json

用法: python3 scripts/mineru_e2e.py "0_book/财富公式.pdf"
token 从项目根 .env 的 MINERU_API_TOKEN 读取(不硬编码)。
"""
import os
import sys
import time
import json
import zipfile
import io
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
HOST = "https://mineru.net"


def load_token() -> str:
    env = ROOT / ".env"
    token = os.environ.get("MINERU_API_TOKEN", "")
    if not token and env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line.startswith("MINERU_API_TOKEN="):
                token = line.split("=", 1)[1].strip()
                break
    if not token:
        sys.exit("✗ 未找到 MINERU_API_TOKEN(检查 .env)")
    return token


def main():
    pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "0_book/财富公式.pdf"
    if not pdf_path.is_absolute():
        pdf_path = ROOT / pdf_path
    if not pdf_path.exists():
        sys.exit(f"✗ 文件不存在: {pdf_path}")

    token = load_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    name = pdf_path.name

    print(f"== 文件: {name} ({pdf_path.stat().st_size/1024:.0f} KB) ==\n")

    # 1. 申请预签名上传链接
    print("[1/5] 申请预签名上传链接 POST /api/v4/file-urls/batch ...")
    payload = {
        "enable_formula": True,
        "enable_table": True,
        "language": "ch",
        "model_version": "vlm",
        "files": [{"name": name, "is_ocr": False, "data_id": "fortune-formula-test"}],
    }
    r = requests.post(f"{HOST}/api/v4/file-urls/batch", headers=headers, json=payload, timeout=30)
    print(f"    HTTP {r.status_code}")
    data = r.json()
    print(f"    resp: {json.dumps(data, ensure_ascii=False)[:300]}")
    if data.get("code") != 0:
        sys.exit(f"✗ 申请失败: {data}")
    batch_id = data["data"]["batch_id"]
    upload_url = data["data"]["file_urls"][0]
    print(f"    batch_id = {batch_id}\n")

    # 2. PUT 上传文件(无需 Content-Type 头)
    print("[2/5] PUT 上传文件 ...")
    with open(pdf_path, "rb") as f:
        up = requests.put(upload_url, data=f, timeout=120)
    print(f"    HTTP {up.status_code}")
    if up.status_code not in (200, 201):
        sys.exit(f"✗ 上传失败: {up.text[:300]}")
    print("    上传成功,系统自动开始解析\n")

    # 3. 轮询结果
    print("[3/5] 轮询 GET /api/v4/extract-results/batch/{batch_id} ...")
    full_zip_url = None
    poll_headers = {"Authorization": f"Bearer {token}"}
    interval, waited = 3, 0
    while waited < 600:
        time.sleep(interval)
        waited += interval
        rr = requests.get(f"{HOST}/api/v4/extract-results/batch/{batch_id}", headers=poll_headers, timeout=30)
        rd = rr.json()
        results = rd.get("data", {}).get("extract_result", [])
        if not results:
            print(f"    [{waited}s] 等待中... {json.dumps(rd, ensure_ascii=False)[:200]}")
            continue
        res = results[0]
        state = res.get("state")
        prog = res.get("extract_progress", {})
        ptxt = f" {prog.get('extracted_pages','?')}/{prog.get('total_pages','?')}页" if prog else ""
        print(f"    [{waited}s] state={state}{ptxt}")
        if state == "done":
            full_zip_url = res.get("full_zip_url")
            break
        if state == "failed":
            sys.exit(f"✗ 解析失败: {res.get('err_msg')}")
        interval = min(interval + 2, 10)
    if not full_zip_url:
        sys.exit("✗ 轮询超时")
    print(f"    full_zip_url = {full_zip_url}\n")

    # 4. 下载并解压
    print("[4/5] 下载并解压结果 zip ...")
    z = requests.get(full_zip_url, timeout=120)
    out_dir = ROOT / "data" / "mineru_out" / pdf_path.stem
    out_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
        zf.extractall(out_dir)
        names = zf.namelist()
    print(f"    解压到: {out_dir}")
    print(f"    文件: {names}\n")

    # 5. 解析 middle.json,打印 bbox + page_size(框选锚点命脉)
    print("[5/5] 解析 middle.json 坐标 ...")
    middle = next((out_dir / n for n in names if n.endswith("middle.json") or n.endswith("layout.json")), None)
    if not middle or not middle.exists():
        # 兜底:目录里找
        cand = list(out_dir.rglob("*middle.json")) + list(out_dir.rglob("*layout.json"))
        middle = cand[0] if cand else None
    if not middle:
        print("    ⚠ 未找到 middle.json/layout.json,列出所有 json:")
        for j in out_dir.rglob("*.json"):
            print(f"      {j.relative_to(out_dir)}")
        return
    mj = json.loads(middle.read_text())
    print(f"    backend = {mj.get('_backend')}, version = {mj.get('_version_name')}")
    pages = mj.get("pdf_info", [])
    print(f"    页数 = {len(pages)}")
    for pi, page in enumerate(pages[:2]):
        psize = page.get("page_size")
        blocks = page.get("para_blocks") or page.get("preproc_blocks") or []
        print(f"\n    --- 第{page.get('page_idx', pi)}页 page_size={psize} 块数={len(blocks)} ---")
        for b in blocks[:4]:
            bbox = b.get("bbox")
            btype = b.get("type")
            norm = None
            if bbox and psize:
                norm = [round(bbox[0]/psize[0],3), round(bbox[1]/psize[1],3),
                        round(bbox[2]/psize[0],3), round(bbox[3]/psize[1],3)]
            # 取点文本预览
            txt = ""
            for line in (b.get("lines") or [])[:1]:
                for span in (line.get("spans") or [])[:2]:
                    txt += span.get("content", "")
            print(f"      type={btype} bbox={bbox}")
            print(f"        归一化={norm}  文本={repr(txt[:40])}")
    print("\n✓ 端到端验证完成")


if __name__ == "__main__":
    main()
