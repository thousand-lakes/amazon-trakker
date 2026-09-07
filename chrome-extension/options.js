const DEFAULT_AMAZON_SCHEDULE_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
const DEFAULT_CUSTOM_RULE_TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00', '23:00'];
const ALL_SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SCHEDULE_DAY_CHOICES = [
  [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'],
  [5, 'Fri'], [6, 'Sat'], [0, 'Sun']
];
const DEFAULT_AMAZON_SCHEDULE_RULES = DEFAULT_AMAZON_SCHEDULE_TIMES
  .map(time => ({ days: [...ALL_SCHEDULE_DAYS], time }));
const CUSTOM_WORKFLOW_DEFAULTS = [
  { id: 'custom-1', name: 'Workflow 1', buttonColor: '#7c3aed' },
  { id: 'custom-2', name: 'Workflow 2', buttonColor: '#059669' },
  { id: 'custom-3', name: 'Workflow 3', buttonColor: '#db2777' }
].map(workflow => ({
  ...workflow,
  enabled: false,
  sourceWebhook: '',
  destinationWebhook: '',
  maxLinks: 0,
  scheduleEnabled: false,
  scheduleRuleCount: 1,
  scheduleRules: DEFAULT_CUSTOM_RULE_TIMES.map(time => ({ days: [...ALL_SCHEDULE_DAYS], time }))
}));

function normalizeCustomWorkflows(value) {
  const saved = Array.isArray(value) ? value : [];
  return CUSTOM_WORKFLOW_DEFAULTS.map(defaultWorkflow => {
    const workflow = saved.find(item => item && item.id === defaultWorkflow.id) || {};
    const savedRules = Array.isArray(workflow.scheduleRules) ? workflow.scheduleRules : [];
    return {
      ...defaultWorkflow,
      ...workflow,
      id: defaultWorkflow.id,
      scheduleRules: defaultWorkflow.scheduleRules.map((defaultRule, index) => {
        const rule = savedRules[index] || {};
        return {
          days: Array.isArray(rule.days) ? rule.days : defaultRule.days,
          time: rule.time || defaultRule.time
        };
      })
    };
  });
}

function renderCustomWorkflowSettings() {
  const container = document.getElementById('custom-workflows');
  container.innerHTML = CUSTOM_WORKFLOW_DEFAULTS.map((workflow, workflowIndex) => `
    <article class="custom-workflow-card" data-workflow-index="${workflowIndex}">
      <div class="custom-workflow-header">
        <h3>Additional Workflow ${workflowIndex + 1}</h3>
        <label class="switch">
          <input type="checkbox" data-field="enabled" aria-label="Enable Additional Workflow ${workflowIndex + 1}">
          <span class="slider"></span>
        </label>
      </div>
      <div class="custom-workflow-body">
        <div class="button-style-row">
          <div class="input-group button-name-group">
            <label for="custom-name-${workflowIndex}">Button name</label>
            <input type="text" id="custom-name-${workflowIndex}" data-field="name" class="webhook-input" maxlength="40">
          </div>
          <div class="input-group color-group">
            <label for="custom-color-${workflowIndex}">Color</label>
            <input type="color" id="custom-color-${workflowIndex}" data-field="buttonColor">
          </div>
        </div>
        <div class="input-group">
          <label for="custom-source-${workflowIndex}">Fetching URL</label>
          <input type="text" id="custom-source-${workflowIndex}" data-field="sourceWebhook" class="webhook-input" placeholder="https://example.com/api/pages">
        </div>
        <div class="input-group">
          <label for="custom-max-links-${workflowIndex}">Max links to open (0 or empty for unlimited)</label>
          <input type="number" id="custom-max-links-${workflowIndex}" data-field="maxLinks" class="webhook-input" min="0" step="1" placeholder="Unlimited">
        </div>
        <div class="input-group">
          <label for="custom-destination-${workflowIndex}">Send-results Webhook URL</label>
          <input type="text" id="custom-destination-${workflowIndex}" data-field="destinationWebhook" class="webhook-input" placeholder="https://example.com/webhook/results">
        </div>
        <div class="toggle-group">
          <label>Launch automatically</label>
          <label class="switch">
            <input type="checkbox" data-field="scheduleEnabled">
            <span class="slider"></span>
          </label>
        </div>
        <div class="custom-schedule-block" data-role="schedule-settings">
          <div class="input-group">
            <label>Schedule rules</label>
            <select data-field="scheduleRuleCount" class="webhook-input">
              ${[1, 2, 3, 4, 5, 6].map(count => `<option value="${count}">${count}</option>`).join('')}
            </select>
          </div>
          <p class="help-text field-help">Each rule can run daily or only on selected weekdays. A rule with no selected day is inactive.</p>
          <div data-role="schedule-rules">
            ${DEFAULT_CUSTOM_RULE_TIMES.map((time, ruleIndex) => `
              <div class="schedule-rule" data-rule-index="${ruleIndex}">
                <p class="schedule-rule-title">Rule ${ruleIndex + 1}</p>
                <div class="rule-layout">
                  <div class="day-picker compact-day-picker">
                    ${SCHEDULE_DAY_CHOICES.map(([day, label]) => `
                      <label><input type="checkbox" data-role="rule-day" value="${day}"> ${label}</label>
                    `).join('')}
                  </div>
                  <div class="input-group">
                    <label for="custom-${workflowIndex}-time-${ruleIndex}">Local time</label>
                    <input type="time" id="custom-${workflowIndex}-time-${ruleIndex}" data-role="rule-time" class="webhook-input" value="${time}">
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </article>
  `).join('');
}

function renderAmazonScheduleSettings() {
  const container = document.getElementById('amazon-schedule-settings');
  container.innerHTML = `
    <div class="input-group">
      <label for="amazon-schedule-rule-count">Schedule rules</label>
      <select id="amazon-schedule-rule-count" class="webhook-input">
        ${[1, 2, 3, 4, 5, 6].map(count => `<option value="${count}">${count}</option>`).join('')}
      </select>
    </div>
    <div id="amazon-schedule-rules">
      ${DEFAULT_AMAZON_SCHEDULE_RULES.map((rule, ruleIndex) => `
        <div class="schedule-rule" data-rule-index="${ruleIndex}">
          <p class="schedule-rule-title">Rule ${ruleIndex + 1}</p>
          <div class="rule-layout">
            <div class="day-picker compact-day-picker">
              ${SCHEDULE_DAY_CHOICES.map(([day, label]) => `
                <label><input type="checkbox" data-role="amazon-rule-day" value="${day}"> ${label}</label>
              `).join('')}
            </div>
            <div class="input-group">
              <label for="amazon-rule-time-${ruleIndex}">Local time</label>
              <input type="time" id="amazon-rule-time-${ruleIndex}" data-role="amazon-rule-time" class="webhook-input" value="${rule.time}">
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function normalizeAmazonScheduleSettings(settings) {
  const legacyRuleCount = Math.min(6, Math.max(1, Number(settings.amazonRunsPerDay) || 1));
  const legacyTimes = Array.isArray(settings.amazonScheduleTimes)
    ? settings.amazonScheduleTimes
    : DEFAULT_AMAZON_SCHEDULE_TIMES;
  const savedRules = Array.isArray(settings.amazonScheduleRules)
    ? settings.amazonScheduleRules
    : legacyTimes.map(time => ({ days: [...ALL_SCHEDULE_DAYS], time }));
  return {
    ruleCount: settings.amazonScheduleRuleCount == null
      ? legacyRuleCount
      : Math.min(6, Math.max(1, Number(settings.amazonScheduleRuleCount) || 1)),
    rules: DEFAULT_AMAZON_SCHEDULE_RULES.map((defaultRule, index) => {
      const rule = savedRules[index] || {};
      return {
        days: Array.isArray(rule.days) ? rule.days : defaultRule.days,
        time: rule.time || defaultRule.time
      };
    })
  };
}

function readCustomWorkflowsFromForm() {
  return Array.from(document.querySelectorAll('.custom-workflow-card')).map((card, index) => ({
    id: CUSTOM_WORKFLOW_DEFAULTS[index].id,
    enabled: card.querySelector('[data-field="enabled"]').checked,
    name: card.querySelector('[data-field="name"]').value.trim() || CUSTOM_WORKFLOW_DEFAULTS[index].name,
    buttonColor: card.querySelector('[data-field="buttonColor"]').value || CUSTOM_WORKFLOW_DEFAULTS[index].buttonColor,
    sourceWebhook: card.querySelector('[data-field="sourceWebhook"]').value.trim(),
    destinationWebhook: card.querySelector('[data-field="destinationWebhook"]').value.trim(),
    maxLinks: normalizeLinkLimit(card.querySelector('[data-field="maxLinks"]').value),
    scheduleEnabled: card.querySelector('[data-field="scheduleEnabled"]').checked,
    scheduleRuleCount: Math.min(6, Math.max(1, Number(card.querySelector('[data-field="scheduleRuleCount"]').value) || 1)),
    scheduleRules: Array.from(card.querySelectorAll('.schedule-rule')).map(rule => ({
      days: Array.from(rule.querySelectorAll('[data-role="rule-day"]:checked')).map(input => Number(input.value)),
      time: rule.querySelector('[data-role="rule-time"]').value
    }))
  }));
}

function restoreCustomWorkflowSettings(value) {
  const workflows = normalizeCustomWorkflows(value);
  document.querySelectorAll('.custom-workflow-card').forEach((card, index) => {
    const workflow = workflows[index];
    card.querySelector('[data-field="enabled"]').checked = Boolean(workflow.enabled);
    card.querySelector('[data-field="name"]').value = workflow.name;
    card.querySelector('[data-field="buttonColor"]').value = workflow.buttonColor;
    card.querySelector('[data-field="sourceWebhook"]').value = workflow.sourceWebhook;
    card.querySelector('[data-field="destinationWebhook"]').value = workflow.destinationWebhook;
    card.querySelector('[data-field="maxLinks"]').value = workflow.maxLinks === 0 ? '' : workflow.maxLinks;
    card.querySelector('[data-field="scheduleEnabled"]').checked = Boolean(workflow.scheduleEnabled);
    card.querySelector('[data-field="scheduleRuleCount"]').value = workflow.scheduleRuleCount;
    card.querySelectorAll('.schedule-rule').forEach((ruleElement, ruleIndex) => {
      const rule = workflow.scheduleRules[ruleIndex];
      ruleElement.querySelector('[data-role="rule-time"]').value = rule.time;
      ruleElement.querySelectorAll('[data-role="rule-day"]').forEach(input => {
        input.checked = rule.days.map(Number).includes(Number(input.value));
      });
    });
  });
}

function normalizeLinkLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

// Saves options to storage on this PC only.
function save_options() {
  const liveWebhook = document.getElementById('live-webhook').value;
  const enableFetch = document.getElementById('fetch-switch').checked;
  const fetchUrl = document.getElementById('fetch-url').value;
  const generalMaxLinks = normalizeLinkLimit(document.getElementById('general-max-links').value);
  const minOpenTime = parseFloat(document.getElementById('min-open-time').value);
  const maxOpenTime = parseFloat(document.getElementById('max-open-time').value);
  const closeTabs = document.getElementById('close-tabs-switch').checked;
  const autoLaunchEnabled = document.getElementById('auto-launch-switch').checked;
  const autoLaunchInterval = parseFloat(document.getElementById('auto-launch-interval').value);
  const scheduleEnabled = document.getElementById('schedule-switch').checked;
  const scheduleDays = Array.from(document.querySelectorAll('[name="schedule-day"]:checked'))
    .map(input => Number(input.value));
  const scheduleStart = document.getElementById('schedule-start').value;
  const scheduleStop = document.getElementById('schedule-stop').value;
  const idleEnabled = document.getElementById('idle-switch').checked;
  const idleMinutes = parseFloat(document.getElementById('idle-minutes').value);
  const amazonPageCount = Number(document.getElementById('amazon-page-count').value);
  const amazonButtonLabel = document.getElementById('amazon-button-label').value.trim();
  const generalButtonLabel = document.getElementById('general-button-label').value.trim();
  const amazonButtonColor = document.getElementById('amazon-button-color').value;
  const generalButtonColor = document.getElementById('general-button-color').value;
  const amazonWebhook = document.getElementById('amazon-webhook').value.trim();
  const amazonScheduleEnabled = document.getElementById('amazon-schedule-switch').checked;
  const amazonScheduleRuleCount = Math.min(6, Math.max(1, Number(document.getElementById('amazon-schedule-rule-count').value) || 1));
  const amazonScheduleRules = Array.from(document.querySelectorAll('#amazon-schedule-rules .schedule-rule')).map((rule, index) => ({
    days: Array.from(rule.querySelectorAll('[data-role="amazon-rule-day"]:checked')).map(input => Number(input.value)),
    time: rule.querySelector('[data-role="amazon-rule-time"]').value || DEFAULT_AMAZON_SCHEDULE_TIMES[index]
  }));
  const customWorkflows = readCustomWorkflowsFromForm();

  // Toggle visibility of fetch settings depending on enableFetch selection
  document.getElementById('fetch-url-group').style.display = enableFetch ? 'block' : 'none';
  updateAutoLaunchVisibility();

  chrome.storage.local.set({
    liveWebhook: liveWebhook,
    enableFetch: enableFetch,
    fetchUrl: fetchUrl,
    generalMaxLinks: generalMaxLinks,
    minOpenTime: isNaN(minOpenTime) ? 1.0 : minOpenTime,
    maxOpenTime: isNaN(maxOpenTime) ? 3.0 : maxOpenTime,
    closeTabs: closeTabs,
    autoLaunchEnabled: autoLaunchEnabled,
    autoLaunchInterval: isNaN(autoLaunchInterval) ? 15 : Math.max(0.5, autoLaunchInterval),
    scheduleEnabled: scheduleEnabled,
    scheduleDays: scheduleDays,
    scheduleStart: scheduleStart || '00:00',
    scheduleStop: scheduleStop || '00:00',
    idleEnabled: idleEnabled,
    idleMinutes: isNaN(idleMinutes) ? 10 : Math.max(0.25, idleMinutes),
    amazonPageCount: Number.isSafeInteger(amazonPageCount) && amazonPageCount >= 1 && amazonPageCount <= 1000
      ? amazonPageCount
      : 1,
    amazonButtonLabel: amazonButtonLabel || 'Track Amazon orders',
    generalButtonLabel: generalButtonLabel || 'Run general workflow',
    amazonButtonColor: amazonButtonColor || '#f59e0b',
    generalButtonColor: generalButtonColor || '#2563eb',
    amazonWebhook: amazonWebhook,
    amazonScheduleEnabled: amazonScheduleEnabled,
    amazonScheduleRuleCount: amazonScheduleRuleCount,
    amazonScheduleRules: amazonScheduleRules,
    customWorkflows: customWorkflows
  }, function() {
    // Update status to let user know options were saved.
    const status = document.getElementById('status-message');
    status.textContent = 'Options saved.';
    setTimeout(function() {
      status.textContent = '';
    }, 1500);
  });
}

// Restores select box and checkbox state using the preferences
// stored locally on this PC.
function restore_options() {
  chrome.storage.local.get({
    liveWebhook: '',
    enableFetch: false,
    fetchUrl: '',
    generalMaxLinks: 0,
    minOpenTime: 1.0,
    maxOpenTime: 3.0,
    closeTabs: false,
    autoLaunchEnabled: false,
    autoLaunchInterval: 15,
    scheduleEnabled: false,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    scheduleStart: '09:00',
    scheduleStop: '17:00',
    idleEnabled: false,
    idleMinutes: 10,
    amazonPageCount: 1,
    amazonButtonLabel: 'Track Amazon orders',
    generalButtonLabel: 'Run general workflow',
    amazonButtonColor: '#f59e0b',
    generalButtonColor: '#2563eb',
    amazonWebhook: '',
    amazonScheduleEnabled: false,
    amazonScheduleRuleCount: null,
    amazonScheduleRules: null,
    amazonRunsPerDay: 1,
    amazonScheduleTimes: DEFAULT_AMAZON_SCHEDULE_TIMES,
    customWorkflows: CUSTOM_WORKFLOW_DEFAULTS
  }, function(items) {
    document.getElementById('live-webhook').value = items.liveWebhook;
    document.getElementById('fetch-switch').checked = items.enableFetch;
    document.getElementById('fetch-url').value = items.fetchUrl;
    document.getElementById('general-max-links').value = items.generalMaxLinks === 0 ? '' : items.generalMaxLinks;
    document.getElementById('min-open-time').value = items.minOpenTime;
    document.getElementById('max-open-time').value = items.maxOpenTime;
    document.getElementById('close-tabs-switch').checked = items.closeTabs;
    document.getElementById('auto-launch-switch').checked = items.autoLaunchEnabled;
    document.getElementById('auto-launch-interval').value = items.autoLaunchInterval;
    document.getElementById('schedule-switch').checked = items.scheduleEnabled;
    document.querySelectorAll('[name="schedule-day"]').forEach(input => {
      input.checked = items.scheduleDays.includes(Number(input.value));
    });
    document.getElementById('schedule-start').value = items.scheduleStart;
    document.getElementById('schedule-stop').value = items.scheduleStop;
    document.getElementById('idle-switch').checked = items.idleEnabled;
    document.getElementById('idle-minutes').value = items.idleMinutes;
    document.getElementById('amazon-page-count').value = items.amazonPageCount;
    document.getElementById('amazon-button-label').value = items.amazonButtonLabel;
    document.getElementById('general-button-label').value = items.generalButtonLabel;
    document.getElementById('amazon-button-color').value = items.amazonButtonColor;
    document.getElementById('general-button-color').value = items.generalButtonColor;
    document.getElementById('amazon-webhook').value = items.amazonWebhook;
    document.getElementById('amazon-schedule-switch').checked = items.amazonScheduleEnabled;
    const amazonSchedule = normalizeAmazonScheduleSettings(items);
    document.getElementById('amazon-schedule-rule-count').value = amazonSchedule.ruleCount;
    document.querySelectorAll('#amazon-schedule-rules .schedule-rule').forEach((ruleElement, index) => {
      const rule = amazonSchedule.rules[index];
      ruleElement.querySelector('[data-role="amazon-rule-time"]').value = rule.time;
      ruleElement.querySelectorAll('[data-role="amazon-rule-day"]').forEach(input => {
        input.checked = rule.days.map(Number).includes(Number(input.value));
      });
    });
    restoreCustomWorkflowSettings(items.customWorkflows);

    // Set initial visibility of inputs
    document.getElementById('fetch-url-group').style.display = items.enableFetch ? 'block' : 'none';
    updateAutoLaunchVisibility();
  });
}

function updateAutoLaunchVisibility() {
  const autoLaunchEnabled = document.getElementById('auto-launch-switch').checked;
  const scheduleEnabled = document.getElementById('schedule-switch').checked;
  const idleEnabled = document.getElementById('idle-switch').checked;
  document.getElementById('auto-launch-settings').style.display = autoLaunchEnabled ? 'block' : 'none';
  document.getElementById('schedule-settings').style.display = scheduleEnabled ? 'block' : 'none';
  document.getElementById('idle-settings').style.display = idleEnabled ? 'block' : 'none';
  const amazonScheduleEnabled = document.getElementById('amazon-schedule-switch').checked;
  const amazonScheduleRuleCount = Math.min(6, Math.max(1, Number(document.getElementById('amazon-schedule-rule-count').value) || 1));
  document.getElementById('amazon-schedule-settings').style.display = amazonScheduleEnabled ? 'block' : 'none';
  document.querySelectorAll('#amazon-schedule-rules .schedule-rule').forEach((rule, index) => {
    rule.style.display = index < amazonScheduleRuleCount ? 'block' : 'none';
  });
  document.querySelectorAll('.custom-workflow-card').forEach(card => {
    const enabled = card.querySelector('[data-field="enabled"]').checked;
    const scheduleEnabled = card.querySelector('[data-field="scheduleEnabled"]').checked;
    const ruleCount = Math.min(6, Math.max(1, Number(card.querySelector('[data-field="scheduleRuleCount"]').value) || 1));
    card.querySelector('.custom-workflow-body').style.display = enabled ? 'block' : 'none';
    card.querySelector('[data-role="schedule-settings"]').style.display = scheduleEnabled ? 'block' : 'none';
    card.querySelectorAll('.schedule-rule').forEach((rule, index) => {
      rule.style.display = index < ruleCount ? 'block' : 'none';
    });
  });
}

async function renderKeyboardShortcuts() {
  const shortcutList = document.getElementById('shortcut-list');
  try {
    const commands = await chrome.commands.getAll();
    shortcutList.replaceChildren(...commands.map(command => {
      const row = document.createElement('div');
      row.className = 'shortcut-row';

      const description = document.createElement('span');
      description.textContent = command.description || command.name;

      const shortcut = document.createElement('kbd');
      shortcut.textContent = command.shortcut || 'Not assigned';
      shortcut.classList.toggle('unassigned', !command.shortcut);

      row.append(description, shortcut);
      return row;
    }));
  } catch (error) {
    shortcutList.textContent = 'Could not load keyboard shortcuts.';
  }
}

renderAmazonScheduleSettings();
renderCustomWorkflowSettings();
document.addEventListener('DOMContentLoaded', () => {
  restore_options();
  renderKeyboardShortcuts();
});
window.addEventListener('focus', renderKeyboardShortcuts);
document.getElementById('live-webhook').addEventListener('input', save_options);
document.getElementById('fetch-switch').addEventListener('change', save_options);
document.getElementById('fetch-url').addEventListener('input', save_options);
document.getElementById('general-max-links').addEventListener('input', save_options);
document.getElementById('min-open-time').addEventListener('input', save_options);
document.getElementById('max-open-time').addEventListener('input', save_options);
document.getElementById('close-tabs-switch').addEventListener('change', save_options);
document.getElementById('auto-launch-switch').addEventListener('change', save_options);
document.getElementById('auto-launch-interval').addEventListener('input', save_options);
document.getElementById('schedule-switch').addEventListener('change', save_options);
document.querySelectorAll('[name="schedule-day"]').forEach(input => input.addEventListener('change', save_options));
document.getElementById('schedule-start').addEventListener('change', save_options);
document.getElementById('schedule-stop').addEventListener('change', save_options);
document.getElementById('idle-switch').addEventListener('change', save_options);
document.getElementById('idle-minutes').addEventListener('input', save_options);
document.getElementById('amazon-page-count').addEventListener('input', save_options);
document.getElementById('amazon-button-label').addEventListener('input', save_options);
document.getElementById('general-button-label').addEventListener('input', save_options);
document.getElementById('amazon-button-color').addEventListener('input', save_options);
document.getElementById('general-button-color').addEventListener('input', save_options);
document.getElementById('amazon-webhook').addEventListener('input', save_options);
document.getElementById('amazon-schedule-switch').addEventListener('change', save_options);
document.getElementById('amazon-schedule-settings').addEventListener('input', save_options);
document.getElementById('custom-workflows').addEventListener('input', save_options);
document.getElementById('open-shortcut-settings').addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  } catch (error) {
    const status = document.getElementById('status-message');
    status.textContent = 'Open chrome://extensions/shortcuts in the address bar.';
  }
});
