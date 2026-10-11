/**
 * ExaminationLock - Popup Controls Script
 * Manages proctor status view, security configuration, and audit logs.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  // Status Elements
  const targetUrlEl = document.getElementById("status-target-url");
  const activeTabEl = document.getElementById("status-active-tab");
  const lockStateEl = document.getElementById("status-lock-state");
  const systemStatusBadge = document.getElementById("system-status-badge");
  const systemStatusText = document.getElementById("system-status-text");

  // PIN & Action controls
  const pinInput = document.getElementById("popup-proctor-pin");
  const btnUnlock = document.getElementById("btn-popup-unlock");
  const btnResetStrikes = document.getElementById("btn-popup-reset-strikes");
  const pinFeedback = document.getElementById("pin-feedback");
  const btnOpenTestForm = document.getElementById("btn-open-test-form");

  // Settings inputs
  const inputExamActive = document.getElementById("setting-examActive");
  const inputMaxStrikes = document.getElementById("setting-maxStrikes");
  const inputEnforceFullscreen = document.getElementById("setting-enforceFullscreen");
  const inputBlockNewTabs = document.getElementById("setting-blockNewTabs");
  const inputBlockCopyPaste = document.getElementById("setting-blockCopyPaste");
  const inputBlockScreenshots = document.getElementById("setting-blockScreenshots");
  const inputBlockDevTools = document.getElementById("setting-blockDevTools");
  const inputSoundAlerts = document.getElementById("setting-soundAlerts");
  const inputProctorPin = document.getElementById("setting-proctorPin");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  // Logs Elements
  const logsCountBadge = document.getElementById("logs-count-badge");
  const logsList = document.getElementById("logs-list");
  const btnExportLogs = document.getElementById("btn-export-logs");
  const btnClearLogs = document.getElementById("btn-clear-logs");

  let currentSettings = {};
  let currentActiveExamTabId = null;

  // 1. Tab Navigation
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const targetTab = btn.getAttribute("data-tab");
      document.getElementById(`tab-${targetTab}`).classList.add("active");

      if (targetTab === "logs") {
        loadIncidentLogs();
      }
    });
  });

  // 2. Load Status & Settings
  async function loadInitialData() {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
      if (!response) return;
      currentSettings = response.settings || {};
      currentActiveExamTabId = response.activeExamTabId;

      // Populate settings form
      if (inputExamActive) inputExamActive.checked = !!currentSettings.examActive;
      if (inputMaxStrikes) inputMaxStrikes.value = currentSettings.maxStrikes || 3;
      if (inputEnforceFullscreen) inputEnforceFullscreen.checked = !!currentSettings.enforceFullscreen;
      if (inputBlockNewTabs) inputBlockNewTabs.checked = !!currentSettings.blockNewTabs;
      if (inputBlockCopyPaste) inputBlockCopyPaste.checked = !!currentSettings.blockCopyPaste;
      if (inputBlockScreenshots) inputBlockScreenshots.checked = !!currentSettings.blockScreenshots;
      if (inputBlockDevTools) inputBlockDevTools.checked = !!currentSettings.blockDevTools;
      if (inputSoundAlerts) inputSoundAlerts.checked = !!currentSettings.soundAlerts;
      if (inputProctorPin) inputProctorPin.value = currentSettings.proctorPin || "1234";

      // Update Live Status tab
      if (response.isSessionLocked) {
        lockStateEl.textContent = "Locked (Violations Exceeded)";
        lockStateEl.className = "value badge-locked";
      } else {
        lockStateEl.textContent = "Normal";
        lockStateEl.className = "value badge-normal";
      }

      if (currentActiveExamTabId) {
        activeTabEl.textContent = `Tab #${currentActiveExamTabId}`;
      } else {
        activeTabEl.textContent = "None Active";
      }
    });

    // Check currently focused tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        const url = tabs[0].url || "";
        targetUrlEl.textContent = url.length > 30 ? url.substring(0, 27) + "..." : url;

        if (url.includes("docs.google.com/forms") || url.includes("forms.gle")) {
          systemStatusText.textContent = "Protecting Form";
        } else {
          systemStatusText.textContent = "Standby";
        }
      }
    });
  }

  // 3. Save Settings
  if (btnSaveSettings) {
    btnSaveSettings.addEventListener("click", () => {
      const updated = {
        examActive: inputExamActive.checked,
        maxStrikes: parseInt(inputMaxStrikes.value, 10) || 3,
        enforceFullscreen: inputEnforceFullscreen.checked,
        blockNewTabs: inputBlockNewTabs.checked,
        blockCopyPaste: inputBlockCopyPaste.checked,
        blockScreenshots: inputBlockScreenshots.checked,
        blockDevTools: inputBlockDevTools.checked,
        soundAlerts: inputSoundAlerts.checked,
        proctorPin: inputProctorPin.value.trim() || "1234"
      };

      chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings: updated }, () => {
        btnSaveSettings.textContent = "✓ Settings Saved!";
        setTimeout(() => {
          btnSaveSettings.textContent = "Save Security Rules";
        }, 1500);
      });
    });
  }

  // 4. Quick Proctor Actions
  function verifyPinEntered() {
    const entered = (pinInput.value || "").trim();
    if (!entered) {
      showPinFeedback("Please enter Proctor PIN first.", "error");
      return false;
    }
    if (entered !== String(currentSettings.proctorPin).trim()) {
      showPinFeedback("Incorrect Proctor PIN.", "error");
      return false;
    }
    return true;
  }

  function showPinFeedback(msg, type) {
    if (!pinFeedback) return;
    pinFeedback.textContent = msg;
    pinFeedback.className = `feedback-msg ${type}`;
    setTimeout(() => {
      pinFeedback.textContent = "";
      pinFeedback.className = "feedback-msg";
    }, 3000);
  }

  if (btnUnlock) {
    btnUnlock.addEventListener("click", () => {
      if (!verifyPinEntered()) return;
      chrome.runtime.sendMessage({ type: "PROCTOR_UNLOCK", pin: pinInput.value.trim() }, (res) => {
        if (res && res.success) {
          showPinFeedback("Exam tab successfully unlocked!", "success");
          lockStateEl.textContent = "Unlocked";
          lockStateEl.className = "value badge-normal";
        } else {
          showPinFeedback("Unlock failed.", "error");
        }
      });
    });
  }

  if (btnResetStrikes) {
    btnResetStrikes.addEventListener("click", () => {
      if (!verifyPinEntered()) return;
      if (currentActiveExamTabId) {
        chrome.tabs.sendMessage(currentActiveExamTabId, { type: "FORCE_UNLOCK" }, () => {
          showPinFeedback("Strikes reset to 0.", "success");
        });
      } else {
        showPinFeedback("No active exam tab connected.", "error");
      }
    });
  }

  const btnDisableLock = document.getElementById("btn-popup-disable-lock");
  if (btnDisableLock) {
    btnDisableLock.addEventListener("click", () => {
      if (!verifyPinEntered()) return;
      chrome.runtime.sendMessage({
        type: "DISABLE_SESSION_FOR_TAB",
        pin: pinInput.value.trim(),
        tabId: currentActiveExamTabId
      }, (res) => {
        if (res && res.success) {
          showPinFeedback("Lock successfully disabled for tab.", "success");
          lockStateEl.textContent = "Disabled";
          lockStateEl.className = "value badge-normal";
          activeTabEl.textContent = "None Active";
        } else {
          showPinFeedback("Failed to disable lock.", "error");
        }
      });
    });
  }

  // 5. Open Test Google Form
  if (btnOpenTestForm) {
    btnOpenTestForm.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: "https://forms.gle/rhFbggfrh8if1zqp7" });
    });
  }

  // 6. Incident Logs Tab
  let cachedLogs = [];
  function loadIncidentLogs() {
    chrome.runtime.sendMessage({ type: "GET_INCIDENT_LOGS" }, (res) => {
      cachedLogs = (res && res.logs) || [];
      if (logsCountBadge) logsCountBadge.textContent = `${cachedLogs.length} Incidents Logged`;

      if (!logsList) return;
      if (cachedLogs.length === 0) {
        logsList.innerHTML = `<div class="empty-logs">No violations recorded yet.</div>`;
        return;
      }

      logsList.innerHTML = "";
      // Render reverse order (newest first)
      [...cachedLogs].reverse().forEach((log) => {
        const item = document.createElement("div");
        const isInfo = log.type === "SESSION_STARTED" || log.type === "SESSION_ENDED" || log.type === "PROCTOR_OVERRIDE";
        item.className = `log-entry ${isInfo ? "info" : ""}`;

        const timeStr = log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "";
        item.innerHTML = `
          <div class="log-header ${isInfo ? "info" : ""}">
            <span>${log.reason || log.type}</span>
            <span class="log-time">${timeStr}</span>
          </div>
          <div class="log-details">${log.details || "-"}</div>
        `;
        logsList.appendChild(item);
      });
    });
  }

  // Export CSV
  if (btnExportLogs) {
    btnExportLogs.addEventListener("click", () => {
      if (!cachedLogs || cachedLogs.length === 0) {
        alert("No incident logs to export.");
        return;
      }
      const headers = ["ID", "Timestamp", "Type", "Reason", "Details"];
      const rows = cachedLogs.map((l) => [
        l.id || "",
        l.timestamp || "",
        l.type || "",
        `"${(l.reason || "").replace(/"/g, '""')}"`,
        `"${(l.details || "").replace(/"/g, '""')}"`
      ]);

      const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `ExaminationLock_Incident_Logs_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  }

  // Clear Logs
  if (btnClearLogs) {
    btnClearLogs.addEventListener("click", () => {
      const pin = prompt("Enter Proctor Master PIN to clear audit trail:");
      if (!pin) return;
      chrome.runtime.sendMessage({ type: "CLEAR_INCIDENT_LOGS", pin: pin.trim() }, (res) => {
        if (res && res.success) {
          alert("Audit logs successfully cleared.");
          loadIncidentLogs();
        } else {
          alert("Invalid Proctor PIN. Action aborted.");
        }
      });
    });
  }

  // Initial load
  loadInitialData();
});
