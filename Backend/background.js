/**
 * ExaminationLock - Background Service Worker (Manifest V3)
 * Handles tab lifecycle monitoring, window focus tracking, tab creation blocking,
 * and centralized session security management.
 */

const DEFAULT_SETTINGS = {
  examActive: true,
  maxStrikes: 3,
  enforceFullscreen: true,
  blockNewTabs: true,
  autoCloseNewTabs: true,
  blockCopyPaste: true,
  blockScreenshots: true,
  blockContextMenu: true,
  blockDevTools: true,
  soundAlerts: true,
  proctorPin: "1234",
  autoFocusBack: true
};

let activeExamTabId = null;
let activeExamWindowId = null;
let isSessionLocked = false;

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(null);
  const newSettings = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(current)) {
    if (value !== undefined) {
      newSettings[key] = value;
    }
  }
  await chrome.storage.local.set(newSettings);
  console.log("[ExaminationLock] Installed with settings:", newSettings);
});

// Helper to get fresh settings
async function getSettings() {
  const data = await chrome.storage.local.get(null);
  return { ...DEFAULT_SETTINGS, ...data };
}

// Log an incident to persistent storage
async function logIncident(incident) {
  const data = await chrome.storage.local.get(["incidentLogs"]);
  const logs = data.incidentLogs || [];
  const entry = {
    id: Date.now() + "-" + Math.random().toString(36).substr(2, 5),
    timestamp: new Date().toISOString(),
    ...incident
  };
  logs.push(entry);
  // Keep last 500 records
  if (logs.length > 500) logs.shift();
  await chrome.storage.local.set({ incidentLogs: logs });
  return entry;
}

// Intercept new tabs creation during active examination
chrome.tabs.onCreated.addListener(async (tab) => {
  const settings = await getSettings();
  if (!settings.examActive || !activeExamTabId) return;

  // If a tab is being opened while exam is active and it's not the exam tab itself
  if (tab.id !== activeExamTabId) {
    console.warn("[ExaminationLock] Unauthorized tab creation detected:", tab.id);

    // Record violation
    await logIncident({
      type: "NEW_TAB_ATTEMPT",
      reason: "Attempted to open a new browser tab",
      details: tab.pendingUrl || tab.url || "about:blank",
      tabId: tab.id
    });

    // Notify exam tab
    try {
      await chrome.tabs.sendMessage(activeExamTabId, {
        type: "SECURITY_VIOLATION",
        violation: {
          type: "NEW_TAB_ATTEMPT",
          reason: "Attempted to open a new tab",
          details: "Opening additional browser tabs is forbidden during exams."
        }
      });
    } catch (e) {
      // Tab might still be initializing or unavailable
    }

    // Auto-close new tab if enabled
    if (settings.autoCloseNewTabs && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (err) {
        console.error("Failed to close unauthorized tab:", err);
      }
    }

    // Force focus back to exam tab
    if (settings.autoFocusBack && activeExamTabId) {
      try {
        await chrome.tabs.update(activeExamTabId, { active: true });
        if (activeExamWindowId) {
          await chrome.windows.update(activeExamWindowId, { focused: true });
        }
      } catch (err) {
        console.error("Failed to refocus exam tab:", err);
      }
    }
  }
});

// Intercept tab switching during active examination
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const settings = await getSettings();
  if (!settings.examActive || !activeExamTabId) return;

  // Student switched to a different tab
  if (activeInfo.tabId !== activeExamTabId) {
    console.warn("[ExaminationLock] Unauthorized tab switch detected:", activeInfo.tabId);

    // Record violation
    await logIncident({
      type: "TAB_SWITCH",
      reason: "Switched to another tab",
      details: `Switched away to tab ${activeInfo.tabId}`,
      tabId: activeInfo.tabId
    });

    // Send violation message to exam tab
    try {
      await chrome.tabs.sendMessage(activeExamTabId, {
        type: "SECURITY_VIOLATION",
        violation: {
          type: "TAB_SWITCH",
          reason: "Switched to another tab",
          details: "Navigating away from the Google Form is considered a test violation."
        }
      });
    } catch (e) {}

    // Pull focus back if autoFocusBack is enabled
    if (settings.autoFocusBack) {
      try {
        await chrome.tabs.update(activeExamTabId, { active: true });
      } catch (err) {}
    }
  }
});

// Intercept browser window focus changes (switching to desktop apps e.g. Discord, Notes, ChatGPT)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const settings = await getSettings();
  if (!settings.examActive || !activeExamTabId) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE || (activeExamWindowId && windowId !== activeExamWindowId)) {
    console.warn("[ExaminationLock] Browser window lost focus!");

    // Record window blur violation
    await logIncident({
      type: "WINDOW_BLUR",
      reason: "Left browser window (switched to external app)",
      details: "Application focus shifted away from the browser window."
    });

    try {
      await chrome.tabs.sendMessage(activeExamTabId, {
        type: "SECURITY_VIOLATION",
        violation: {
          type: "WINDOW_BLUR",
          reason: "Switched application or left browser",
          details: "Leaving the exam window to view other programs is prohibited."
        }
      });
    } catch (e) {}
  }
});

// Tab removal listener (cleanup if exam tab is closed)
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeExamTabId) {
    console.log("[ExaminationLock] Active exam tab was closed.");
    activeExamTabId = null;
    activeExamWindowId = null;
    isSessionLocked = false;
  }
});

// Message handling between content script, popup, and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case "REGISTER_EXAM_SESSION": {
        if (sender.tab) {
          activeExamTabId = sender.tab.id;
          activeExamWindowId = sender.tab.windowId;
          isSessionLocked = false;
          console.log("[ExaminationLock] Registered exam tab:", activeExamTabId);
          await logIncident({
            type: "SESSION_STARTED",
            reason: "Examination session initiated",
            details: `Exam started on URL: ${sender.tab.url}`
          });
          sendResponse({ success: true, tabId: activeExamTabId });
        } else {
          sendResponse({ success: false, error: "No tab found" });
        }
        break;
      }

      case "END_EXAM_SESSION": {
        console.log("[ExaminationLock] Ending exam session");
        await logIncident({
          type: "SESSION_ENDED",
          reason: "Examination session completed or ended",
          details: "Exam submitted or terminated by user/proctor."
        });
        activeExamTabId = null;
        activeExamWindowId = null;
        isSessionLocked = false;
        sendResponse({ success: true });
        break;
      }

      case "RECORD_VIOLATION": {
        const incident = await logIncident(message.violation);
        sendResponse({ success: true, incident });
        break;
      }

      case "GET_SETTINGS": {
        const settings = await getSettings();
        sendResponse({
          settings,
          activeExamTabId,
          isSessionLocked
        });
        break;
      }

      case "UPDATE_SETTINGS": {
        await chrome.storage.local.set(message.settings);
        sendResponse({ success: true });
        break;
      }

      case "VERIFY_PIN": {
        const settings = await getSettings();
        const valid = String(message.pin).trim() === String(settings.proctorPin).trim();
        sendResponse({ valid });
        break;
      }

      case "PROCTOR_UNLOCK": {
        const settings = await getSettings();
        if (String(message.pin).trim() === String(settings.proctorPin).trim()) {
          isSessionLocked = false;
          if (activeExamTabId) {
            try {
              await chrome.tabs.sendMessage(activeExamTabId, { type: "FORCE_UNLOCK" });
            } catch (e) {}
          }
          await logIncident({
            type: "PROCTOR_OVERRIDE",
            reason: "Proctor manual unlock executed",
            details: "Exam was unlocked using Proctor Master PIN."
          });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Invalid PIN" });
        }
        break;
      }

      case "DISABLE_SESSION_FOR_TAB": {
        const settings = await getSettings();
        if (String(message.pin).trim() === String(settings.proctorPin).trim()) {
          const targetTabId = message.tabId || activeExamTabId;
          if (targetTabId) {
            try {
              await chrome.tabs.sendMessage(targetTabId, { type: "DISABLE_LOCK_COMMAND" });
            } catch (e) {}
          }
          activeExamTabId = null;
          activeExamWindowId = null;
          isSessionLocked = false;
          await logIncident({
            type: "LOCK_DISABLED",
            reason: "ExaminationLock disabled by proctor",
            details: "Lock was turned off for the session using Proctor Master PIN."
          });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Invalid PIN" });
        }
        break;
      }

      case "GET_INCIDENT_LOGS": {
        const data = await chrome.storage.local.get(["incidentLogs"]);
        sendResponse({ logs: data.incidentLogs || [] });
        break;
      }

      case "CLEAR_INCIDENT_LOGS": {
        const settings = await getSettings();
        if (String(message.pin).trim() === String(settings.proctorPin).trim()) {
          await chrome.storage.local.set({ incidentLogs: [] });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "Invalid PIN" });
        }
        break;
      }

      default:
        sendResponse({ unknown: true });
        break;
    }
  })();
  return true; // Keep message channel open for async response
});
