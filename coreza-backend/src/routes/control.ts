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
      array = [],
      array_selector,
      item_output_field = 'item',
      index_output_field = 'index',
      prev_output_field,
      loop_limit,
      parallel = false,
      input = {}
    } = req.body;

    let items: any[] = Array.isArray(array) ? array : [];

    if (!items.length && array_selector) {
      const fromInput = getByPath(input, array_selector);
      if (Array.isArray(fromInput)) {
        items = fromInput;
      }
    }

    if (typeof loop_limit === 'number') {
      items = items.slice(0, loop_limit);
    }

    res.json({
      items,
      itemKey: item_output_field,
      indexKey: index_output_field,
      prevKey: prev_output_field,
      parallel: Boolean(parallel)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process loop data' });
  }
});

export default router;
