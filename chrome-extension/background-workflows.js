'use strict';

let isSending = false;
let stopRequested = false;
let activeRunAbortController = null;
let animationInterval = null;
let queueSequence = 0;
let queueDrainTimer = null;
let queueDispatching = false;
let queueCancellationGeneration = 0;
let queuePersistencePromise = Promise.resolve();
const pendingRuns = [];

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
  const cancellationGeneration = queueCancellationGeneration;
  const job = pendingRuns.shift();
  try {
    try {
      await persistPendingRuns();
    } catch (error) {
      console.error('Could not update the session queue before starting a run:', error);
    }
    if (cancellationGeneration !== queueCancellationGeneration) {
      console.log('Discarded a workflow that was being removed from the queue when Stop was requested.');
      return;
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

function requestWorkflowStop() {
  const hadQueuedWork = pendingRuns.length > 0 || queueDispatching || queueDrainTimer !== null;
  if (!isSending && !hadQueuedWork) {
    console.log('Stop requested, but no workflow is running or queued.');
    return { accepted: false, discarded: 0 };
  }

  queueCancellationGeneration += 1;
  if (queueDrainTimer !== null) {
    clearTimeout(queueDrainTimer);
    queueDrainTimer = null;
  }
  const discarded = pendingRuns.length + (queueDispatching ? 1 : 0);
  pendingRuns.length = 0;
  persistPendingRuns().catch(error => {
    console.error('Could not persist the cleared workflow queue:', error);
  });

  if (isSending) {
    stopRequested = true;
    activeRunAbortController?.abort();
  }
  console.log(`Stop requested. Cancelling the active workflow and discarding ${discarded} queued workflow(s).`);
  return { accepted: true, discarded };
}

function isAbortError(error) {
  return error && error.name === 'AbortError';
}

function throwIfWorkflowStopped(signal) {
  if (stopRequested || signal?.aborted) {
    throw new DOMException('Workflow stopped by the user.', 'AbortError');
  }
}

function waitForDelay(delayMs, signal) {
  if (!delayMs) {
    throwIfWorkflowStopped(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new DOMException('Workflow stopped by the user.', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function waitForOperation(operation, signal) {
  throwIfWorkflowStopped(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Workflow stopped by the user.', 'AbortError'));
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(operation).then(
      value => {
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
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
  const abortController = new AbortController();
  activeRunAbortController = abortController;
  const { signal } = abortController;
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
    if (activeRunAbortController === abortController) activeRunAbortController = null;
    isSending = false;
    stopRequested = false;
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
    if (activeRunAbortController === abortController) activeRunAbortController = null;
    isSending = false;
    stopRequested = false;
    if (!options.scheduled) chrome.runtime.openOptionsPage();
    scheduleQueueDrain();
    return;
  }
  if (customWorkflow && !customWorkflow.sourceWebhook) {
    console.error(`${customWorkflow.name} source webhook URL is not configured.`);
    if (activeRunAbortController === abortController) activeRunAbortController = null;
    isSending = false;
    stopRequested = false;
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
    if (activeRunAbortController === abortController) activeRunAbortController = null;
    isSending = false;
    stopRequested = false;
    if (!options.scheduled) chrome.runtime.openOptionsPage();
    scheduleQueueDrain();
    return;
  }

  try {
    await startAnimation();

    if (isAmazonRun) {
      const links = buildAmazonOrdersLinks(options.amazonPageCount);
      console.log(`Generated ${links.length} Amazon order page link(s).`);
      await processLinksSequentially(links, settings, webhookUrl, signal);
      console.log('Finished sending Amazon order pages sequentially.');
      return;
    }

    if (customWorkflow) {
      const links = await fetchLinksFromSource(customWorkflow.sourceWebhook, normalizeLinkLimit(customWorkflow.maxLinks), signal);
      console.log(`${customWorkflow.name}: found ${links.length} link(s) to process.`);
      if (links.length > 0) {
        await processLinksSequentially(links, settings, webhookUrl, signal);
      }
      console.log(`Finished ${customWorkflow.name}.`);
      return;
    }

    // Pre-fetch links if enabled
    if (settings.enableFetch && settings.fetchUrl) {
      const links = await fetchLinksFromSource(settings.fetchUrl, normalizeLinkLimit(settings.generalMaxLinks), signal);

      console.log(`Found ${links.length} link(s) to process.`);

      if (links.length > 0) {
        await processLinksSequentially(links, settings, webhookUrl, signal);

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
        await processAndSendTab(tab.id, tab.url, webhookUrl, signal);
      } catch (error) {
        if (!isAbortError(error)) console.error(`Error processing tab: ${tab.url}`, error);
      }
    }

    console.log("Finished sending tabs.");
  } catch (err) {
    if (isAbortError(err)) {
      console.log('Workflow stopped by the user.');
    } else {
      console.error("Error in sendTabs:", err);
    }
  } finally {
    await stopAnimation();
    if (activeRunAbortController === abortController) activeRunAbortController = null;
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

async function processLinksSequentially(links, settings, webhookUrl, signal) {
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
      throwIfWorkflowStopped(signal);

      await waitForTabsToLoad([tabId], 30000, signal);

      const minSeconds = Math.max(0, Number(settings.minOpenTime) || 0);
      const maxSeconds = Math.max(minSeconds, Number(settings.maxOpenTime) || 0);
      const minMs = minSeconds * 1000;
      const maxMs = maxSeconds * 1000;
      const randomMs = minMs + Math.random() * (maxMs - minMs);
      console.log(`Keeping page open for ${randomMs.toFixed(0)}ms (range: ${minMs}ms - ${maxMs}ms)`);
      if (isAmazonDomain(url)) {
        throwIfWorkflowStopped(signal);
        await waitForOperation(showAmazonSequenceWidget(tabId, index + 1, links.length, randomMs), signal);
      }
      await waitForDelay(randomMs, signal);

      await processAndSendTab(tabId, url, webhookUrl, signal);
    } catch (err) {
      if (!isAbortError(err)) console.error(`Error processing URL sequentially: ${url}`, err);
    } finally {
      if (tabId && (settings.closeTabs || stopRequested)) {
        try {
          console.log(`Closing tab: ${tabId}`);
          await chrome.tabs.remove(tabId);
        } catch (_) { }
      } else if (tabId) {
        await removeAmazonSequenceWidget(tabId);
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

async function fetchLinksFromSource(sourceUrl, maxLinks, signal) {
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
  const response = await fetch(finalFetchUrl, { signal });
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

function waitForTabsToLoad(tabIds, timeoutMs = 30000, signal) {
  if (tabIds.length === 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const pendingTabIds = new Set(tabIds);
    let timeoutId;

    const cleanUp = () => {
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      chrome.tabs.onRemoved.removeListener(onRemovedListener);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);
      resolve();
    };

    const onAbort = () => {
      chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      chrome.tabs.onRemoved.removeListener(onRemovedListener);
      clearTimeout(timeoutId);
      reject(new DOMException('Workflow stopped by the user.', 'AbortError'));
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
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

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

