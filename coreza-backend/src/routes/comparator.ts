/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import express from "express";
import { ComparatorService, ComparatorInput } from "../services/comparator";
import { ComputeService } from "../services/compute";
import { requireAuth } from "../middleware/jwtAuth";

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
      const { left, operator, right } = condition;
      if (left === undefined || operator == null || right === undefined) {
        return res.status(400).json({
          error: "Each condition must have left, operator, and right",
          invalidCondition: condition,
        });
      }

      const conditionInput: ComparatorInput = { left, operator, right };
      const result = await ComparatorService.evaluate(conditionInput);

      if (!result.success) {
        return res.status(400).json({
          error: "Failed to evaluate condition",
          details: result.error,
          invalidCondition: condition,
        });
      }

      results.push(result.result);
    }

    // Combine results based on logicalOp
    const passed = results.reduce((acc, cur, i) => {
      if (i === 0) return cur; // seed with the first result
      const op = logicalOps[i - 1];
      if (op === "AND") return acc && cur;
      if (op === "OR") return acc || cur;
      throw new Error(`Unsupported logical operator: ${op}`);
    }, undefined as unknown as boolean);

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
    const { inputValue, cases = [], defaultCase = "default" } = req.body;

    if (inputValue === undefined) {
      return res.status(400).json({
        error: "inputValue is required",
        received: { inputValue, cases, defaultCase },
      });
    }
    if (!Array.isArray(cases)) {
      return res.status(400).json({
        error: "cases must be an array",
        received: { cases },
      });
    }

    // Transform cases to ComparatorService format
    const serviceCases = cases.map((caseItem) => ({
      condition: {
        left: inputValue,
        operator: caseItem.operator || "===",
        right: caseItem.caseValue,
      } as ComparatorInput,
      value: caseItem.caseName ?? caseItem.caseValue,
    }));

    // Use ComparatorService to evaluate switch
    const result = await ComparatorService.executeSwitch(
      serviceCases,
      defaultCase
    );

    if (!result.success) {
      return res.status(500).json({
        error: "Failed to evaluate switch cases",
        details: result.error,
      });
    }

    // Maintain backward compatibility with existing response format
    const matchedCase =
      result.matchedCase !== undefined ? cases[result.matchedCase] : null;

    res.json({
      success: true,
      data: result.result,
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
    const { fields = [], data = {}, persistent, context } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({
        error: "fields must be an array",
        received: { fields },
      });
    }

    let result = { ...data };
    const persistentContext = context; // Context passed from WorkflowEngine

    // Process each field operation
    for (const field of fields) {
      const { left: fieldName, operator, right: value } = field;

      if (!fieldName) {
        continue; // Skip empty field names
      }

      switch (operator) {
        case "set":
          if (persistent && persistentContext) {
            // Handle persistent field - get current value or use new value
            const currentPersistentValue =
              persistentContext.getPersistentValue(fieldName);
            const finalValue = value;

            if (currentPersistentValue !== finalValue) {
              await context.setPersistentValue(fieldName, finalValue); // Save only if changed
            }

            // Also set in result for immediate use in current execution
            result[fieldName] = finalValue;

            console.log(`💾 Persistent field ${fieldName} set to:`, finalValue);
          } else {
            // Regular non-persistent field
            result[fieldName] = value;
          }
          break;

        case "copy":
          // Copy value from another field
          if (value && result[value] !== undefined) {
            if (persistent && persistentContext) {
              await persistentContext.setPersistentValue(
                fieldName,
                result[value]
              );
            }
            result[fieldName] = result[value];
          }
          break;

        case "remove":
          // Remove the field
          if (persistent && persistentContext) {
            await persistentContext.setPersistentValue(fieldName, undefined);
          }
          delete result[fieldName];
          break;

        default:
          console.warn(`Unknown field operator: ${operator}`);
      }
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Field manipulation error:", error);
    res.status(500).json({
      error: "Failed to process field operations",
      details: error instanceof Error ? error.message : String(error),
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
      targetDay,
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
      targetDay,
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

router.post("/loop", (req, res) => {
  try {
    const {
      inputArray,
      batchSize = 1,
      items,
      parallel = false,
      continueOnError = false,
      throttleMs = 200,
    } = req.body;

    // Get the array to loop over
    let arrayData: any[] = [];
    if (inputArray && req.body[inputArray]) {
      arrayData = Array.isArray(req.body[inputArray])
        ? req.body[inputArray]
        : [req.body[inputArray]];
    } else if (Array.isArray(items)) {
      arrayData = items;
    }

    console.log(
      `🔄 Loop processing ${arrayData.length} items with batch size ${batchSize}`
    );

    res.json({
      items: arrayData,
      batchSize,
      totalItems: arrayData.length,
      parallel,
      continueOnError,
      throttleMs,
      isLoopNode: true,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to process loop data" });
  }
});

export default router;
