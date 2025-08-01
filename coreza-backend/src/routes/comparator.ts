import express from 'express';
import { ComparatorService, ComparatorInput } from '../services/comparator';

const router = express.Router();

// If/Then conditional logic with logicalOp support
router.post('/if', async (req, res) => {
  try {
    const { conditions, logicalOp = 'AND' } = req.body;

    // Validate presence and types
    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json({
        error: 'conditions array is required',
        received: { conditions, logicalOp }
      });
    }
    if (logicalOp !== 'AND' && logicalOp !== 'OR') {
      return res.status(400).json({
        error: `logicalOp must be 'AND' or 'OR'`,
        received: { logicalOp }
      });
    }

    // Evaluate each condition using ComparatorService
    const results: boolean[] = [];
    for (const condition of conditions) {
      const { left, operator, right } = condition;
      if (left === undefined || operator == null || right === undefined) {
        return res.status(400).json({
          error: 'Each condition must have left, operator, and right',
          invalidCondition: condition
        });
      }
      
      const conditionInput: ComparatorInput = { left, operator, right };
      const result = await ComparatorService.evaluate(conditionInput);
      
      if (!result.success) {
        return res.status(400).json({
          error: 'Failed to evaluate condition',
          details: result.error,
          invalidCondition: condition
        });
      }
      
      results.push(result.result);
    }

    // Combine results based on logicalOp
    const passed =
      logicalOp === 'AND'
        ? results.every(r => r)
        : results.some(r => r);

    // Return same shape as Python version
    res.json({
      true: passed,
      false: !passed
    });

  } catch (error) {
    console.error('If condition evaluation error:', error);
    res.status(500).json({
      error: 'Failed to evaluate conditions',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Switch case routing logic using ComparatorService
router.post('/switch', async (req, res) => {
  try {
    const { inputValue, cases = [], defaultCase = 'default' } = req.body;

    if (inputValue === undefined) {
      return res.status(400).json({
        error: 'inputValue is required',
        received: { inputValue, cases, defaultCase }
      });
    }
    if (!Array.isArray(cases)) {
      return res.status(400).json({
        error: 'cases must be an array',
        received: { cases }
      });
    }

    // Transform cases to ComparatorService format
    const serviceCases = cases.map(caseItem => ({
      condition: {
        left: inputValue,
        operator: '===',
        right: caseItem.caseValue
      } as ComparatorInput,
      value: caseItem.caseName ?? caseItem.caseValue
    }));

    // Use ComparatorService to evaluate switch
    const result = await ComparatorService.executeSwitch(serviceCases, defaultCase);

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to evaluate switch cases',
        details: result.error
      });
    }

    // Maintain backward compatibility with existing response format
    const matchedCase = result.matchedCase !== undefined ? cases[result.matchedCase] : null;
    
    res.json({
      inputValue,
      matchedCase,
      output: result.result,
      isDefault: result.matchedCase === undefined,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Switch case evaluation error:', error);
    res.status(500).json({
      error: 'Failed to evaluate switch cases',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Field manipulation endpoint
router.post('/field', async (req, res) => {
  try {
    const { conditions = [], data = {} } = req.body;

    if (!Array.isArray(conditions)) {
      return res.status(400).json({
        error: 'fields must be an array',
        received: { conditions }
      });
    }

    let result = { ...data };

    // Process each field operation
    for (const field of conditions) {
      const { left: fieldName, operator, right: value } = field;

      if (!fieldName) {
        continue; // Skip empty field names
      }

      switch (operator) {
        case 'set':
          // Set field to a specific value
          result[fieldName] = value;
          break;
          
        default:
          console.warn(`Unknown field operator: ${operator}`);
      }
    }

    res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error('Field manipulation error:', error);
    res.status(500).json({
      error: 'Failed to process field operations',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
