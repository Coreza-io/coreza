import { resultSuccess, resultFailure, safeErrorDetails } from "../contracts/nodeResult";

/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { variableSnapshots } from "../variables/VariableSnapshotService";
import { isTypedEditFieldRow } from "../nodes/logic/typedEditFieldRow";
import express from "express";
import { ComparatorService, ComparatorInput } from "../nodes/logic/comparator";
import { ComputeService } from "../nodes/logic/compute";
import { requireAuth } from "../middleware/jwtAuth";
import { applyFieldRows, stagePersistentFields, EditFieldError } from "../nodes/logic/editFields";

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// If/Then conditional logic with logicalOp support
router.post("/if", async (req, res) => {
  try {
    const { conditions, logicalOps } = req.body;

    // Validate presence and types
    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json(resultFailure("conditions array is required", { data: { received: { conditions, logicalOps } } }));
    }

    // Evaluate each condition using ComparatorService
    const results: boolean[] = [];
    for (const condition of conditions) {
      const { left, operator, right, dataType } = condition;
      if (left === undefined || operator == null || right === undefined) {
        return res.status(400).json(resultFailure("Each condition must have left, operator, and right", { data: { invalidCondition: condition } }));
      }

      const conditionInput: ComparatorInput = {
        left,
        operator,
        right,
        dataType: dataType || "any",
      };
      const result = await ComparatorService.evaluate(conditionInput);

      if (result.status === "error") {
        return res.status(400).json(resultFailure("Failed to evaluate condition", { data: { invalidCondition: condition }, details: safeErrorDetails({ ...safeErrorDetails((result.error)) }) }));
      }

      if (result.data !== undefined) {
        results.push(result.data);
      }
    }

    // Combine results based on logicalOp
    const passed = results.reduce(
      (acc, cur, i) => {
        if (i === 0) return cur; // seed with the first result
        const op = logicalOps[i - 1];
        if (op === "AND") return acc && cur;
        if (op === "OR") return acc || cur;
        throw new Error(`Unsupported logical operator: ${op}`);
      },
      undefined as unknown as boolean,
    );

    res.json(resultSuccess({
        true: passed,
        false: !passed,
      }));
  } catch (error) {
    console.error("If condition evaluation error:", error);
    res.status(500).json(resultFailure("Failed to evaluate conditions", { data: null, details: safeErrorDetails({ ...safeErrorDetails((error instanceof Error ? error.message : String(error))) }) }));
  }
});

// Switch case routing logic using ComparatorService
router.post("/switch", async (req, res) => {
  try {
    const { cases = [], defaultCase = "fallback" } = req.body;
    if (!Array.isArray(cases)) {
      return res.status(400).json(resultFailure("cases must be an array", { data: { received: { cases } } }));
    }

    if (cases.length === 0) {
      return res.json(resultSuccess(defaultCase));
    }

    for (const caseItem of cases) {
      const leftValue = caseItem.left;
      const rightValue = caseItem.right;

      if (leftValue === undefined || rightValue === undefined) {
        return res.status(400).json(resultFailure("Each case must include left, operator, and right values", { data: { invalidCase: caseItem } }));
      }
    }

    // Transform cases to ComparatorService format
    const serviceCases = cases.map((caseItem, idx) => ({
      condition: {
        left: caseItem.left,
        operator: caseItem.operator,
        right: caseItem.right,
        dataType: caseItem.dataType,
      } as ComparatorInput,
      value: caseItem.outputName,
    }));

    // Use ComparatorService to evaluate switch
    const result = await ComparatorService.executeSwitch(
      serviceCases,
      defaultCase,
    );

    if (result.status === "error") {
      return res.status(500).json(resultFailure("Failed to evaluate switch cases", { data: null, details: safeErrorDetails({ ...safeErrorDetails((result.error)) }) }));
    }

    res.json(resultSuccess(result.data));
  } catch (error) {
    console.error("Switch case evaluation error:", error);
    res.status(500).json(resultFailure("Failed to evaluate switch cases", { data: null, details: safeErrorDetails({ ...safeErrorDetails((error instanceof Error ? error.message : String(error))) }) }));
  }
});

// Field manipulation endpoint
router.post("/field", async (req, res) => {
  try {
    const { fields = [], data = {}, persistent, expressionContext } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json(resultFailure("fields must be an array", { data: { received: { fields } } }));
    }

    if (
      expressionContext !== undefined &&
      (!expressionContext ||
        typeof expressionContext !== "object" ||
        Array.isArray(expressionContext))
    )
      return res
        .status(400)
        .json(resultFailure("expressionContext must be an object", { data: null }));
    const nodeResults = expressionContext?.nodeResults;
    const nodeIdentities = expressionContext?.nodeIdentities;
    const expressionResults = expressionContext?.expressionResults;
    const expressionContexts = expressionContext?.expressionContexts;
    if (expressionContexts !== undefined && (!expressionContexts || typeof expressionContexts !== "object" || Array.isArray(expressionContexts) || Object.keys(expressionContexts).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= fields.length)))
      return res.status(400).json(resultFailure("expressionContext.expressionContexts must contain valid row indexes", { data: null }));
    if (expressionResults !== undefined && (!expressionResults || typeof expressionResults !== "object" || Array.isArray(expressionResults)))
      return res.status(400).json(resultFailure("expressionContext.expressionResults must be an object", { data: null }));
    if (
      nodeResults !== undefined &&
      (!nodeResults ||
        typeof nodeResults !== "object" ||
        Array.isArray(nodeResults))
    )
      return res
        .status(400)
        .json(resultFailure("expressionContext.nodeResults must be an object", { data: null }));
    if (nodeIdentities !== undefined && (!Array.isArray(nodeIdentities) || nodeIdentities.length > 10_000))
      return res
        .status(400)
        .json(resultFailure("expressionContext.nodeIdentities must be an array", { data: null }));
    if (
      Array.isArray(nodeIdentities) &&
      !nodeIdentities.every(
        (identity) =>
          identity !== null &&
          typeof identity === "object" &&
          !Array.isArray(identity) &&
          typeof identity.id === "string" &&
          (identity.displayName === undefined || typeof identity.displayName === "string") &&
          (identity.data === undefined || (identity.data && typeof identity.data === "object" && Object.keys(identity.data).every(key => key === "title") && typeof identity.data.title === "string")) &&
          (identity.name === undefined || typeof identity.name === "string") &&
          (identity.label === undefined || typeof identity.label === "string"),
      )
    )
      return res.status(400).json(resultFailure("expressionContext.nodeIdentities contains an invalid identity", { data: null }));
    const safeNodeResults = nodeResults
      ? Object.fromEntries(Object.entries(nodeResults))
      : {};
    const safeNodeIdentities = Array.isArray(nodeIdentities)
      ? nodeIdentities.map(({ id, name, label, displayName, data }) => ({ id, name, label, displayName, data }))
      : [];
    const options = {
      nodeId:
        typeof req.body.node_id === "string" ? req.body.node_id : undefined,
      input: data,
      legacyResultSeed: { ...data },
      context: {
        persistent: !!persistent,
        $vars: res.locals.variables,
        $nodes: safeNodeResults,
        expressionOutputs: expressionResults ? Object.fromEntries(Object.entries(expressionResults)) : safeNodeResults,
        expressionContexts,
        nodes: safeNodeIdentities,
      },
    };
    let result: Record<string, unknown>;
    let variableSnapshot;
    let persistentVariableKeys: string[] | undefined;
    if (persistent === true && fields.some(isTypedEditFieldRow)) {
      const staged = stagePersistentFields(fields, options);
      if (!res.locals.variableSnapshot || !req.user?.id) throw new Error("Persistent variable snapshot unavailable");
      if (typeof req.body.variableInvocationId !== "string" || !/^[0-9a-f-]{36}$/i.test(req.body.variableInvocationId))
        return res.status(400).json(resultFailure("Persistent Edit execution requires an invocation ID", { data: null }));
      variableSnapshot = await variableSnapshots.commit(res.locals.variableSnapshot, staged.changes, req.body.variableInvocationId);
      result = staged.result;
      persistentVariableKeys = staged.changes.map(change => change.key);
    } else result = applyFieldRows(fields, options);
    res.json({
      ...resultSuccess(result, persistentVariableKeys ? { meta: { persistentVariableKeys } } : {}),
      ...(variableSnapshot ? { variableSnapshot } : {}),
    });
  } catch (error) {
    console.error("Field manipulation failed");
    res.status((error as any).statusCode ?? (error instanceof EditFieldError ? 400 : 503)).json(resultFailure(
      error instanceof Error ? error.message : "Failed to process field operations",
      { details: safeErrorDetails({ code: (error as any)?.code, reason: error instanceof Error ? error.message : String(error) }) },
    ));
  }
});

// Generic compute operations
router.post("/compute", async (req, res) => {
  try {
    const {
      value,
      operator,
      arg1,
      arg2,
      filterOperator,
      unit,
      date2,
      timezone,
      inputFormat,
      outputFormat,
      customOutputFormat,
      regexFlags,
      targetDay,
      mapSubOperation,
      mapIndex,
      extremeDirection,
      extremeReturn,
    } = req.body;

    if (operator == null) {
      return res.status(400).json(resultFailure("operator is required", { data: { received: { value, operator } } }));
    }

    const result = ComputeService.compute({
      value,
      operator,
      arg1,
      arg2,
      filterOperator,
      unit,
      date2,
      timezone,
      inputFormat,
      outputFormat,
      customOutputFormat,
      regexFlags,
      targetDay,
      mapSubOperation,
      mapIndex,
      extremeDirection,
      extremeReturn,
    });
    if (result.status === "error") {
      return res.status(400).json(resultFailure(result.error ?? "Node operation failed", { data: null }));
    }

    res.json(result);
  } catch (error) {
    console.error("Compute operation error:", error);
    res.status(500).json(resultFailure("Failed to perform compute operation", { data: null, details: safeErrorDetails({ ...safeErrorDetails((error instanceof Error ? error.message : String(error))) }) }));
  }
});

export default router;
