import os
import sys

# Set BASE_DIR to graphin_backend, which contains 'function'
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, BASE_DIR)

from function import alpaca  # <-- should work now!
# or, dynamically:
import importlib
module = importlib.import_module("function.alpaca")
print(module)
