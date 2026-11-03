"""CI 用：起動した受信アプリにつないで、応答と Spout の読み込みを確認する"""
import asyncio
import json
import sys

from websockets.asyncio.client import connect


async def main():
    async with connect("ws://127.0.0.1:8790", max_size=None) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), 10))
        senders = json.loads(await asyncio.wait_for(ws.recv(), 10))
        print("hello:", hello)
        print("senders:", senders)
        assert hello["type"] == "hello" and senders["type"] == "senders"


asyncio.run(main())
log = open(sys.argv[1], encoding="utf-8", errors="replace").read() if len(sys.argv) > 1 else ""
print(log)
if "テストモード" in log:
    sys.exit("Spout を読み込めず、テストモードになっています")
