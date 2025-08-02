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
      counter,
      parallel = false
    } = req.body;

    res.json({
      counter,
      parallel
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process loop data' });
  }
});

export default router;
