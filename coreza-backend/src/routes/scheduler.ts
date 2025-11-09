import express from 'express';

const router = express.Router();

// Scheduler execution handler
router.post('/scheduler', async (req, res) => {
  try {
    const { interval, count, hour, minute, timezone, dayOfWeek } = req.body;

    if (!interval || !count) {
      return res.status(400).json({ 
        error: 'Interval and count are required',
        received: { interval, count, hour, minute, dayOfWeek }
      });
    }

    // Validate dayOfWeek for weekly intervals
    if (interval.toLowerCase() === 'weeks') {
      if (dayOfWeek === undefined || dayOfWeek === null) {
        return res.status(400).json({
          error: 'dayOfWeek is required for weekly intervals (0=Sunday, 1=Monday, ..., 6=Saturday)',
          received: { dayOfWeek }
        });
      }
      const dow = parseInt(dayOfWeek);
      if (isNaN(dow) || dow < 0 || dow > 6) {
        return res.status(400).json({
          error: 'dayOfWeek must be between 0 (Sunday) and 6 (Saturday)',
          received: { dayOfWeek }
        });
      }
    }

    // Calculate next execution time based on the schedule
    const now = new Date();
    const nextExecution = new Date(now);

    // Parse the scheduling parameters
    const intervalCount = parseInt(count);
    const scheduleHour = hour ? parseInt(hour) : now.getHours();
    const scheduleMinute = minute ? parseInt(minute) : now.getMinutes();

    switch (interval.toLowerCase()) {
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
        const targetDayOfWeek = parseInt(dayOfWeek);
        const currentDayOfWeek = now.getDay();
        
        // Calculate days until target day
        let daysUntilTarget = targetDayOfWeek - currentDayOfWeek;
        
        // If target day has passed this week, go to next occurrence
        if (daysUntilTarget < 0) {
          daysUntilTarget += 7;
        } else if (daysUntilTarget === 0) {
          // If it's the target day today, check if the time has passed
          const targetTime = new Date(now);
          targetTime.setHours(scheduleHour, scheduleMinute, 0, 0);
          
          if (now >= targetTime) {
            // Time has passed, schedule for next week
            daysUntilTarget = 7;
          }
        }
        
        // Add additional weeks if interval > 1
        if (intervalCount > 1) {
          daysUntilTarget += (intervalCount - 1) * 7;
        }
        
        nextExecution.setDate(now.getDate() + daysUntilTarget);
        nextExecution.setHours(scheduleHour);
        nextExecution.setMinutes(scheduleMinute);
        nextExecution.setSeconds(0);
        nextExecution.setMilliseconds(0);
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
        // Use the actual dayOfWeek value (0=Sunday, 6=Saturday)
        const dow = parseInt(dayOfWeek);
        if (intervalCount === 1) {
          cronExpression = `${scheduleMinute} ${scheduleHour} * * ${dow}`;
        } else {
          // Note: Cron cannot natively express "every N weeks", so this runs every week
          // The actual interval logic would need to be handled by node-schedule or custom logic
          cronExpression = `${scheduleMinute} ${scheduleHour} * * ${dow}`;
        }
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
        minute: scheduleMinute,
        dayOfWeek: interval.toLowerCase() === 'weeks' ? parseInt(dayOfWeek) : undefined,
        timezone: timezone || 'UTC'
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