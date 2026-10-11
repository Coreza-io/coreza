import { compileNodeFieldValues, FieldExpressionError } from "../nodes/logic/fieldExpression";
import { getNodeFields } from "../nodes/nodeDefinitions";
import { pickTypedJsonSource } from "../nodes/logic/typedExpressionContext";
/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import express from "express";
import { ComparatorService, ComparatorInput } from "../nodes/logic/comparator";
import { ComputeService } from "../nodes/logic/compute";
import { requireAuth } from "../middleware/jwtAuth";
import { applyFieldRows, EditFieldError } from "../nodes/logic/editFields";

const router = express.Router();

// Apply JWT authentication to all routes
router.use(requireAuth);

// If/Then conditional logic with logicalOp support
router.post("/if", async (req, res) => {
  try {
    const { conditions, logicalOps } = req.body;

    // Validate presence and types
    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json({
        error: "conditions array is required",
        received: { conditions, logicalOps },
      });
    }

    // Evaluate each condition using ComparatorService
    const results: boolean[] = [];
    for (const condition of conditions) {
      const { left, operator, right, dataType } = condition;
      if (left === undefined || operator == null || right === undefined) {
        return res.status(400).json({
          error: "Each condition must have left, operator, and right",
          invalidCondition: condition,
        });
      }

      const conditionInput: ComparatorInput = {
        left,
        operator,
        right,
        dataType: dataType || "any",
      };
      const result = await ComparatorService.evaluate(conditionInput);

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to evaluate condition",
          details: result.error,
          invalidCondition: condition,
        });
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

    res.json({
      success: true,
      data: {
        true: passed,
        false: !passed,
      },
    });
  } catch (error) {
    console.error("If condition evaluation error:", error);
    res.status(500).json({
      error: "Failed to evaluate conditions",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Switch case routing logic using ComparatorService
router.post("/switch", async (req, res) => {
  try {
    const { cases = [], defaultCase = "fallback" } = req.body;
    if (!Array.isArray(cases)) {
      return res.status(400).json({
        error: "cases must be an array",
        received: { cases },
      });
    }

    if (cases.length === 0) {
      return res.json({
        success: true,
        data: defaultCase,
      });
    }

    for (const caseItem of cases) {
      const leftValue = caseItem.left;
      const rightValue = caseItem.right;

      if (leftValue === undefined || rightValue === undefined) {
        return res.status(400).json({
          error: "Each case must include left, operator, and right values",
          invalidCase: caseItem,
        });
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

    if (!result.success) {
      return res.status(500).json({
        error: "Failed to evaluate switch cases",
        details: result.error,
      });
    }

    res.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Switch case evaluation error:", error);
    res.status(500).json({
      error: "Failed to evaluate switch cases",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// Field manipulation endpoint
router.post("/field", async (req, res) => {
  try {
    const { fields = [], data = {}, persistent, expressionContext } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({
        error: "fields must be an array",
        received: { fields },
      });
    }

    if (
      expressionContext !== undefined &&
      (!expressionContext ||
        typeof expressionContext !== "object" ||
        Array.isArray(expressionContext))
    )
      return res
        .status(400)
        .json({ error: "expressionContext must be an object" });
    const nodeResults = expressionContext?.nodeResults;
    const nodeIdentities = expressionContext?.nodeIdentities;
    const expressionResults = expressionContext?.expressionResults;
    const expressionContexts = expressionContext?.expressionContexts;
    if (expressionContexts !== undefined && (!expressionContexts || typeof expressionContexts !== "object" || Array.isArray(expressionContexts) || Object.keys(expressionContexts).some(key => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= fields.length)))
      return res.status(400).json({ error: "expressionContext.expressionContexts must contain valid row indexes" });
    if (expressionResults !== undefined && (!expressionResults || typeof expressionResults !== "object" || Array.isArray(expressionResults)))
      return res.status(400).json({ error: "expressionContext.expressionResults must be an object" });
    if (
      nodeResults !== undefined &&
      (!nodeResults ||
        typeof nodeResults !== "object" ||
        Array.isArray(nodeResults))
    )
      return res
        .status(400)
        .json({ error: "expressionContext.nodeResults must be an object" });
    if (nodeIdentities !== undefined && (!Array.isArray(nodeIdentities) || nodeIdentities.length > 10_000))
      return res
        .status(400)
        .json({ error: "expressionContext.nodeIdentities must be an array" });
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
      return res.status(400).json({
        error: "expressionContext.nodeIdentities contains an invalid identity",
      });
    const safeNodeResults = nodeResults
      ? Object.fromEntries(Object.entries(nodeResults))
      : {};
    const safeNodeIdentities = Array.isArray(nodeIdentities)
      ? nodeIdentities.map(({ id, name, label, displayName, data }) => ({ id, name, label, displayName, data }))
      : [];
    const rawContract = fields.some((row: any) => row?.expression_format_version === 1);
    const fieldContexts = expressionContext?.fieldContexts;
    if (fieldContexts !== undefined && (!fieldContexts || typeof fieldContexts !== 'object' || Array.isArray(fieldContexts) || Object.keys(fieldContexts).some(path => {
      if (path === 'persistent') return false;
      const match = /^fields\[(\d+)\]\.(fieldName|dataType|value)$/.exec(path);
      return !match || Number(match[1]) >= fields.length;
    }))) return res.status(400).json({ error: 'expressionContext.fieldContexts must contain valid field paths' });
    const resolved = rawContract ? compileNodeFieldValues({ fields, persistent }, getNodeFields('Edit Fields'), req.body.node_id).resolve({ $json: pickTypedJsonSource(data), $nodes: safeNodeResults, expressionOutputs: expressionResults ?? safeNodeResults, nodes: safeNodeIdentities, fieldContexts }) : undefined;
    const result = applyFieldRows((resolved?.fields ?? fields) as any, {
      nodeId:
        typeof req.body.node_id === "string" ? req.body.node_id : undefined,
      input: data,
      legacyResultSeed: { ...data },
      context: {
        persistent: !!(resolved?.persistent ?? persistent),
        $nodes: safeNodeResults,
        expressionOutputs: expressionResults ? Object.fromEntries(Object.entries(expressionResults)) : safeNodeResults,
        expressionContexts,
        nodes: safeNodeIdentities,
      },
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Field manipulation error:", error);
    res.status(500).json({
      error: "Failed to process field operations",
      details:
        error instanceof EditFieldError || error instanceof FieldExpressionError
          ? { code: error.code, message: error.message, ...error.details }
          : { message: error instanceof Error ? error.message : String(error) },
    });
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
      return res.status(400).json({
        error: "operator is required",
        received: { value, operator },
      });
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
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json(result);
  } catch (error) {
    console.error("Compute operation error:", error);
    res.status(500).json({
      error: "Failed to perform compute operation",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;
