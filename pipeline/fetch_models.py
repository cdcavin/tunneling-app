"""Copy the pose model files from Hugging Face into R2 so the app serves them from its own address.

    models/<repo>/<file>   e.g. models/onnx-community/vitpose-base-simple/onnx/model_fp16.onnx
"""
import os, sys, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sync import r2, BUCKET

REPO = "onnx-community/vitpose-base-simple"
FILES = ["config.json", "preprocessor_config.json", "onnx/model_fp16.onnx", "onnx/model_q4f16.onnx", "onnx/model_int8.onnx"]

s3 = r2()
for f in FILES:
    url = f"https://huggingface.co/{REPO}/resolve/main/{f}"
    path = f"/tmp/{f.replace('/', '_')}"
    urllib.request.urlretrieve(url, path)
    size = os.path.getsize(path)
    ctype = "application/json" if f.endswith(".json") else "application/octet-stream"
    s3.upload_file(path, BUCKET, f"models/{REPO}/{f}", ExtraArgs={"ContentType": ctype, "CacheControl": "public, max-age=31536000, immutable"})
    print(f"uploaded models/{REPO}/{f} ({size / 1e6:.1f} MB)")
