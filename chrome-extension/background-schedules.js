'use strict';

const AUTO_LAUNCH_ALARM = 'auto-launch';
const AMAZON_ALARM_PREFIX = 'amazon-daily-';
const CUSTOM_ALARM_PREFIX = 'custom-schedule-';
const DEFAULT_AMAZON_SCHEDULE_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
const LOCAL_STORAGE_MIGRATION_KEY = 'localStorageMigrationComplete';
const WORKFLOW_LIMITS_MIGRATION_KEY = 'workflowLimitsMigrationComplete';
const PRESET_SETTINGS_INITIALIZED_KEY = 'presetSettingsInitializedV1';
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

let ignoreAlarmsScheduledBefore = 0;

async function initializeExtension() {
  await migrateSyncedSettingsToLocal();
  await seedPresetSettings();
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

async function seedPresetSettings() {
  const preset = globalThis.AMAZON_TRACKER_PRESET_SETTINGS;
  if (!preset || typeof preset !== 'object') return;

  const existingSettings = await chrome.storage.local.get(null);
  if (existingSettings[PRESET_SETTINGS_INITIALIZED_KEY]) return;

  const missingSettings = {};
  for (const [key, value] of Object.entries(preset)) {
    if (!Object.prototype.hasOwnProperty.call(existingSettings, key)) {
      missingSettings[key] = value;
    }
  }

  await chrome.storage.local.set({
    ...missingSettings,
    [PRESET_SETTINGS_INITIALIZED_KEY]: true
  });
  console.log(`Initialized ${Object.keys(missingSettings).length} setting(s) from the packaged preset.`);
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

