try {
  importScripts('amazon-order-list.js');
} catch (e) {
  console.warn('Failed to import amazon-order-list.js:', e);
}

try {
  importScripts('amazon-tracking.js');
} catch (e) {
  console.warn('Failed to import amazon-tracking.js:', e);
}

const AUTO_LAUNCH_ALARM = 'auto-launch';
const AMAZON_ALARM_PREFIX = 'amazon-daily-';
const CUSTOM_ALARM_PREFIX = 'custom-schedule-';
const DEFAULT_AMAZON_SCHEDULE_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
const LOCAL_STORAGE_MIGRATION_KEY = 'localStorageMigrationComplete';
const WORKFLOW_LIMITS_MIGRATION_KEY = 'workflowLimitsMigrationComplete';
const BROWSER_SESSION_KEY = 'workflowSchedulerSessionInitialized';
const SESSION_QUEUE_KEY = 'pendingWorkflowRuns';
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_AMAZON_SCHEDULE_RULES = DEFAULT_AMAZON_SCHEDULE_TIMES.map(time => ({ days: [...ALL_DAYS], time }));
const CUSTOM_WORKFLOW_DEFAULTS = [
  { id: 'custom-1', name: 'Workflow 1', enabled: false, sourceWebhook: '', destinationWebhook: '', maxLinks: 0, scheduleEnabled: false, scheduleRuleCount: 1, scheduleRules: [{ days: ALL_DAYS, time: '09:00' }] },
  { id: 'custom-2', name: 'Workflow 2', enabled: false, sourceWebhook: '', destinationWebhook: '', maxLinks: 0, scheduleEnabled: false, scheduleRuleCount: 1, scheduleRules: [{ days: ALL_DAYS, time: '12:00' }] },
  { id: 'custom-3', name: 'Workflow 3', enabled: false, sourceWebhook: '', destinationWebhook: '', maxLinks: 0, scheduleEnabled: false, scheduleRuleCount: 1, scheduleRules: [{ days: ALL_DAYS, time: '15:00' }] }
];
const ICON_PATHS = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png'
};
let isSending = false;
let stopRequested = false;
let animationInterval = null;
let queueSequence = 0;
let queueDrainTimer = null;
let queueDispatching = false;
let queuePersistencePromise = Promise.resolve();
let ignoreAlarmsScheduledBefore = 0;
const pendingRuns = [];

function isAmazonOrdersPage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAmazon = host === 'www.amazon.com' || host === 'amazon.com';
    return isAmazon && parsed.pathname.startsWith('/your-orders/orders');
  } catch (e) {
    return (
      url.startsWith('https://www.amazon.com/your-orders/orders') ||
      url.startsWith('http://www.amazon.com/your-orders/orders') ||
      url.startsWith('https://amazon.com/your-orders/orders')
    );
  }
}

function isAmazonTrackingPage(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isAmazon = host === 'www.amazon.com' || host === 'amazon.com';
    return isAmazon && parsed.pathname.startsWith('/gp/your-account/ship-track');
  } catch (e) {
    return (
      url.startsWith('https://www.amazon.com/gp/your-account/ship-track') ||
      url.startsWith('http://www.amazon.com/gp/your-account/ship-track') ||
      url.startsWith('https://amazon.com/gp/your-account/ship-track')
    );
  }
}

function isAmazonDomain(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'amazon.com' || host.endsWith('.amazon.com');
  } catch (_) {
    return false;
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

async function initializeExtension() {
  await migrateSyncedSettingsToLocal();
  await migrateSharedWorkflowLimit();
  await chrome.storage.local.remove('sendAll');
  const sessionState = await chrome.storage.session.get({
    [BROWSER_SESSION_KEY]: false,
    [SESSION_QUEUE_KEY]: []
  });
  if (!sessionState[BROWSER_SESSION_KEY]) {
    // A browser restart intentionally discards all old pending work. Rebuild
    // only future alarms from the saved schedule settings.
    ignoreAlarmsScheduledBefore = Date.now();
    await chrome.storage.session.set({
      [BROWSER_SESSION_KEY]: true,
      [SESSION_QUEUE_KEY]: []
    });
    await rebuildAllSchedules();
  } else if (Array.isArray(sessionState[SESSION_QUEUE_KEY])) {
    pendingRuns.push(...sessionState[SESSION_QUEUE_KEY]);
    queueSequence = pendingRuns.reduce((next, job) => Math.max(next, Number(job.sequence) + 1 || 0), 0);
    pendingRuns.sort((a, b) => workflowPriority(b) - workflowPriority(a) || a.sequence - b.sequence);
    scheduleQueueDrain();
  }
}

function normalizeLinkLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

async function migrateSharedWorkflowLimit() {
  const settings = await chrome.storage.local.get(null);
  if (settings[WORKFLOW_LIMITS_MIGRATION_KEY]) return;

  const legacyLimit = normalizeLinkLimit(settings.maxLinks);
  const savedWorkflows = Array.isArray(settings.customWorkflows) ? settings.customWorkflows : [];
  const customWorkflows = CUSTOM_WORKFLOW_DEFAULTS.map(defaultWorkflow => {
    const savedWorkflow = savedWorkflows.find(workflow => workflow && workflow.id === defaultWorkflow.id) || {};
    return {
      ...defaultWorkflow,
      ...savedWorkflow,
      id: defaultWorkflow.id,
      maxLinks: Object.prototype.hasOwnProperty.call(savedWorkflow, 'maxLinks')
        ? normalizeLinkLimit(savedWorkflow.maxLinks)
        : legacyLimit
    };
  });

  await chrome.storage.local.set({
    [WORKFLOW_LIMITS_MIGRATION_KEY]: true,
    generalMaxLinks: Object.prototype.hasOwnProperty.call(settings, 'generalMaxLinks')
      ? normalizeLinkLimit(settings.generalMaxLinks)
      : legacyLimit,
    customWorkflows
  });
  await chrome.storage.local.remove('maxLinks');
  console.log('Migrated the shared page limit to per-workflow limits.');
}

async function rebuildAllSchedules() {
  pendingRuns.length = 0;
  await persistPendingRuns();
  await Promise.all([
    configureAutoLaunch(),
    configureAmazonSchedule(),
    configureCustomWorkflowSchedules()
  ]);
}

async function migrateSyncedSettingsToLocal() {
  const localSettings = await chrome.storage.local.get(null);
  if (localSettings[LOCAL_STORAGE_MIGRATION_KEY]) return;

  const syncedSettings = await chrome.storage.sync.get(null);
  await chrome.storage.local.set({
    ...syncedSettings,
    ...localSettings
  });
  await chrome.storage.sync.clear();
  await chrome.storage.local.set({ [LOCAL_STORAGE_MIGRATION_KEY]: true });
  console.log('Settings migrated to PC-local storage and removed from Chrome Sync.');
}

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

async function configureAutoLaunch() {
  const settings = await chrome.storage.local.get({
    autoLaunchEnabled: false,
    autoLaunchInterval: 15
  });

  await chrome.alarms.clear(AUTO_LAUNCH_ALARM);
  if (!settings.autoLaunchEnabled) return;

  const interval = Math.max(0.5, Number(settings.autoLaunchInterval) || 15);
  await chrome.alarms.create(AUTO_LAUNCH_ALARM, {
    delayInMinutes: interval,
    periodInMinutes: interval
  });
  console.log(`Auto launch scheduled every ${interval} minute(s).`);
}

let amazonScheduleRevision = 0;

async function configureAmazonSchedule() {
  const revision = ++amazonScheduleRevision;
  const settings = await chrome.storage.local.get({
    amazonScheduleEnabled: false,
    amazonScheduleRuleCount: null,
    amazonScheduleRules: null,
    amazonRunsPerDay: 1,
    amazonScheduleTimes: DEFAULT_AMAZON_SCHEDULE_TIMES
  });

  const alarms = await chrome.alarms.getAll();
  if (revision !== amazonScheduleRevision) return;

  await Promise.all(
    alarms
      .filter(alarm => alarm.name.startsWith(AMAZON_ALARM_PREFIX))
      .map(alarm => chrome.alarms.clear(alarm.name))
  );
  if (revision !== amazonScheduleRevision || !settings.amazonScheduleEnabled) return;

  const schedule = normalizeAmazonSchedule(settings);

  for (let index = 0; index < schedule.ruleCount; index += 1) {
    if (revision !== amazonScheduleRevision) return;
    await scheduleAmazonRuleAlarm(index, schedule.rules[index]);
  }
}

function normalizeAmazonSchedule(settings) {
  const legacyRuleCount = Math.min(6, Math.max(1, Number(settings.amazonRunsPerDay) || 1));
  const legacyTimes = Array.isArray(settings.amazonScheduleTimes)
    ? settings.amazonScheduleTimes
    : DEFAULT_AMAZON_SCHEDULE_TIMES;
  const savedRules = Array.isArray(settings.amazonScheduleRules)
    ? settings.amazonScheduleRules
    : legacyTimes.map(time => ({ days: [...ALL_DAYS], time }));
  const rules = DEFAULT_AMAZON_SCHEDULE_RULES.map((defaultRule, index) => {
    const rule = savedRules[index] || {};
    return {
      days: Array.isArray(rule.days) ? rule.days : defaultRule.days,
      time: rule.time || defaultRule.time
    };
  });
  return {
    ruleCount: settings.amazonScheduleRuleCount == null
      ? legacyRuleCount
      : Math.min(6, Math.max(1, Number(settings.amazonScheduleRuleCount) || 1)),
    rules
  };
}

async function scheduleAmazonRuleAlarm(index, rule) {
  if (!rule) return;
  const nextRun = getNextWeeklyOccurrence(rule.days, rule.time);
  if (!nextRun) return;

  await chrome.alarms.create(`${AMAZON_ALARM_PREFIX}${index}`, { when: nextRun.getTime() });
  console.log(`New-orders schedule rule ${index + 1} set for ${nextRun.toString()}.`);
}

async function handleAmazonScheduleAlarm(alarm) {
  const index = Number(alarm.name.slice(AMAZON_ALARM_PREFIX.length));
  const settings = await chrome.storage.local.get({
    amazonScheduleEnabled: false,
    amazonScheduleRuleCount: null,
    amazonScheduleRules: null,
    amazonRunsPerDay: 1,
    amazonScheduleTimes: DEFAULT_AMAZON_SCHEDULE_TIMES,
    amazonPageCount: 1,
    amazonWebhook: ''
  });
  const schedule = normalizeAmazonSchedule(settings);

  if (!settings.amazonScheduleEnabled || !Number.isInteger(index) || index < 0 || index >= schedule.ruleCount) {
    return;
  }

  // Schedule the rule's next occurrence before starting today's work, so a page or webhook
  // failure cannot break future scheduled runs.
  await scheduleAmazonRuleAlarm(index, schedule.rules[index]);

  const pageCount = Number(settings.amazonPageCount);
  const safePageCount = Number.isSafeInteger(pageCount) && pageCount >= 1 && pageCount <= 1000
    ? pageCount
    : 1;
  console.log(`Queueing scheduled Amazon run for ${safePageCount} page(s).`);
  enqueueWorkflowRun({ type: 'amazon', pageCount: safePageCount, scheduled: true });
}

let customScheduleRevision = 0;

function normalizeCustomWorkflows(value) {
  const saved = Array.isArray(value) ? value : [];
  return CUSTOM_WORKFLOW_DEFAULTS.map(defaultWorkflow => {
    const workflow = saved.find(item => item && item.id === defaultWorkflow.id) || {};
    return {
      ...defaultWorkflow,
      ...workflow,
      id: defaultWorkflow.id,
      scheduleRules: Array.isArray(workflow.scheduleRules)
        ? workflow.scheduleRules
        : defaultWorkflow.scheduleRules
    };
  });
}

function customScheduleSignature(value) {
  return JSON.stringify(normalizeCustomWorkflows(value).map(workflow => ({
    id: workflow.id,
    enabled: workflow.enabled,
    scheduleEnabled: workflow.scheduleEnabled,
    scheduleRuleCount: workflow.scheduleRuleCount,
    scheduleRules: workflow.scheduleRules
  })));
}

async function configureCustomWorkflowSchedules() {
  const revision = ++customScheduleRevision;
  const { customWorkflows } = await chrome.storage.local.get({
    customWorkflows: CUSTOM_WORKFLOW_DEFAULTS
  });
  const alarms = await chrome.alarms.getAll();
  if (revision !== customScheduleRevision) return;

  await Promise.all(
    alarms
      .filter(alarm => alarm.name.startsWith(CUSTOM_ALARM_PREFIX))
      .map(alarm => chrome.alarms.clear(alarm.name))
  );
  if (revision !== customScheduleRevision) return;

  for (const workflow of normalizeCustomWorkflows(customWorkflows)) {
    if (!workflow.enabled || !workflow.scheduleEnabled) continue;
    const ruleCount = Math.min(6, Math.max(1, Number(workflow.scheduleRuleCount) || 1));
    for (let ruleIndex = 0; ruleIndex < ruleCount; ruleIndex += 1) {
      const rule = workflow.scheduleRules[ruleIndex];
      if (!rule) continue;
      await scheduleCustomWorkflowAlarm(workflow.id, ruleIndex, rule);
    }
  }
}

function getNextWeeklyOccurrence(days, time, now = new Date()) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  const allowedDays = Array.isArray(days)
    ? days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  if (!match || allowedDays.length === 0) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (allowedDays.includes(candidate.getDay()) && candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
}

async function scheduleCustomWorkflowAlarm(workflowId, ruleIndex, rule) {
  const nextRun = getNextWeeklyOccurrence(rule.days, rule.time);
  if (!nextRun) return;
  const alarmName = `${CUSTOM_ALARM_PREFIX}${workflowId}-${ruleIndex}`;
  await chrome.alarms.create(alarmName, { when: nextRun.getTime() });
  console.log(`${workflowId} schedule rule ${ruleIndex + 1} set for ${nextRun.toString()}.`);
}

async function handleCustomWorkflowAlarm(alarm) {
  const match = /^custom-schedule-(custom-[123])-(\d+)$/.exec(alarm.name);
  if (!match) return;

  const workflowId = match[1];
  const ruleIndex = Number(match[2]);
  const { customWorkflows } = await chrome.storage.local.get({
    customWorkflows: CUSTOM_WORKFLOW_DEFAULTS
  });
  const workflow = normalizeCustomWorkflows(customWorkflows)
    .find(item => item.id === workflowId);
  const ruleCount = workflow
    ? Math.min(6, Math.max(1, Number(workflow.scheduleRuleCount) || 1))
    : 0;
  const rule = workflow && workflow.scheduleRules[ruleIndex];
  if (!workflow || !workflow.enabled || !workflow.scheduleEnabled || ruleIndex >= ruleCount || !rule) return;

  // Schedule the rule's next weekly occurrence before queueing this run.
  await scheduleCustomWorkflowAlarm(workflowId, ruleIndex, rule);
  enqueueWorkflowRun({ type: 'custom', workflowId, scheduled: true });
}

function workflowPriority(job) {
  if (job.type === 'amazon') return 3;
  if (job.type === 'custom') return 2;
  return 1;
}

function enqueueWorkflowRun(job) {
  const wasQueued = isSending || queueDispatching || pendingRuns.length > 0;
  pendingRuns.push({ ...job, sequence: queueSequence++ });
  pendingRuns.sort((a, b) => workflowPriority(b) - workflowPriority(a) || a.sequence - b.sequence);
  persistPendingRuns();
  scheduleQueueDrain();
  return wasQueued;
}

function scheduleQueueDrain() {
  if (isSending || queueDispatching || queueDrainTimer !== null) return;
  queueDrainTimer = setTimeout(() => {
    queueDrainTimer = null;
    drainWorkflowQueue();
  }, 100);
}

async function drainWorkflowQueue() {
  if (isSending || queueDispatching || pendingRuns.length === 0) return;
  queueDispatching = true;
  const job = pendingRuns.shift();
  try {
    try {
      await persistPendingRuns();
    } catch (error) {
      console.error('Could not update the session queue before starting a run:', error);
    }
    if (job.type === 'amazon') {
      sendTabs({ amazonPageCount: job.pageCount, scheduled: job.scheduled });
    } else if (job.type === 'custom') {
      sendTabs({ customWorkflowId: job.workflowId, scheduled: job.scheduled });
    } else {
      sendTabs({ scheduled: job.scheduled });
    }
  } finally {
    queueDispatching = false;
    if (!isSending) scheduleQueueDrain();
  }
}

function persistPendingRuns() {
  const snapshot = pendingRuns.map(job => ({ ...job }));
  queuePersistencePromise = queuePersistencePromise
    .catch(error => console.error('Could not persist the workflow queue:', error))
    .then(() => chrome.storage.session.set({ [SESSION_QUEUE_KEY]: snapshot }));
  return queuePersistencePromise;
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
}

function isWithinSchedule(settings, now = new Date()) {
  if (!settings.scheduleEnabled) return true;

  const days = Array.isArray(settings.scheduleDays) ? settings.scheduleDays : [];
  const start = timeToMinutes(settings.scheduleStart);
  const stop = timeToMinutes(settings.scheduleStop);
  const current = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  // Equal times mean an all-day window on each selected day.
  if (start === stop) return days.includes(today);
  if (start < stop) return days.includes(today) && current >= start && current < stop;

  // An overnight window belongs to the day on which it starts.
  const previousDay = (today + 6) % 7;
  return (days.includes(today) && current >= start) ||
    (days.includes(previousDay) && current < stop);
}

// Route keyboard commands through the same queue used by popup actions.
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
    sendResponse({ running: isSending, stopping: isSending && stopRequested });
    return;
  }

  if (message.action === 'stop-active-workflow') {
    const accepted = requestWorkflowStop();
    sendResponse({ accepted, running: isSending, stopping: isSending && stopRequested });
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

function requestWorkflowStop() {
  if (!isSending) {
    console.log('Stop requested, but no workflow is currently running.');
    return false;
  }

  stopRequested = true;
  console.log('Stop requested. The current page will finish, and no next page will be opened.');
  return true;
}

async function sendTabs(options = {}) {
  if (isSending) {
    console.log("Already in the process of sending tabs.");
    scheduleQueueDrain();
    return;
  }

  // Reserve the runner before the first await so two rapid triggers cannot
  // start overlapping tab sequences.
  isSending = true;
  stopRequested = false;
  let settings;
  try {
    settings = await chrome.storage.local.get({
      liveWebhook: '',
      enableFetch: false,
      fetchUrl: '',
      generalMaxLinks: 0,
      minOpenTime: 1.0,
      maxOpenTime: 3.0,
      closeTabs: false,
      amazonWebhook: '',
      customWorkflows: CUSTOM_WORKFLOW_DEFAULTS
    });
  } catch (error) {
    isSending = false;
    console.error('Could not load extension settings:', error);
    scheduleQueueDrain();
    return;
  }

  const isAmazonRun = Number.isSafeInteger(options.amazonPageCount) && options.amazonPageCount > 0;
  const customWorkflow = options.customWorkflowId
    ? normalizeCustomWorkflows(settings.customWorkflows).find(workflow => workflow.id === options.customWorkflowId)
    : null;
  if (options.customWorkflowId && (!customWorkflow || !customWorkflow.enabled)) {
    console.error(`Custom workflow is unavailable: ${options.customWorkflowId}`);
    isSending = false;
    if (!options.scheduled) chrome.runtime.openOptionsPage();
    scheduleQueueDrain();
    return;
  }
  if (customWorkflow && !customWorkflow.sourceWebhook) {
    console.error(`${customWorkflow.name} source webhook URL is not configured.`);
    isSending = false;
    if (!options.scheduled) chrome.runtime.openOptionsPage();
    scheduleQueueDrain();
    return;
  }

  const webhookUrl = isAmazonRun
    ? settings.amazonWebhook
    : customWorkflow
      ? customWorkflow.destinationWebhook
      : settings.liveWebhook;
  const workflowName = isAmazonRun ? 'Amazon' : customWorkflow ? customWorkflow.name : 'General';

  if (!webhookUrl) {
    console.error(`${workflowName} destination webhook URL is not configured.`);
    isSending = false;
    if (!options.scheduled) chrome.runtime.openOptionsPage();
    scheduleQueueDrain();
    return;
  }

  try {
    await startAnimation();

    if (isAmazonRun) {
      const links = buildAmazonOrdersLinks(options.amazonPageCount);
      console.log(`Generated ${links.length} Amazon order page link(s).`);
      await processLinksSequentially(links, settings, webhookUrl);
      console.log('Finished sending Amazon order pages sequentially.');
      return;
    }

    if (customWorkflow) {
      const links = await fetchLinksFromSource(customWorkflow.sourceWebhook, normalizeLinkLimit(customWorkflow.maxLinks));
      console.log(`${customWorkflow.name}: found ${links.length} link(s) to process.`);
      if (links.length > 0) {
        await processLinksSequentially(links, settings, webhookUrl);
      }
      console.log(`Finished ${customWorkflow.name}.`);
      return;
    }

    // Pre-fetch links if enabled
    if (settings.enableFetch && settings.fetchUrl) {
      const links = await fetchLinksFromSource(settings.fetchUrl, normalizeLinkLimit(settings.generalMaxLinks));

      console.log(`Found ${links.length} link(s) to process.`);

      if (links.length > 0) {
        await processLinksSequentially(links, settings, webhookUrl);

        console.log("Finished sending pre-fetched tabs sequentially.");
        return;
      }

      console.log('No valid links returned by endpoint. Process finished without opening tabs.');
      return;
    }

    // Without pre-fetch enabled, process only the currently active tab.
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabsToProcess = activeTab ? [activeTab] : [];

    for (const tab of tabsToProcess) {
      if (!tab.url || tab.url.startsWith('chrome://')) {
        console.log(`Skipping tab: ${tab.url || 'new tab'}`);
        continue;
      }

      try {
        await processAndSendTab(tab.id, tab.url, webhookUrl);
      } catch (error) {
        console.error(`Error processing tab: ${tab.url}`, error);
      }
    }

    console.log("Finished sending tabs.");
  } catch (err) {
    console.error("Error in sendTabs:", err);
  } finally {
    await stopAnimation();
    isSending = false;
    stopRequested = false;
    scheduleQueueDrain();
  }
}

function buildAmazonOrdersLinks(pageCount) {
  const links = [];
  for (let page = pageCount - 1; page >= 0; page -= 1) {
    links.push(`https://www.amazon.com/your-orders/orders?timeFilter=last30&page=${page}`);
  }
  return links;
}

async function processLinksSequentially(links, settings, webhookUrl) {
  for (let index = 0; index < links.length; index += 1) {
    const url = links[index];
    if (stopRequested) {
      console.log('Sequence stopped before opening the next page.');
      break;
    }

    let tabId = null;
    try {
      console.log(`Opening sequential tab for: ${url}`);
      const tab = await chrome.tabs.create({ url, active: true });
      tabId = tab.id;

      await waitForTabsToLoad([tabId]);

      const minSeconds = Math.max(0, Number(settings.minOpenTime) || 0);
      const maxSeconds = Math.max(minSeconds, Number(settings.maxOpenTime) || 0);
      const minMs = minSeconds * 1000;
      const maxMs = maxSeconds * 1000;
      const randomMs = minMs + Math.random() * (maxMs - minMs);
      console.log(`Keeping page open for ${randomMs.toFixed(0)}ms (range: ${minMs}ms - ${maxMs}ms)`);
      if (isAmazonDomain(url)) {
        await showAmazonSequenceWidget(tabId, index + 1, links.length, randomMs);
      }
      await new Promise(resolve => setTimeout(resolve, randomMs));

      await processAndSendTab(tabId, url, webhookUrl);
      await removeAmazonSequenceWidget(tabId);

      if (settings.closeTabs || stopRequested) {
        console.log(`Closing tab: ${tabId}`);
        await chrome.tabs.remove(tabId);
      }
    } catch (err) {
      console.error(`Error processing URL sequentially: ${url}`, err);
      if (tabId) await removeAmazonSequenceWidget(tabId);
      if (tabId && (settings.closeTabs || stopRequested)) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (_) { }
      }
    }

    if (stopRequested) {
      console.log('Current page completed. Ending the sequence as requested.');
      break;
    }
  }
}

async function showAmazonSequenceWidget(tabId, current, total, durationMs) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (sequenceCurrent, sequenceTotal, countdownDurationMs) => {
        const hostId = '__page_saver_sequence_progress';
        const timerKey = '__pageSaverSequenceProgressTimer';
        const previousHost = document.getElementById(hostId);
        if (previousHost) previousHost.remove();
        if (window[timerKey]) clearInterval(window[timerKey]);

        const host = document.createElement('div');
        host.id = hostId;
        host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
          <style>
            .progress {
              box-sizing: border-box;
              min-width: 66px;
              padding: 9px 12px 8px;
              color: #f8fafc;
              border: 1px solid rgba(251, 191, 36, 0.38);
              border-radius: 14px;
              background: linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(8, 13, 24, 0.9));
              box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32), inset 0 1px rgba(255, 255, 255, 0.07);
              backdrop-filter: blur(14px);
              font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              line-height: 1;
              text-align: center;
            }
            .seconds {
              color: #94a3b8;
              font-size: 10px;
              font-weight: 750;
              letter-spacing: 0.04em;
            }
            .sequence {
              margin-top: 5px;
              color: #94a3b8;
              font-size: 10px;
              font-weight: 750;
              letter-spacing: 0.04em;
            }
          </style>
          <div class="progress">
            <div class="seconds"></div>
            <div class="sequence"></div>
          </div>
        `;
        const seconds = shadow.querySelector('.seconds');
        shadow.querySelector('.sequence').textContent = `${sequenceCurrent}/${sequenceTotal}`;
        const deadline = Date.now() + Math.max(0, Number(countdownDurationMs) || 0);
        const updateCountdown = () => {
          const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
          seconds.textContent = `${remaining}s`;
          if (remaining === 0 && window[timerKey]) {
            clearInterval(window[timerKey]);
            window[timerKey] = null;
          }
        };
        document.documentElement.appendChild(host);
        updateCountdown();
        window[timerKey] = setInterval(updateCountdown, 200);
      },
      args: [current, total, durationMs]
    });
  } catch (error) {
    console.warn('Could not show the Amazon sequence widget:', error);
  }
}

async function removeAmazonSequenceWidget(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const timerKey = '__pageSaverSequenceProgressTimer';
        if (window[timerKey]) clearInterval(window[timerKey]);
        window[timerKey] = null;
        document.getElementById('__page_saver_sequence_progress')?.remove();
      }
    });
  } catch (_) { }
}

async function fetchLinksFromSource(sourceUrl, maxLinks) {
  let finalFetchUrl = sourceUrl;
  if (maxLinks > 0) {
    try {
      const urlObj = new URL(finalFetchUrl);
      urlObj.searchParams.set('limit', maxLinks);
      finalFetchUrl = urlObj.toString();
    } catch (e) {
      const separator = finalFetchUrl.includes('?') ? '&' : '?';
      finalFetchUrl = `${finalFetchUrl}${separator}limit=${maxLinks}`;
    }
  }

  console.log(`Fetching links from: ${finalFetchUrl}`);
  const response = await fetch(finalFetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch links. Status: ${response.status} ${response.statusText}`);
  }

  const responseText = await response.text();
  let links = extractLinksFromResponse(responseText);
  if (maxLinks > 0) links = links.slice(0, maxLinks);
  return links;
}

function extractLinksFromResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return [];

  function findUrls(node) {
    let urls = [];
    if (!node) return urls;

    if (typeof node === 'string') {
      if (node.startsWith('http://') || node.startsWith('https://')) {
        urls.push(node);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        urls.push(...findUrls(item));
      }
    } else if (typeof node === 'object') {
      const priorityKeys = ['links', 'urls', 'data', 'items', 'pages', 'url', 'link', 'href', 'page_url', 'page url', 'json'];
      for (const key of priorityKeys) {
        if (key in node) {
          urls.push(...findUrls(node[key]));
        }
      }
      for (const [key, value] of Object.entries(node)) {
        if (!priorityKeys.includes(key)) {
          urls.push(...findUrls(value));
        }
      }
    }
    return urls;
  }

  // 1. Try parsing as JSON
  try {
    const data = JSON.parse(responseText);
    const urls = findUrls(data);
    if (urls.length > 0) {
      return [...new Set(urls)];
    }
  } catch (_) {
    // Not valid JSON, fall back to plain text extraction
  }

  // 2. Try extracting URLs from plain text (e.g. newline/space separated URLs or plain text containing http URLs)
  const urlRegex = /https?:\/\/[^\s"'<>,;]+/g;
  const matches = responseText.match(urlRegex);
  if (matches && matches.length > 0) {
    return [...new Set(matches)];
  }

  return [];
}

async function processAndSendTab(tabId, url, webhookUrl) {
  if (isAmazonTrackingPage(url)) {
    console.log(`Detected Amazon tracking page: ${url}. Parsing tracking details...`);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: parseAmazonTrackingPage
    });

    const trackingData = (result && result.result) || {};
    console.log(`Parsed Amazon tracking data from tab ${tabId}:`, trackingData);

    const data = {
      "page url": url,
      "page content": trackingData
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      console.log(`Successfully sent Amazon tracking data: ${url}`);
    } else {
      console.error(`Failed to send Amazon tracking data: ${url}. Status: ${response.status}`);
    }
    return;
  }

  if (isAmazonOrdersPage(url)) {
    console.log(`Detected Amazon orders page: ${url}. Parsing structured orders...`);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: parseAmazonOrders
    });

    const ordersData = (result && result.result) || [];
    console.log(`Parsed ${ordersData.length} Amazon order(s) from tab ${tabId}.`);

    // Webhook JSON Payload with structured order data
    const data = {
      "page url": url,
      "page content": ordersData
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (response.ok) {
      console.log(`Successfully sent Amazon orders: ${url}`);
    } else {
      console.error(`Failed to send Amazon orders: ${url}. Status: ${response.status}`);
    }
    return;
  }

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: () => {
      if (!document.documentElement) {
        return { chunks: [], length: 0, removedRakutenNodes: 0 };
      }

      // Work on a detached copy so filtering never changes the page the user
      // is viewing. Rakuten injects very large font/style blocks and popup UI
      // into the merchant DOM; those are extension data, not page content.
      const documentCopy = document.documentElement.cloneNode(true);
      const rakutenExtensionId = 'chhjbpecpncaggjpdakmflnfcopglcmi';
      const rakutenSelectors = [
        '#rr-style-fonts',
        '#rr-style-content',
        '[id^="rr-style-content-"]',
        'style[data-emotion^="rr"]',
        '.ebates-notification',
        '.ebates-notification-request-backdrop',
        '#rr-skip-link',
        `[src^="chrome-extension://${rakutenExtensionId}/"]`,
        `[href^="chrome-extension://${rakutenExtensionId}/"]`
      ];

      const rakutenNodes = new Set(documentCopy.querySelectorAll(rakutenSelectors.join(',')));
      for (const node of documentCopy.querySelectorAll('[aria-label*="Rakuten" i], [role="status"]')) {
        if (/rakuten/i.test(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`)) {
          rakutenNodes.add(node);
        }
      }
      rakutenNodes.forEach(node => node.remove());

      const html = documentCopy.outerHTML;
      // Chrome's script-result transport truncates a single very large string
      // (it can arrive as "IMTString(<length>): ..."). Keep every transported
      // string comfortably below that limit and rebuild it in the worker.
      const chunkSize = 64 * 1024;
      const chunks = [];
      for (let offset = 0; offset < html.length; offset += chunkSize) {
        chunks.push(html.slice(offset, offset + chunkSize));
      }
      return { chunks, length: html.length, removedRakutenNodes: rakutenNodes.size };
    },
  });

  const extraction = result && result.result;
  if (!extraction || !Array.isArray(extraction.chunks)) {
    throw new Error(`Failed to extract HTML from tab ${tabId}.`);
  }

  const htmlContent = extraction.chunks.join('');
  if (htmlContent.length !== extraction.length) {
    throw new Error(
      `Incomplete HTML extraction for tab ${tabId}: expected ${extraction.length} characters, received ${htmlContent.length}.`
    );
  }
  console.log(`Removed ${extraction.removedRakutenNodes || 0} Rakuten-injected node(s) before sending.`);

  // Webhook JSON Payload
  const data = {
    "page url": url,
    "page content": htmlContent
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (response.ok) {
    console.log(`Successfully sent tab: ${url}`);
  } else {
    console.error(`Failed to send tab: ${url}. Status: ${response.status}`);
  }
}

function waitForTabsToLoad(tabIds, timeoutMs = 30000) {
  if (tabIds.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    const pendingTabIds = new Set(tabIds);
    let timeoutId;

    const cleanUp = () => {
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      chrome.tabs.onRemoved.removeListener(onRemovedListener);
      clearTimeout(timeoutId);
      resolve();
    };

    const onUpdatedListener = (tabId, changeInfo) => {
      if (pendingTabIds.has(tabId) && changeInfo.status === 'complete') {
        pendingTabIds.delete(tabId);
        if (pendingTabIds.size === 0) {
          cleanUp();
        }
      }
    };

    const onRemovedListener = (tabId) => {
      if (pendingTabIds.has(tabId)) {
        pendingTabIds.delete(tabId);
        if (pendingTabIds.size === 0) {
          cleanUp();
        }
      }
    };

    chrome.tabs.onUpdated.addListener(onUpdatedListener);
    chrome.tabs.onRemoved.addListener(onRemovedListener);

    // Initial check: check if tabs are already loaded
    for (const tabId of tabIds) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab && tab.status === 'complete') {
          pendingTabIds.delete(tab.id);
          if (pendingTabIds.size === 0) {
            cleanUp();
          }
        }
      });
    }

    // Failsafe timeout
    timeoutId = setTimeout(() => {
      console.warn("Timeout waiting for tabs to load. Proceeding anyway.");
      cleanUp();
    }, timeoutMs);
  });
}

async function startAnimation() {
  await chrome.action.setIcon({ path: ICON_PATHS });
  await chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  let frame = 0;
  animationInterval = setInterval(() => {
    frame = (frame + 1) % 3;
    chrome.action.setBadgeText({ text: '.'.repeat(frame + 1) });
  }, 350);
}

async function stopAnimation() {
  clearInterval(animationInterval);
  animationInterval = null;
  await chrome.action.setBadgeText({ text: '' });
  await chrome.action.setIcon({ path: ICON_PATHS });
}
