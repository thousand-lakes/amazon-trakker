'use strict';

const parserAndSettingsScripts = [
  'amazon-order-list.js',
  'amazon-order-page.js',
  'amazon-tracking.js',
  'preset-settings.js'
];
const backgroundModuleScripts = [
  'background-schedules.js',
  'background-page-processing.js',
  'background-workflows.js'
];

for (const script of parserAndSettingsScripts) {
  try {
    importScripts(script);
  } catch (error) {
    console.warn(`Failed to import ${script}:`, error);
  }
}

for (const script of backgroundModuleScripts) {
  try {
    importScripts(script);
  } catch (error) {
    console.error(`Failed to import required background module ${script}:`, error);
    throw error;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Amazon Tracker extension installed.');
  await stopAnimation();
  await initializationPromise;
  ignoreAlarmsScheduledBefore = Date.now();
  await rebuildAllSchedules();
});

chrome.runtime.onStartup.addListener(() => {
  console.log('Amazon Tracker extension started.');
  stopAnimation();
});

const initializationPromise = initializeExtension();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.autoLaunchEnabled || changes.autoLaunchInterval)) {
    configureAutoLaunch();
  }
  if (areaName === 'local' && (
    changes.amazonScheduleEnabled ||
    changes.amazonScheduleRuleCount ||
    changes.amazonScheduleRules
  )) {
    configureAmazonSchedule();
  }
  if (areaName === 'local' && changes.customWorkflows) {
    const oldSignature = customScheduleSignature(changes.customWorkflows.oldValue);
    const newSignature = customScheduleSignature(changes.customWorkflows.newValue);
    if (oldSignature !== newSignature) configureCustomWorkflowSchedules();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await initializationPromise;
  if (alarm.scheduledTime < ignoreAlarmsScheduledBefore) {
    console.log(`Ignoring overdue alarm from a previous browser session: ${alarm.name}`);
    return;
  }

  if (alarm.name.startsWith(AMAZON_ALARM_PREFIX)) {
    await handleAmazonScheduleAlarm(alarm);
    return;
  }

  if (alarm.name.startsWith(CUSTOM_ALARM_PREFIX)) {
    await handleCustomWorkflowAlarm(alarm);
    return;
  }

  if (alarm.name !== AUTO_LAUNCH_ALARM) return;

  const settings = await chrome.storage.local.get({
    autoLaunchEnabled: false,
    scheduleEnabled: false,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    scheduleStart: '00:00',
    scheduleStop: '00:00',
    idleEnabled: false,
    idleMinutes: 10
  });

  if (!settings.autoLaunchEnabled || !isWithinSchedule(settings)) {
    console.log('Auto launch skipped: outside the configured schedule.');
    return;
  }

  if (settings.idleEnabled) {
    const idleSeconds = Math.max(15, Number(settings.idleMinutes) * 60 || 15);
    const state = await chrome.idle.queryState(idleSeconds);
    if (state === 'active') {
      console.log(`Auto launch skipped: PC has not been idle for ${settings.idleMinutes} minutes.`);
      return;
    }
  }

  console.log('Queueing scheduled General workflow.');
  enqueueWorkflowRun({ type: 'general', scheduled: true });
});

chrome.commands.onCommand.addListener((command) => {
  initializationPromise.then(async () => {
    if (command === 'stop-active-workflow') {
      requestWorkflowStop();
      return;
    }

    if (command === 'save-page') {
      enqueueWorkflowRun({ type: 'general', scheduled: false });
      return;
    }

    if (command === 'run-amazon-workflow') {
      const { amazonPageCount } = await chrome.storage.local.get({ amazonPageCount: 1 });
      const savedCount = Number(amazonPageCount);
      const pageCount = Number.isSafeInteger(savedCount) && savedCount >= 1 && savedCount <= 1000
        ? savedCount
        : 1;
      enqueueWorkflowRun({ type: 'amazon', pageCount, scheduled: false });
      return;
    }

    const customMatch = /^run-custom-workflow-([123])$/.exec(command);
    if (customMatch) {
      enqueueWorkflowRun({
        type: 'custom',
        workflowId: `custom-${customMatch[1]}`,
        scheduled: false
      });
    }
  }).catch(error => {
    console.error(`Could not run keyboard command ${command}:`, error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.action === 'get-runner-state') {
    sendResponse({
      running: isSending || pendingRuns.length > 0,
      stopping: isSending && stopRequested,
      queued: pendingRuns.length
    });
    return;
  }

  if (message.action === 'stop-active-workflow') {
    const result = requestWorkflowStop();
    sendResponse({
      ...result,
      running: isSending || pendingRuns.length > 0,
      stopping: isSending && stopRequested,
      queued: pendingRuns.length
    });
    return;
  }

  if (!['start-general-run', 'start-amazon-orders-run', 'start-custom-workflow'].includes(message.action)) {
    return;
  }

  initializationPromise.then(() => {
    let queued;
    if (message.action === 'start-amazon-orders-run') {
      const pageCount = Number(message.pageCount);
      if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 1000) {
        sendResponse({ started: false, error: 'Page count must be a whole number from 1 to 1000.' });
        return;
      }
      queued = enqueueWorkflowRun({ type: 'amazon', pageCount, scheduled: false });
    } else if (message.action === 'start-custom-workflow') {
      if (!/^custom-[123]$/.test(String(message.workflowId))) {
        sendResponse({ started: false, error: 'Unknown workflow.' });
        return;
      }
      queued = enqueueWorkflowRun({ type: 'custom', workflowId: message.workflowId, scheduled: false });
    } else {
      queued = enqueueWorkflowRun({ type: 'general', scheduled: false });
    }

    sendResponse({ started: true, queued });
  }).catch(error => {
    console.error('Could not initialize workflow runner:', error);
    sendResponse({ started: false, error: 'Could not initialize workflow runner.' });
  });
  return true;
});
