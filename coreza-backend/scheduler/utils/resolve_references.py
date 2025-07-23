import re
import json
from typing import Any, Dict, List, Union

def parse_path(path: str) -> List[Union[str, int]]:
    """
    Turn a path like "0.candles[1].value" or "['foo'].bar" into a list of keys/indexes.
    Supports negative numbers (e.g. -1, -2) and both dot/bracket notation.
    """
    parts: List[Union[str, int]] = []
    # Matches dot notation keys or bracket notation with numbers or quoted strings
    regex = re.compile(r"([^[.\]]+)|\[(\-?\d+|[\"'][^\"']+[\"'])\]")
    for match in regex.finditer(path):
        dot_key = match.group(1)
        bracket_key = match.group(2)
        if dot_key is not None:
            if re.fullmatch(r"-?\d+", dot_key):
                parts.append(int(dot_key))
            else:
                parts.append(dot_key)
        elif bracket_key is not None:
            if re.fullmatch(r"-?\d+", bracket_key):
                parts.append(int(bracket_key))
            else:
                parts.append(bracket_key[1:-1])
    return parts

def resolve_references(expr: str, context: Dict[str, Any], self_node: str) -> str:
    """
    Replaces {{ $json.x.y }} or {{ $('Node').json.x.y }} templates using a context map.
    :param expr:      The string potentially containing {{ … }} templates.
    :param context:   A lookup of nodeName → its output array (e.g. context['Alpaca'] = [ { symbol:'AAPL', … } ]).
    :param self_node: The name of the current node—for resolving {{ $json… }}.
    :returns:         A new string with all resolvable templates replaced by their values.
    """
    if not isinstance(expr, str) or '{{' not in expr:
        return expr

    # Match either $('NodeName').json or $json, plus the rest of the path
    template_regex = re.compile(r"\{\{\s*(\$\('([^']+)'\)\.json|\$json)(?:\.|\s*)([^\}]+?)\s*\}\}")

    def replacer(match: re.Match) -> str:
        variable = match.group(1)
        node_name = match.group(2)
        raw_path = match.group(3)

        # 1) Determine which node's data we should start with
        if variable.startswith("$('") and node_name:
            data_source = context.get(node_name)
        else:
            data_source = context.get(self_node)
        if data_source is None:
            return match.group(0)

        # 2) Clean and split the path into keys
        clean_path = raw_path.strip()
        clean_path = re.sub(r'^[.\s]+', '', clean_path)
        keys = parse_path(clean_path)

        # 3) Walk the data_source step by step
        result: Any = data_source
        for key in keys:
            if result is None:
                break
            if isinstance(result, list) and isinstance(key, int):
                idx = key if key >= 0 else len(result) + key
                try:
                    result = result[idx]
                except Exception:
                    result = None
            elif isinstance(result, dict):
                result = result.get(key)
            else:
                # wrong type for the next key
                result = None

        # 4) If nothing found, leave the template intact
        if result is None:
            return match.group(0)

        # 5) Otherwise convert to string (JSON.stringify for objects)
        if isinstance(result, (dict, list)):
            return json.dumps(result)
        return str(result)

    return template_regex.sub(replacer, expr)
