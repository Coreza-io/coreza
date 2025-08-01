import express from 'express';
import { ComparatorService, ComparatorInput } from '../services/comparator';
import { MathService } from '../services/math';
import { TransformService } from '../services/transform';

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
    const { conditions = [], data = {}, persistent, context } = req.body;

    if (!Array.isArray(conditions)) {
      return res.status(400).json({
        error: 'fields must be an array',
        received: { conditions }
      });
    }

    let result = { ...data };
    const persistentContext = context; // Context passed from WorkflowEngine

    // Process each field operation
    for (const field of conditions) {
      const { left: fieldName, operator, right: value } = field;

      if (!fieldName) {
        continue; // Skip empty field names
      }

      switch (operator) {
        case 'set':
          if (persistent && persistentContext) {
            // Handle persistent field - get current value or use new value
            const currentPersistentValue = persistentContext.getPersistentValue(fieldName);
            const finalValue = currentPersistentValue !== undefined ? currentPersistentValue : value;
            
            // Set the persistent value and save to DB
            await persistentContext.setPersistentValue(fieldName, finalValue);
            
            // Also set in result for immediate use in current execution
            result[fieldName] = finalValue;
            
            console.log(`💾 Persistent field ${fieldName} set to:`, finalValue);
          } else {
            // Regular non-persistent field
            result[fieldName] = value;
          }
          break;

        case 'copy':
          // Copy value from another field
          if (value && result[value] !== undefined) {
            if (persistent && persistentContext) {
              await persistentContext.setPersistentValue(fieldName, result[value]);
            }
            result[fieldName] = result[value];
          }
          break;

        case 'remove':
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
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Field manipulation error:', error);
    res.status(500).json({
      error: 'Failed to process field operations',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Simple math operations
router.post('/math', async (req, res) => {
  try {
    const { left, operator, right } = req.body;
    if (left === undefined || operator == null || right === undefined) {
      return res.status(400).json({
        error: 'left, operator and right are required',
        received: { left, operator, right }
      });
    }

    const result = MathService.calculate({ left, operator, right });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ result: result.result });
  } catch (error) {
    console.error('Math operation error:', error);
    res.status(500).json({
      error: 'Failed to perform math operation',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Generic transform operations
router.post('/transform', async (req, res) => {
  try {
    const { value, operator, arg1, arg2 } = req.body;

    if (value === undefined || operator == null) {
      return res.status(400).json({
        error: 'value and operator are required',
        received: { value, operator }
      });
    }

    const result = TransformService.transform({ value, operator, arg1, arg2 });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ result: result.result });
  } catch (error) {
    console.error('Transform operation error:', error);
    res.status(500).json({
      error: 'Failed to perform transform operation',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
