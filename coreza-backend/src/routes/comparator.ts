import express from 'express';
import { ControlFlowExecutor } from '../nodes/executors/ControlFlowExecutor';
import { WorkflowNode, NodeInput } from '../nodes/types';

const router = express.Router();
const controlFlowExecutor = new ControlFlowExecutor();

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

    // Create mock WorkflowNode for If node type
    const mockIfNode: WorkflowNode = {
      id: 'if-route-node',
      type: 'If',
      category: 'Control Flow',
      values: {
        conditions,
        logicalOp
      }
    };

    const mockInput: NodeInput = {};

    // Use ControlFlowExecutor to evaluate conditions
    const result = await controlFlowExecutor.execute(mockIfNode, mockInput);
    
    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to evaluate conditions',
        details: result.error
      });
    }

    // ControlFlowExecutor returns {true: boolean, false: boolean} format
    res.json(result.data);

  } catch (error) {
    console.error('If condition evaluation error:', error);
    res.status(500).json({
      error: 'Failed to evaluate conditions',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Switch case routing logic using ControlFlowExecutor
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

    // Create mock WorkflowNode for Switch node type
    const mockSwitchNode: WorkflowNode = {
      id: 'switch-route-node',
      type: 'Switch',
      category: 'Control Flow',
      values: {
        value: inputValue,
        cases,
        defaultCase
      }
    };

    const mockInput: NodeInput = {};

    // Use ControlFlowExecutor to evaluate switch
    const result = await controlFlowExecutor.execute(mockSwitchNode, mockInput);

    if (!result.success) {
      return res.status(500).json({
        error: 'Failed to evaluate switch cases',
        details: result.error
      });
    }

    // Transform executor result to maintain backward compatibility
    const executorData = result.data || {};
    const matchedCase = executorData.matchedCase ? cases.find(c => 
      (c.caseName ?? c.caseValue) === executorData.selectedBranch
    ) : null;
    
    res.json({
      inputValue,
      matchedCase,
      output: executorData.selectedBranch || defaultCase,
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
