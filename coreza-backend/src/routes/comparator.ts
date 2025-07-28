import express from 'express';

const router = express.Router();

// Helper function to evaluate a single condition
function evaluateCondition(left: any, operator: string, right: any): boolean {
  // Convert values to appropriate types for comparison
  const leftVal = isNaN(Number(left)) ? left : Number(left);
  const rightVal = isNaN(Number(right)) ? right : Number(right);

  switch (operator) {
    case '===':
    case 'equals':
      return leftVal === rightVal;
    case '!==':
    case 'not equals':
      return leftVal !== rightVal;
    case '>=':
    case 'greater than':
      return Number(leftVal) >= Number(rightVal);
    case '<=':
    case 'less than':
      return Number(leftVal) <= Number(rightVal);
    case '>':
      return Number(leftVal) > Number(rightVal);
    case '<':
      return Number(leftVal) < Number(rightVal);
    default:
      return false;
  }
}

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

    // Evaluate each condition
    const results: boolean[] = [];
    for (const condition of conditions) {
      const { left, operator, right } = condition;
      if (left === undefined || operator == null || right === undefined) {
        return res.status(400).json({
          error: 'Each condition must have left, operator, and right',
          invalidCondition: condition
        });
      }
      results.push(evaluateCondition(left, operator, right));
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

// Switch case routing logic (unchanged)
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

    let matchedCase = null;
    let matchedOutput = defaultCase;

    for (const caseItem of cases) {
      const { caseValue, caseName } = caseItem;
      if (caseValue !== undefined && inputValue === caseValue) {
        matchedCase = caseItem;
        matchedOutput = caseName ?? caseValue;
        break;
      }
    }

    res.json({
      inputValue,
      matchedCase,
      output: matchedOutput,
      isDefault: !matchedCase,
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

export default router;
