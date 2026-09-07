const status = document.getElementById('status');
const stopButton = document.getElementById('stop-run');
const stopLabel = document.getElementById('stop-label');
const amazonLimitInput = document.getElementById('amazon-page-limit');
const generalLimitInput = document.getElementById('general-link-limit');
let amazonPageCount = 1;
let customWorkflows = [];
let settingsSavePromise = Promise.resolve();
const runButtons = [
  document.getElementById('general-run'),
  document.getElementById('amazon-run')
];
const CUSTOM_WORKFLOW_DEFAULTS = [
  { id: 'custom-1', name: 'Workflow 1', buttonColor: '#7c3aed', enabled: false },
  { id: 'custom-2', name: 'Workflow 2', buttonColor: '#059669', enabled: false },
  { id: 'custom-3', name: 'Workflow 3', buttonColor: '#db2777', enabled: false }
];

function showStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function normalizeColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function contrastingTextColor(hexColor) {
  const channels = [1, 3, 5].map(index => parseInt(hexColor.slice(index, index + 2), 16) / 255);
  const linear = channels.map(channel => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkContrast = (luminance + 0.05) / 0.055;
  return whiteContrast >= darkContrast ? '#ffffff' : '#07111f';
}

function startRun(message) {
  runButtons.forEach(button => { button.disabled = true; });
  settingsSavePromise.then(() => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) {
      showStatus(chrome.runtime.lastError.message, true);
      runButtons.forEach(button => { button.disabled = false; });
      return;
    }

    if (!response || !response.started) {
      showStatus((response && response.error) || 'Could not start the run.', true);
      runButtons.forEach(button => { button.disabled = false; });
      return;
    }

    showStatus(response.queued ? 'Added to queue.' : 'Run starting.');
    setTimeout(() => window.close(), 350);
  })).catch(error => {
    console.error('Could not save workflow limit:', error);
    showStatus('Could not save the workflow limit.', true);
    runButtons.forEach(button => { button.disabled = false; });
  });
}

function normalizeLinkLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeAmazonPageCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : 1;
}

function saveSettings(update) {
  settingsSavePromise = settingsSavePromise
    .catch(error => console.error('Could not save workflow limit:', error))
    .then(() => chrome.storage.local.set(update));
}

function loadRunnerState() {
  chrome.runtime.sendMessage({ action: 'get-runner-state' }, response => {
    if (chrome.runtime.lastError || !response) return;
    stopButton.disabled = !response.running || response.stopping;
    stopLabel.textContent = response.stopping
      ? 'Stopping…'
      : 'Stop';
  });
}

function renderCustomWorkflowActions(value) {
  const saved = Array.isArray(value) ? value : [];
  customWorkflows = CUSTOM_WORKFLOW_DEFAULTS.map(defaultWorkflow => ({
    ...defaultWorkflow,
    ...(saved.find(workflow => workflow && workflow.id === defaultWorkflow.id) || {}),
    id: defaultWorkflow.id
  }));
  const workflows = customWorkflows.filter(workflow => workflow.enabled);
  if (workflows.length === 0) return;

  const section = document.getElementById('custom-workflow-section');
  const container = document.getElementById('custom-workflow-actions');
  section.hidden = false;
  for (const workflow of workflows) {
    const color = normalizeColor(workflow.buttonColor, '#475569');
    const row = document.createElement('div');
    const button = document.createElement('button');
    const limitInput = document.createElement('input');
    row.className = 'workflow-action-row custom-workflow-action';
    button.type = 'button';
    button.className = 'custom-workflow-button';
    button.textContent = workflow.name;
    button.style.setProperty('--workflow-button-bg', color);
    button.style.setProperty('--workflow-button-text', contrastingTextColor(color));
    button.addEventListener('click', () => {
      startRun({ action: 'start-custom-workflow', workflowId: workflow.id });
    });
    limitInput.type = 'number';
    limitInput.className = 'workflow-limit';
    limitInput.min = '0';
    limitInput.step = '1';
    limitInput.placeholder = '∞';
    limitInput.value = normalizeLinkLimit(workflow.maxLinks) || '';
    limitInput.setAttribute('aria-label', `${workflow.name} maximum links; empty or zero means unlimited`);
    limitInput.title = `${workflow.name} max links (0 or empty for unlimited)`;
    limitInput.addEventListener('input', () => {
      workflow.maxLinks = normalizeLinkLimit(limitInput.value);
      saveSettings({
        customWorkflows: customWorkflows.map(savedWorkflow => ({ ...savedWorkflow }))
      });
    });
    row.append(button, limitInput);
    container.appendChild(row);
    runButtons.push(button);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadRunnerState();
  try {
    const settings = await chrome.storage.local.get({
      amazonPageCount: 1,
      amazonButtonLabel: 'Track Amazon orders',
      generalButtonLabel: 'Run general workflow',
      amazonButtonColor: '#f59e0b',
      generalButtonColor: '#2563eb',
      generalMaxLinks: 0,
      customWorkflows: CUSTOM_WORKFLOW_DEFAULTS
    });
    const savedCount = Number(settings.amazonPageCount);
    amazonPageCount = Number.isSafeInteger(savedCount) && savedCount >= 1 && savedCount <= 1000
      ? savedCount
      : 1;
    document.getElementById('amazon-button-text').textContent = settings.amazonButtonLabel;
    document.getElementById('general-run').textContent = settings.generalButtonLabel;
    amazonLimitInput.value = amazonPageCount;
    generalLimitInput.value = normalizeLinkLimit(settings.generalMaxLinks) || '';
    const amazonColor = normalizeColor(settings.amazonButtonColor, '#f59e0b');
    const generalColor = normalizeColor(settings.generalButtonColor, '#2563eb');
    document.documentElement.style.setProperty('--amazon-button-bg', amazonColor);
    document.documentElement.style.setProperty('--amazon-button-text', contrastingTextColor(amazonColor));
    document.documentElement.style.setProperty('--general-button-bg', generalColor);
    document.documentElement.style.setProperty('--general-button-text', contrastingTextColor(generalColor));
    renderCustomWorkflowActions(settings.customWorkflows);
  } catch (error) {
    showStatus('Could not load saved settings.', true);
  } finally {
    runButtons.forEach(button => { button.disabled = false; });
  }
});

document.getElementById('general-run').addEventListener('click', () => {
  startRun({ action: 'start-general-run' });
});

document.getElementById('amazon-run').addEventListener('click', () => {
  startRun({ action: 'start-amazon-orders-run', pageCount: amazonPageCount });
});

amazonLimitInput.addEventListener('input', () => {
  amazonPageCount = normalizeAmazonPageCount(amazonLimitInput.value);
  saveSettings({ amazonPageCount });
});

amazonLimitInput.addEventListener('change', () => {
  amazonLimitInput.value = amazonPageCount;
});

generalLimitInput.addEventListener('input', () => {
  saveSettings({ generalMaxLinks: normalizeLinkLimit(generalLimitInput.value) });
});

stopButton.addEventListener('click', () => {
  stopButton.disabled = true;
  chrome.runtime.sendMessage({ action: 'stop-active-workflow' }, response => {
    if (chrome.runtime.lastError) {
      showStatus(chrome.runtime.lastError.message, true);
      loadRunnerState();
      return;
    }

    if (!response || !response.accepted) {
      showStatus('No workflow is currently running.', true);
      stopLabel.textContent = 'Stop';
      return;
    }

    stopLabel.textContent = 'Stopping…';
    showStatus('The current page will finish; no next page will open.');
  });
});

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
