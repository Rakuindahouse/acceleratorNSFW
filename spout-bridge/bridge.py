"""NSFWaccelerator Spout bridge

Spout の映像をブラウザのアプリ (NSFWaccelerator) に渡し、
アプリの映像を Spout で送り出すための小さな中継アプリ。

  ブラウザ  <-- WebSocket (ws://127.0.0.1:8790) -->  このアプリ  <-- Spout -->  Resolume / TouchDesigner など

プロトコル
  テキスト(JSON)
    アプリ -> ブラウザ : {"type":"hello"}, {"type":"senders","list":[...]}
    ブラウザ -> アプリ : {"type":"subscribe","slot":n,"name":"送信名","maxWidth":1280}
                         {"type":"unsubscribe","slot":n}
                         {"type":"output","enabled":true,"name":"NSFWaccelerator","flip":false}
  バイナリ
    アプリ -> ブラウザ : [1][slot] + JPEG     （受信した Spout の映像）
    ブラウザ -> アプリ : [2] + JPEG           （Spout で送り出す映像）

起動オプション
  --test   Spout の代わりにテスト映像を流す（Spout が無い環境での動作確認用）
  --port   待ち受けポート（既定 8790）
"""

import argparse
import asyncio
import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import simplejpeg
from websockets.asyncio.server import serve

GL_RGBA = 0x1908
VERSION = 1


# --------------------------------------------------------------------------- 画像
def downscale(arr, max_width):
    """横幅が max_width 以下になるよう整数倍で縮小（2倍は平均、それ以上は間引き）"""
    h, w = arr.shape[:2]
    f = max(1, math.ceil(w / max_width)) if max_width else 1
    if f == 1:
        return arr
    if f == 2:
        h2, w2 = h // 2 * 2, w // 2 * 2
        a = arr[:h2, :w2].astype(np.uint16)
        return ((a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) >> 2).astype(np.uint8)
    return arr[::f, ::f]


def encode(rgba, w, h, max_width, quality=85):
    arr = np.frombuffer(rgba, dtype=np.uint8).reshape(h, w, 4)
    arr = np.ascontiguousarray(downscale(arr, max_width))
    return simplejpeg.encode_jpeg(arr, quality=quality, colorspace="RGBA", colorsubsampling="420", fastdct=True)


# --------------------------------------------------------------------------- Spout 側
class SpoutBackend:
    """本物の Spout（Windows）。全部の Spout 呼び出しを1つのスレッドで行う"""

    def __init__(self):
        import SpoutGL  # noqa: WPS433 (Windows 専用)

        self.SpoutGL = SpoutGL
        self.lister = None

    def start(self):
        self.lister = self.SpoutGL.SpoutReceiver()
        try:
            self.lister.createOpenGL()  # 隠し OpenGL コンテキスト
        except Exception:  # noqa: BLE001
            pass

    def senders(self):
        try:
            return [s for s in self.lister.getSenderList() if s]
        except Exception:  # noqa: BLE001
            return []

    def open_receiver(self, name):
        r = self.SpoutGL.SpoutReceiver()
        r.setReceiverName(name)
        return {"r": r, "buf": None, "w": 0, "h": 0}

    def receive(self, rx):
        """新しいフレームがあれば (bytes, w, h) を返す"""
        r = rx["r"]
        ok = r.receiveImage(rx["buf"], GL_RGBA, False, 0)
        if r.isUpdated():
            rx["w"], rx["h"] = r.getSenderWidth(), r.getSenderHeight()
            rx["buf"] = bytearray(rx["w"] * rx["h"] * 4)
            return None
        if not ok or rx["buf"] is None or rx["w"] == 0:
            return None
        try:
            if r.isFrameCountEnabled() and not r.isFrameNew():
                return None
        except Exception:  # noqa: BLE001
            pass
        return bytes(rx["buf"]), rx["w"], rx["h"]

    def close_receiver(self, rx):
        try:
            rx["r"].releaseReceiver()
        except Exception:  # noqa: BLE001
            pass

    def open_sender(self, name):
        s = self.SpoutGL.SpoutSender()
        s.setSenderName(name)
        return s

    def send(self, s, rgba, w, h, flip):
        s.sendImage(rgba, w, h, GL_RGBA, flip, 0)

    def close_sender(self, s):
        try:
            s.releaseSender()
        except Exception:  # noqa: BLE001
            pass


class TestBackend:
    """Spout が無い環境用のテスト映像"""

    names = ["TEST 1", "TEST 2", "TEST 3", "TEST 4"]

    def start(self):
        self.t0 = time.time()
        self.sent = {}

    def senders(self):
        return self.names + [f"(受信中) {n}" for n in self.sent]

    def open_receiver(self, name):
        return {"name": name, "i": self.names.index(name) if name in self.names else 0, "last": 0}

    def receive(self, rx):
        now = time.time()
        if now - rx["last"] < 1 / 30:
            return None
        rx["last"] = now
        w, h = 640, 360
        t = now - self.t0
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        hue = rx["i"] / 4
        v = 0.5 + 0.5 * np.sin(x / 40 + t * 2 + rx["i"]) * np.cos(y / 30 - t)
        img = np.zeros((h, w, 4), np.uint8)
        img[..., 0] = (v * 255 * (0.3 + hue)).clip(0, 255)
        img[..., 1] = (v * 120).clip(0, 255)
        img[..., 2] = (255 - v * 200 * hue).clip(0, 255)
        img[..., 3] = 255
        bar = int((t * 120) % w)
        img[:, bar : bar + 12, :3] = 255  # 動いている確認用の白い帯
        img[:40, : 60 * (rx["i"] + 1), :3] = 255  # 番号（左上の白い四角の長さ）
        return img.tobytes(), w, h

    def close_receiver(self, rx):
        pass

    def open_sender(self, name):
        self.sent[name] = 0
        return name

    def send(self, s, rgba, w, h, flip):
        self.sent[s] += 1

    def close_sender(self, s):
        self.sent.pop(s, None)


# --------------------------------------------------------------------------- 中継
class Bridge:
    def __init__(self, backend):
        self.backend = backend
        self.lock = threading.Lock()
        self.subs = {}  # (client_id, slot) -> dict
        self.out = {"enabled": False, "name": "NSFWaccelerator", "flip": False, "frame": None, "sender": None, "cur_name": None}
        self.sender_list = []
        self.pool = ThreadPoolExecutor(max_workers=4)
        self.clients = {}  # client_id -> Client
        self.loop = None
        self.stats = {"in": 0, "out": 0}
        self._closing = []
        self.out_img = None  # 展開済みの送信フレーム (bytes, w, h)
        self.out_decoding = False

    # ブラウザ側から呼ばれる（asyncio スレッド）
    def subscribe(self, cid, slot, name, max_width):
        with self.lock:
            old = self.subs.get((cid, slot))
            self.subs[(cid, slot)] = {"name": name, "max_width": max_width, "rx": None, "busy": False, "close": old}

    def unsubscribe(self, cid, slot):
        with self.lock:
            sub = self.subs.pop((cid, slot), None)
            if sub:
                self._closing.append(sub)

    def drop_client(self, cid):
        with self.lock:
            for key in [k for k in self.subs if k[0] == cid]:
                self._closing.append(self.subs.pop(key))
            if self.out.get("owner") == cid:
                self.out["enabled"] = False

    def set_output(self, cid, enabled, name, flip):
        with self.lock:
            self.out.update(enabled=enabled, name=name or "NSFWaccelerator", flip=bool(flip), owner=cid)

    def push_output(self, jpeg):
        with self.lock:
            self.out["frame"] = jpeg

    # Spout スレッド
    def run(self):
        self.backend.start()
        last_list = last_stat = time.time()
        while True:
            now = time.time()
            if now - last_stat >= 5:
                n_in, n_out = self.stats["in"], self.stats["out"]
                self.stats["in"] = self.stats["out"] = 0
                if n_in or n_out:
                    dt = now - last_stat
                    print(f"受信 {n_in / dt:5.1f} fps（{len(self.subs)} 本） / 送信 {n_out / dt:5.1f} fps")
                last_stat = now
            if now - last_list > 1:
                last_list = now
                names = self.backend.senders()
                own = self.out["cur_name"]
                self.sender_list = [n for n in names if n != own]
                self.broadcast({"type": "senders", "list": self.sender_list})

            with self.lock:
                subs = list(self.subs.items())
                closing, self._closing = self._closing, []
                out = dict(self.out)
                self.out["frame"] = None

            for sub in closing:
                if sub and sub.get("rx"):
                    self.backend.close_receiver(sub["rx"])
            for key, sub in subs:
                if sub.get("close") and sub["close"].get("rx"):
                    self.backend.close_receiver(sub["close"]["rx"])
                    sub["close"] = None
                if sub["rx"] is None:
                    sub["rx"] = self.backend.open_receiver(sub["name"])
                if sub["busy"]:
                    continue
                try:
                    got = self.backend.receive(sub["rx"])
                except Exception as e:  # noqa: BLE001
                    print("受信エラー:", sub["name"], e)
                    got = None
                if got:
                    sub["busy"] = True
                    self.pool.submit(self._encode_and_send, key, sub, *got)

            self._output(out)
            time.sleep(0.004)

    def _output(self, out):
        if out["enabled"]:
            if out["sender"] is None or out["cur_name"] != out["name"]:
                if out["sender"] is not None:
                    self.backend.close_sender(out["sender"])
                s = self.backend.open_sender(out["name"])
                with self.lock:
                    self.out["sender"], self.out["cur_name"] = s, out["name"]
                out["sender"] = s
                print(f"Spout 出力開始: {out['name']}")
            if out["frame"] is not None:
                if self.out_decoding:
                    with self.lock:  # 展開中なら最新フレームを取っておく
                        if self.out["frame"] is None:
                            self.out["frame"] = out["frame"]
                else:
                    self.out_decoding = True
                    self.pool.submit(self._decode_output, out["frame"])
            img, self.out_img = self.out_img, None
            if img is not None:
                try:
                    self.backend.send(out["sender"], img[0], img[1], img[2], out["flip"])
                    self.stats["out"] += 1
                except Exception as e:  # noqa: BLE001
                    print("送信エラー:", e)
        elif out["sender"] is not None:
            self.backend.close_sender(out["sender"])
            with self.lock:
                self.out["sender"], self.out["cur_name"] = None, None
            print("Spout 出力停止")

    def _decode_output(self, jpeg):
        try:
            img = simplejpeg.decode_jpeg(jpeg, colorspace="RGBA", fastdct=True, fastupsample=True)
            h, w = img.shape[:2]
            self.out_img = (img.tobytes(), w, h)
        except Exception as e:  # noqa: BLE001
            print("展開エラー:", e)
        finally:
            self.out_decoding = False

    def _encode_and_send(self, key, sub, rgba, w, h):
        try:
            jpeg = encode(rgba, w, h, sub["max_width"])
            client = self.clients.get(key[0])
            if client and self.loop:
                self.loop.call_soon_threadsafe(client.offer, key[1], jpeg)
                self.stats["in"] += 1
        except Exception as e:  # noqa: BLE001
            print("変換エラー:", e)
        finally:
            sub["busy"] = False

    def broadcast(self, msg):
        if not self.loop:
            return
        text = json.dumps(msg, ensure_ascii=False)
        for c in list(self.clients.values()):
            self.loop.call_soon_threadsafe(c.offer_text, text)


class Client:
    """ブラウザ1つ分。スロットごとに最新フレームだけを送る（遅いときは古いフレームを捨てる）"""

    def __init__(self, ws):
        self.ws = ws
        self.frames = {}
        self.texts = []
        self.event = asyncio.Event()

    def offer(self, slot, jpeg):
        self.frames[slot] = jpeg
        self.event.set()

    def offer_text(self, text):
        self.texts.append(text)
        self.event.set()

    async def pump(self):
        while True:
            await self.event.wait()
            self.event.clear()
            while self.texts:
                await self.ws.send(self.texts.pop(0))
            frames, self.frames = self.frames, {}
            for slot, jpeg in frames.items():
                await self.ws.send(bytes([1, slot & 255]) + jpeg)


async def main_async(bridge, port):
    bridge.loop = asyncio.get_running_loop()
    next_id = [0]

    async def handler(ws):
        next_id[0] += 1
        cid = next_id[0]
        client = Client(ws)
        bridge.clients[cid] = client
        print(f"アプリが接続しました (#{cid})")
        await ws.send(json.dumps({"type": "hello", "version": VERSION}))
        await ws.send(json.dumps({"type": "senders", "list": bridge.sender_list}, ensure_ascii=False))
        pump = asyncio.create_task(client.pump())
        try:
            async for msg in ws:
                if isinstance(msg, bytes):
                    if msg and msg[0] == 2:
                        bridge.push_output(msg[1:])
                    continue
                data = json.loads(msg)
                t = data.get("type")
                if t == "subscribe":
                    bridge.subscribe(cid, int(data["slot"]), data["name"], int(data.get("maxWidth") or 1280))
                    print(f"受信開始: {data['name']}")
                elif t == "unsubscribe":
                    bridge.unsubscribe(cid, int(data["slot"]))
                elif t == "output":
                    bridge.set_output(cid, bool(data.get("enabled")), data.get("name"), data.get("flip"))
        except Exception as e:  # noqa: BLE001
            print("接続エラー:", e)
        finally:
            pump.cancel()
            bridge.clients.pop(cid, None)
            bridge.drop_client(cid)
            print(f"アプリが切断しました (#{cid})")

    async with serve(handler, "127.0.0.1", port, max_size=None, compression=None, ping_interval=None) as server:
        print(f"待機中: ws://127.0.0.1:{port}")
        print("このウィンドウは開いたままにして、アプリの「Spout」ボタンを押してください。")
        await server.serve_forever()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="Spout の代わりにテスト映像を流す")
    ap.add_argument("--port", type=int, default=8790)
    args = ap.parse_args()

    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    print("NSFWaccelerator Spout bridge")
    if args.test:
        backend = TestBackend()
        print("テストモード（Spout の代わりにテスト映像）")
    else:
        try:
            backend = SpoutBackend()
        except Exception as e:  # noqa: BLE001
            print("Spout を読み込めませんでした:", e)
            print("テストモードで起動します。")
            backend = TestBackend()

    bridge = Bridge(backend)
    threading.Thread(target=bridge.run, daemon=True).start()
    try:
        asyncio.run(main_async(bridge, args.port))
    except OSError as e:
        print("起動できませんでした（すでに起動していませんか？）:", e)
        input("Enter で閉じます")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
