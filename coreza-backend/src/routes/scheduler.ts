import express from 'express';

const router = express.Router();

// Scheduler execution handler
router.post('/', async (req, res) => {
  try {
    const { interval, count, hour, minute } = req.body;

    if (!interval || !count) {
      return res.status(400).json({ 
        error: 'Interval and count are required',
        received: { interval, count, hour, minute }
      });
    }

    // Calculate next execution time based on the schedule
    const now = new Date();
    const nextExecution = new Date(now);

    // Parse the scheduling parameters
    const intervalCount = parseInt(count);
    const scheduleHour = hour ? parseInt(hour) : now.getHours();
    const scheduleMinute = minute ? parseInt(minute) : now.getMinutes();

    switch (interval) {
      case 'minutes':
        nextExecution.setMinutes(now.getMinutes() + intervalCount);
        break;
      case 'hours':
        nextExecution.setHours(now.getHours() + intervalCount);
        nextExecution.setMinutes(scheduleMinute);
        break;
      case 'days':
        nextExecution.setDate(now.getDate() + intervalCount);
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        break;
      case 'weeks':
        nextExecution.setDate(now.getDate() + (intervalCount * 7));
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        break;
      case 'months':
        nextExecution.setMonth(now.getMonth() + intervalCount);
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        break;
      default:
        return res.status(400).json({ error: 'Invalid interval type' });
    }

    // Generate cron expression for the schedule
    let cronExpression = '';
    switch (interval) {
      case 'minutes':
        cronExpression = `*/${intervalCount} * * * *`;
        break;
      case 'hours':
        cronExpression = `${scheduleMinute} */${intervalCount} * * *`;
        break;
      case 'days':
        cronExpression = `${scheduleMinute} ${scheduleHour} */${intervalCount} * *`;
        break;
      case 'weeks':
        cronExpression = `${scheduleMinute} ${scheduleHour} * * 0`;
        break;
      case 'months':
        cronExpression = `${scheduleMinute} ${scheduleHour} 1 */${intervalCount} *`;
        break;
    }

    res.json({
      message: 'Scheduler triggered successfully',
      schedule: {
        interval,
        count: intervalCount,
        hour: scheduleHour,
        minute: scheduleMinute
      },
      nextExecution: nextExecution.toISOString(),
      cronExpression,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('Scheduler error:', error);
    res.status(500).json({ 
      error: 'Failed to process scheduler request',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;