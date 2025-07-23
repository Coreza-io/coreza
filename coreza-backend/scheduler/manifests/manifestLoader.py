import glob
import json
from typing import Dict

_manifest_cache: Dict[str, dict] = {}

def load_manifests(path: str = './server/manifests') -> Dict[str, dict]:
    global _manifest_cache
    if _manifest_cache:
        return _manifest_cache
    for file in glob.glob(f"{path}/*.json"):
        data = json.load(open(file))
        _manifest_cache[data['name']] = data
    return _manifest_cache