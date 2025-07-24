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

// If/Then conditional logic
router.post('/if', async (req, res) => {
  try {
    const { conditions } = req.body;

    if (!conditions || !Array.isArray(conditions)) {
      return res.status(400).json({ 
        error: 'Conditions array is required',
        received: { conditions }
      });
    }

    let allConditionsTrue = true;
    const evaluationResults = [];

    // Evaluate each condition
    for (const condition of conditions) {
      const { left, operator, right } = condition;
      
      if (left === undefined || !operator || right === undefined) {
        return res.status(400).json({ 
          error: 'Each condition must have left, operator, and right values',
          invalidCondition: condition
        });
      }

      const result = evaluateCondition(left, operator, right);
      evaluationResults.push({
        condition: { left, operator, right },
        result
      });

      if (!result) {
        allConditionsTrue = false;
      }
    }

    const outcome = allConditionsTrue ? 'true' : 'false';

    res.json({
      result: outcome,
      allConditionsTrue,
      evaluations: evaluationResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('If condition evaluation error:', error);
    res.status(500).json({ 
      error: 'Failed to evaluate conditions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Switch case routing logic
router.post('/switch', async (req, res) => {
  try {
    const { inputValue, cases = [], defaultCase = 'default' } = req.body;

    if (inputValue === undefined) {
      return res.status(400).json({ 
        error: 'Input value is required',
        received: { inputValue, cases, defaultCase }
      });
    }

    let matchedCase = null;
    let matchedOutput = defaultCase;

    // Check each case for a match
    for (const caseItem of cases) {
      const { caseValue, caseName } = caseItem;
      
      if (caseValue !== undefined && inputValue === caseValue) {
        matchedCase = caseItem;
        matchedOutput = caseName || caseValue;
        break;
      }
    }

    const result = {
      inputValue,
      matchedCase,
      output: matchedOutput,
      isDefault: !matchedCase,
      timestamp: new Date().toISOString()
    };

    res.json(result);

  } catch (error) {
    console.error('Switch case evaluation error:', error);
    res.status(500).json({ 
      error: 'Failed to evaluate switch cases',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;