import express from 'express';

const router = express.Router();

// Loop configuration helper
function getByPath(obj: any, path: string): any {
  if (!path) return obj;
  return path.split('.').reduce((acc: any, key: string) => (acc ? acc[key] : undefined), obj);
}

router.post('/loop', (req, res) => {
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
      arrayData = Array.isArray(req.body[inputArray]) ? req.body[inputArray] : [req.body[inputArray]];
    } else if (Array.isArray(items)) {
      arrayData = items;
    }

    console.log(`🔄 Loop processing ${arrayData.length} items with batch size ${batchSize}`);

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
    res.status(500).json({ error: 'Failed to process loop data' });
  }
});

export default router;
