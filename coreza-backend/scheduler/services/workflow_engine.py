# === workflow_engine.py ===
from scheduler.manifests.manifestLoader import load_manifests
from scheduler.utils.resolve_references import resolve_references
from config.supabaseClient import supabase
from function.indicator import indicator_map
import json
import requests
import traceback
import os
from urllib.parse import urljoin
import importlib
from datetime import datetime
import uuid
from enum import Enum
import sys

#import pdb; pdb.set_trace()
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, BASE_DIR)
MANIFESTS_DIR = os.path.join(BASE_DIR, "scheduler", "manifests")
MANIFESTS_DIR = os.path.abspath(MANIFESTS_DIR)  # resolve to absolute path

_module_cache = {}

def make_json_serializable(obj):
    if isinstance(obj, dict):
        return {k: make_json_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [make_json_serializable(i) for i in obj]
    elif isinstance(obj, uuid.UUID):
        return str(obj)
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, Enum):
        return obj.value
    else:
        return obj

def find_handler(module_path, func_name):
    key = (module_path, func_name)
    if key in _module_cache:
        return _module_cache[key]
    try:
        mod = importlib.import_module(module_path)
        handler = getattr(mod, func_name, None)
        if handler:
            _module_cache[key] = handler
            return handler
    except ImportError:
        pass
    return None


def execute_workflow(workflow_id: str, run_id: str):
    # Load workflow definition
    #import pdb; pdb.set_trace()
    res = supabase.table('workflows')\
        .select('*')\
        .eq('id', workflow_id)\
        .single()\
        .execute()
    if not res.data:
        print(f"[ERROR] Workflow not found: {workflow_id}")
        return
    wf = res.data

    # Nodes & edges may already be lists or JSON
    nodes = wf['nodes'] if isinstance(wf['nodes'], list) else json.loads(wf['nodes'])
    edges = wf['edges'] if isinstance(wf['edges'], list) else json.loads(wf['edges'])
    user_id = wf['user_id']
    order = topological_sort(nodes, edges)
    context = {}
    manifests = load_manifests(MANIFESTS_DIR)

    for node in order:
        if node['type'] == 'Scheduler':
            print(f"[WorkflowEngine] Skipping trigger node {node['id']}")
            continue
        manifest = manifests.get(node['type'])
        if not manifest:
            print(f"[ERROR] Manifest not found for node type: {node['type']}")
            continue

        try:
            #import pdb; pdb.set_trace()
            inputs = {k: resolve_references(v, context, node) for k, v in node['values'].items()}
            
            print("inputs", inputs)
            inputs['user_id'] = user_id
            inputs['credential_id'] = node.get('values').get('credential_id')
            status = 'running'
            # Log node execution to DB
            exec_res = (
                supabase.table("node_executions")
                .insert({
                    "run_id": run_id,
                    "node_id": node["id"],
                    "status": status,
                    "input_payload": inputs
                })
                .execute()
            )
            if not exec_res.data:
                print("[ERROR] Failed to insert node execution row:")
            result = execute_node(node, manifest, inputs)
            print("result", result)
            status = 'success'
            #output = result.get('output', {})
        except Exception as e:
            status = 'failed'
            result = {'error': str(e), 'trace': traceback.format_exc()}

        # Log node execution to DB
        update_res = (
            supabase.table("node_executions")
            .update({
                "status": status,
                "output_payload": make_json_serializable(result),
                "finished_at": datetime.utcnow().isoformat()
            })
            .eq("run_id", run_id)
            .eq("node_id", node["id"])
            .execute()
        )

        if not update_res.data:
            print("[ERROR] Failed to insert node execution row:")

        if status == 'success':
            context[node['id']] = result
        else:
            print(f"[ERROR] Node {node['id']} failed, stopping workflow.")
            break


def topological_sort(nodes, edges):
    graph = {node['id']: [] for node in nodes}
    indegree = {node['id']: 0 for node in nodes}
    node_map = {node['id']: node for node in nodes}

    for edge in edges:
        source = edge['source']
        target = edge['target']
        graph[source].append(target)
        indegree[target] += 1

    queue = [nid for nid, deg in indegree.items() if deg == 0]
    order = []
    while queue:
        nid = queue.pop(0)
        order.append(node_map[nid])
        for m in graph[nid]:
            indegree[m] -= 1
            if indegree[m] == 0:
                queue.append(m)

    if len(order) != len(nodes):
        print("[ERROR] Cycle detected or invalid workflow DAG")
        raise Exception("Cycle detected or invalid workflow DAG")
    return order


def execute_node(node, manifest, inputs):
    
    action = manifest.get('action', {})
    #import pdb; pdb.set_trace()
    url_template = action.get('url', '')
    method_template = action.get('method', 'GET').upper()

    # 2. Determine operation (if present) and patch url/method
    operation = node.get('values', {}).get('operation')
    endpoint = url_template
    method = method_template

    if operation:
        # Find operation config from manifest
        op_field = next((f for f in manifest.get('fields', []) if f['key'] == 'operation'), None)
        op_option = None
        if op_field:
            op_option = next((opt for opt in op_field['options'] if opt['id'] == operation), None)
        if op_option:
            method = op_option.get('method', method_template).upper()
            endpoint = url_template.replace("{{operation}}", operation)
        else:
            endpoint = url_template
            method = method_template
    else:
        endpoint = url_template
        method = method_template

    # 3. Substitute any additional fields in the endpoint if needed (handle {{param}} etc.)
    if '{' in endpoint and '}' in endpoint:
        endpoint = endpoint.format(**inputs)

    # 4. Now, either dispatch to a Python function, or call the endpoint (API)
    # Example: For "/alpaca/get_account", call local function get_account(inputs)
    handler = None
    if endpoint.startswith('/'):
        op_func = endpoint.lstrip('/').replace('/', '_')
        parts = op_func.split("_", 1) 
        # e.g. /alpaca/get_account -> alpaca_get_account
        # Try to find the function in a local alpaca.py module
        if len(parts) >= 2:
            service, func_name = parts
            entry = indicator_map.get(func_name.lower(), func_name)
            module_name = f"function.{service}"
            
            # Case 1: mapping found (entry is dict)
            if isinstance(entry, dict) and 'func' in entry:
                handler = entry['func']
            else:
                # Case 2: not mapped, dynamic lookup in module
                handler_func = entry + "_func" if isinstance(entry, str) else func_name + "_func"
                try:
                    #import pdb; pdb.set_trace()
                    module = importlib.import_module(module_name)
                    handler = getattr(module, handler_func, None)
                except Exception as e:
                    handler = None

            if handler:
                
                return handler(inputs)
            else:
                return {"status": "error", "output": f"No handler for {op_func}"}

    


    # Built-in nodes
    if node["type"] == "IfNode":
        cond = inputs.get("condition")
        return {"status": "success", "output": {"result": inputs.get("onTrue") if cond else inputs.get("onFalse")}}

    if node["type"] == "Scheduler":
        from datetime import datetime
        return {"status": "success", "output": {"scheduled_at": datetime.utcnow().isoformat()}}

    return {"status": "success", "output": {}}
