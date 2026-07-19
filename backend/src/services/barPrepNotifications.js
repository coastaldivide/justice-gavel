/**
 * services/barPrepNotifications.js — Study schedule + push notification system
 * [I-06]
 *
 * Workers:
 *  dailyStudyReminder()  — 7am: "Your 20 questions are ready"
 *  streakWarning()       — 3pm: fires if daily goal not yet met
 *  examCountdown()       — 30/14/7 days out: special motivational push
 *
 * All scheduled via BullMQ repeatable jobs, wired in app.js startup.
 */

import { Queue, Worker } from 'bullmq';
import { getRedis }      from '../utils/redis.js';
import { db }            from '../db/index.js';
import logger            from '../utils/logger.js';

const connection = { client: getRedis() };

export const notifyQueue = connection.client
  ? new Queue('bar-notifications', { connection })
  : null;

/**
 * Schedule all bar prep notification jobs.
 * Call once at startup — BullMQ handles de-duplication.
 */
export async function schedulePrepNotifications() {
  if (!notifyQueue) {
    logger.warn('[bar_notify] No Redis — notification crons not scheduled');
    return;
  }

  // 7am daily reminder
  await notifyQueue.add('daily-reminder', {}, {
    repeat:           { pattern: '0 7 * * *', tz: 'America/New_York' },
    jobId:            'bar-daily-7am',
    removeOnComplete: 1,
  });

  // 3pm streak warning (only fires if goal not met)
  await notifyQueue.add('streak-warning', {}, {
    repeat:           { pattern: '0 15 * * *', tz: 'America/New_York' },
    jobId:            'bar-streak-3pm',
    removeOnComplete: 1,
  });

  // Daily exam countdown check
  await notifyQueue.add('exam-countdown', {}, {
    repeat:           { pattern: '0 8 * * *', tz: 'America/New_York' },
    jobId:            'bar-countdown-8am',
    removeOnComplete: 1,
  });

  logger.info('[bar_notify] Notification crons scheduled');
}

/**
 * Start the notification worker.
 */
export function startNotificationWorker() {
  if (!connection.client) return;

  const worker = new Worker('bar-notifications', async (job) => {
    switch (job.name) {
      case 'daily-reminder':  return sendDailyReminders();
      case 'streak-warning':  return sendStreakWarnings();
      case 'exam-countdown':  return sendExamCountdowns();
    }
  }, { connection, concurrency: 1 });

  worker.on('failed', (job, err) => {
    logger.error({ msg: '[bar_notify] job failed', name: job?.name, err: err.message });
  });
  logger.info('[bar_notify] Notification worker started');
}

async function sendDailyReminders() {
  // Get all users with bar prep active and a push token
  const users = await db.all(`
    SELECT DISTINCT ss.user_id, ss.daily_goal, ss.current_streak, pt.token, pt.platform
    FROM study_streaks ss
    JOIN push_tokens pt ON pt.user_id = ss.user_id
    WHERE ss.last_study_date >= CURRENT_DATE - INTERVAL '7 days'
  `);

  let sent = 0;
  for (const u of users) {
    const streak = u.current_streak;
    const body   = streak > 0
      ? `🔥 Day ${streak} streak! Your ${u.daily_goal} daily questions are ready.`
      : `📚 Ready to study? Your ${u.daily_goal} Criminal Law questions are waiting.`;

    await sendPushNotification(u.token, u.platform, {
      title: 'Bar Prep — Daily Questions',
      body,
      data:  { screen: 'BarPrepHome', action: 'start_session' },
    });
    sent++;
  }
  logger.info({ msg: '[bar_notify] daily reminders sent', count: sent });
}

async function sendStreakWarnings() {
  // Users who haven't met their daily goal yet today
  const users = await db.all(`
    SELECT ss.user_id, ss.daily_goal, ss.current_streak,
           COALESCE(bp.questions_done, 0) AS done_today,
           pt.token, pt.platform
    FROM study_streaks ss
    JOIN push_tokens pt ON pt.user_id = ss.user_id
    LEFT JOIN bar_prep_progress bp
           ON bp.user_id = ss.user_id AND bp.study_date = CURRENT_DATE
    WHERE ss.current_streak > 0
      AND COALESCE(bp.questions_done, 0) < ss.daily_goal
      AND ss.last_study_date >= CURRENT_DATE - INTERVAL '7 days'
  `);

  for (const u of users) {
    const remaining = u.daily_goal - u.done_today;
    await sendPushNotification(u.token, u.platform, {
      title: '⚠️ Streak at Risk!',
      body:  `Only ${remaining} more questions to protect your ${u.current_streak}-day streak.`,
      data:  { screen: 'QuizScreen', action: 'daily_session' },
    });
  }
  logger.info({ msg: '[bar_notify] streak warnings sent', count: users.length });
}

async function sendExamCountdowns() {
  const countdownDays = [30, 14, 7, 3, 1];

  const users = await db.all(`
    SELECT ss.user_id, ss.exam_date, pt.token, pt.platform
    FROM study_streaks ss
    JOIN push_tokens pt ON pt.user_id = ss.user_id
    WHERE ss.exam_date IS NOT NULL
  `);

  for (const u of users) {
    const daysLeft = Math.ceil((new Date(u.exam_date) - Date.now()) / 86400000);
    if (!countdownDays.includes(daysLeft)) continue;

    const messages = {
      30: { title: '30 Days to Bar Exam 📅', body: "One month out. Let's lock in Criminal Law." },
      14: { title: '2 Weeks to Bar Exam ⚡', body: 'Final stretch. Focus on your weak areas today.' },
       7: { title: '1 Week to Bar Exam 🎯', body: 'Review mode only — no new questions today.' },
       3: { title: '3 Days Out 💪',          body: 'Light review only. Protect your sleep.' },
       1: { title: 'Tomorrow is Bar Day 🏛️', body: "You're ready. Rest tonight." },
    };

    const msg = messages[daysLeft];
    await sendPushNotification(u.token, u.platform, {
      ...msg,
      data: { screen: 'ProgressDashboard', action: 'exam_countdown' },
    });
  }
}

async function sendPushNotification(token, platform, payload) {
  if (!token) return;
  try {
    const { Expo } = await import('expo-server-sdk');
    const expo = new Expo();
    if (!Expo.isExpoPushToken(token)) return;
    await expo.sendPushNotificationsAsync([{
      to:    token,
      title: payload.title,
      body:  payload.body,
      data:  payload.data ?? {},
      sound: 'default',
    }]);
  } catch (err) {
    logger.warn({ msg: '[bar_notify] push failed', token: token?.slice(0,20), err: err.message });
  }
}
