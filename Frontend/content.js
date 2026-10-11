/**
 * ExaminationLock - Content Script
 * Injected into Google Forms to enforce anti-cheat proctoring:
 * - Only activates on actual examination links (/viewform, /preview, /formResponse)
 * - Ignores Form Editor (/edit), Form Creator (/create), or Forms Dashboard
 * - Enables proctor to turn off lock completely on any page using Proctor PIN
 * - Simple & Clean Google Forms Native White UI
 * - Fullscreen mode enforcement
 * - Offense warning modal & permanent lockout system
 * - Proctor PIN unlock and session recovery
 */

(function () {
  "use strict";

  // URL Filter: Only activate on student examination links
  function isExaminationPage() {
    const url = window.location.href.toLowerCase();

    // 1. Explicitly EXCLUDE form creation, editing, responses summary, or dashboard
    if (
      url.includes("/edit") ||
      url.includes("/create") ||
      url.includes("/analytics") ||
      url.includes("/responses") ||
      url.endsWith("/forms") ||
      url.endsWith("/forms/") ||
      (url.includes("/forms/u/") && !url.includes("viewform") && !url.includes("preview"))
    ) {
      console.log("[ExaminationLock] Form Editor / Creator / Dashboard detected. ExaminationLock is inactive.");
      return false;
    }

    // 3. Must be an actual respondent link
    const isRespondent = url.includes("/viewform") || url.includes("/preview") || url.includes("/formresponse");
    if (!isRespondent) {
      console.log("[ExaminationLock] Not a respondent examination link. Inactive.");
      return false;
    }

    return true;
  }

  // Abort immediately if not an actual examination page!
  if (!isExaminationPage()) {
    return;
  }

  // Prevent multiple injections
  if (window.__EXAM_LOCK_LOADED__) return;
  window.__EXAM_LOCK_LOADED__ = true;

  // State Management
  const state = {
    isActive: false,
    isLocked: false,
    strikes: 0,
    maxStrikes: 3,
    violations: [],
    startTime: null,
    timerInterval: null,
    lastBlurTime: null,
    inWarningModal: false,
    settings: {
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
      proctorPin: "1234"
    }
  };

  // Audio Synthesizer (Offline Web Audio API)
  let audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playAlertSound(type = "warning") {
    if (!state.settings.soundAlerts) return;
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === "warning") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === "lockout") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        osc.frequency.setValueAtTime(140, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.7);
      }
    } catch (e) {
      console.warn("[ExaminationLock] Web Audio alert failed:", e);
    }
  }

  // Fetch initial settings from background service worker
  function initSettings() {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
        if (response && response.settings) {
          state.settings = { ...state.settings, ...response.settings };
          state.maxStrikes = state.settings.maxStrikes || 3;
          updateHudStrikes();
        }
      });
    }
  }

  // Format Elapsed Time
  function formatTime(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }

  // Toast Notification helper
  let toastTimer = null;
  function showToast(message, duration = 3000) {
    const toast = document.getElementById("examlock-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, duration);
  }

  // Build and Inject UI Elements (Clean Google Forms Style)
  function createUI() {
    if (document.getElementById("examlock-root")) return;

    const root = document.createElement("div");
    root.id = "examlock-root";

    root.innerHTML = `
      <!-- Privacy Curtain (blurs form on tab switch or screenshot attempt) -->
      <div id="examlock-privacy-curtain" class="hidden">
        <div class="examlock-curtain-icon">🛡️</div>
        <div class="examlock-curtain-title">Examination in Progress</div>
        <div class="examlock-curtain-subtitle">
          Screen capture and background window inspection are prohibited.<br/>
          Please refocus this window immediately to resume.
        </div>
      </div>

      <!-- Floating HUD (Clean White Pill) -->
      <div id="examlock-hud" style="display: none;">
        <div class="examlock-hud-brand">
          <span class="examlock-hud-indicator"></span>
          <span>ExamLock</span>
        </div>
        <div class="examlock-hud-timer" id="examlock-hud-timer">00:00</div>
        <div class="examlock-hud-strikes">
          <span>Strikes:</span>
          <span class="examlock-hud-badge safe" id="examlock-hud-strikes-badge">0 / 3</span>
        </div>
        <button class="examlock-hud-btn" id="examlock-btn-proctor-panel" title="Proctor Panel">
          ⚙️
        </button>
      </div>

      <!-- Toast Notification -->
      <div id="examlock-toast" class="hidden"></div>

      <!-- Entrance Gateway Modal (Google Forms Aesthetic) -->
      <div id="examlock-gateway-modal" class="examlock-modal-backdrop">
        <div class="examlock-card">
          <div class="examlock-card-stripe"></div>
          <div class="examlock-card-body">
            <div class="examlock-header-row">
              <span class="examlock-header-icon">🛡️</span>
              <div>
                <h2 class="examlock-title">ExaminationLock Active</h2>
                <div class="examlock-subtitle" style="margin: 0;">Google Forms Proctored Mode</div>
              </div>
            </div>

            <p class="examlock-subtitle" style="margin-top: 10px;">
              This Google Form is protected by an Anti-Cheat Examination System.
              Please review the exam policies before proceeding:
            </p>

            <div class="examlock-rules-box">
              <div class="examlock-rule-row">
                <span class="examlock-rule-dot">🖥️</span>
                <span><strong>Fullscreen Enforced:</strong> The exam must be taken in full-screen. Exiting full-screen is recorded as an offense.</span>
              </div>
              <div class="examlock-rule-row">
                <span class="examlock-rule-dot">📑</span>
                <span><strong>No Tab Switching:</strong> Opening new tabs or switching to other windows is actively monitored and flagged.</span>
              </div>
              <div class="examlock-rule-row">
                <span class="examlock-rule-dot">🚫</span>
                <span><strong>Copy & Paste Blocked:</strong> Clipboard copy, cut, paste, and text selection are disabled.</span>
              </div>
              <div class="examlock-rule-row">
                <span class="examlock-rule-dot">📸</span>
                <span><strong>Screenshots Prohibited:</strong> PrintScreen key, screen snips, and page printing are blocked.</span>
              </div>
              <div class="examlock-rule-row">
                <span class="examlock-rule-dot">⚠️</span>
                <span><strong>Violation Threshold:</strong> Reaching <strong id="examlock-gateway-max-strikes">3</strong> strikes will permanently lock the exam.</span>
              </div>
            </div>

            <button class="examlock-btn-purple" id="examlock-btn-start-exam">
              Begin Proctored Examination
            </button>

            <!-- Turn Off Lock Button for Teachers / Proctors -->
            <button type="button" class="examlock-btn-text" id="examlock-btn-toggle-gateway-pin">
              Turn off lock for this form (Proctor Access)
            </button>

            <div id="examlock-gateway-pin-box" style="display: none; margin-top: 14px; background: #f8f9fa; padding: 14px; border-radius: 6px; border: 1px solid #dadce0;">
              <div style="font-size: 13px; color: #5f6368; margin-bottom: 8px;">Enter Proctor Master PIN to disable ExaminationLock:</div>
              <div class="examlock-pin-row">
                <input type="password" id="examlock-gateway-pin-input" class="examlock-pin-input" placeholder="Proctor PIN (Default: 1234)" autocomplete="off" />
                <button type="button" class="examlock-btn-unlock" id="examlock-btn-gateway-pin-confirm">Disable Lock</button>
              </div>
              <div id="examlock-gateway-pin-error" style="color: #d93025; font-size: 12px; margin-top: 6px; display: none;">✕ Incorrect Proctor PIN.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Violation Warning Modal -->
      <div id="examlock-warning-modal" class="examlock-modal-backdrop" style="display: none;">
        <div class="examlock-card">
          <div class="examlock-card-stripe stripe-danger"></div>
          <div class="examlock-card-body" style="text-align: center;">
            <div style="font-size: 38px; margin-bottom: 8px;">⚠️</div>
            <h2 class="examlock-title" style="color: #d93025; margin-bottom: 6px;">Security Violation Detected</h2>
            <div class="examlock-strike-pill" id="examlock-warning-strike-text">Strike 1 of 3</div>
            
            <div class="examlock-warning-box">
              <div class="examlock-warning-label" id="examlock-warning-reason-title">Violation Notice</div>
              <div class="examlock-warning-detail" id="examlock-warning-reason-text">
                Unauthorized activity detected during examination session.
              </div>
            </div>

            <button class="examlock-btn-danger" id="examlock-btn-acknowledge">
              I Acknowledge & Return to Exam
            </button>
          </div>
        </div>
      </div>

      <!-- Fullscreen Recovery Modal -->
      <div id="examlock-fullscreen-modal" class="examlock-modal-backdrop" style="display: none;">
        <div class="examlock-card">
          <div class="examlock-card-stripe stripe-warning"></div>
          <div class="examlock-card-body" style="text-align: center;">
            <div style="font-size: 38px; margin-bottom: 8px;">📺</div>
            <h2 class="examlock-title" style="margin-bottom: 8px;">Full Screen Exited</h2>
            <p class="examlock-subtitle">
              Exiting full screen is prohibited during proctored examinations.
              Please click below to restore full screen and continue.
            </p>
            <button class="examlock-btn-purple" id="examlock-btn-resume-fs">
              Restore Full Screen Mode
            </button>
          </div>
        </div>
      </div>

      <!-- Permanent Lockout Screen -->
      <div id="examlock-lockout-modal" style="display: none;">
        <div class="examlock-lockout-card">
          <div class="examlock-card-stripe stripe-danger"></div>
          <div class="examlock-card-body">
            <div class="examlock-lockout-badge">EXAM SUSPENDED</div>
            <h1 class="examlock-title" style="font-size: 24px; margin-bottom: 6px;">Examination Session Locked</h1>
            <p class="examlock-subtitle">
              This examination session has been suspended due to exceeding the maximum allowed security violations.
              Form inputs have been disabled. A proctor or instructor must authorize unlocking.
            </p>

            <div class="examlock-table-container">
              <table class="examlock-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Offense</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody id="examlock-lockout-table-body">
                  <!-- Infractions will be populated here -->
                </tbody>
              </table>
            </div>

            <div style="margin-bottom: 12px;">
              <button type="button" class="examlock-btn-export-csv" id="examlock-btn-export-report">
                📥 Download Incident Report (CSV)
              </button>
            </div>

            <div class="examlock-proctor-box">
              <div class="examlock-proctor-box-title">Proctor / Instructor Authorization</div>
              <div class="examlock-proctor-box-desc">
                Enter your Proctor Master PIN to reset strikes or turn off the lock:
              </div>
              <div class="examlock-pin-row">
                <input type="password" id="examlock-proctor-pin-input" class="examlock-pin-input" placeholder="Proctor PIN (Default: 1234)" autocomplete="off" />
                <button type="button" class="examlock-btn-unlock" id="examlock-btn-proctor-unlock">
                  Authorize & Unlock
                </button>
                <button type="button" class="examlock-btn-secondary" id="examlock-btn-lockout-turn-off" style="padding: 10px 14px; font-size: 13px; border-radius: 4px; border: 1px solid #dadce0; cursor: pointer; white-space: nowrap;">
                  Turn Off Lock
                </button>
              </div>
              <div id="examlock-pin-error" style="color: #d93025; font-size: 13px; margin-top: 8px; display: none;">
                ✕ Incorrect Proctor PIN. Please try again.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Proctor Slide-over Panel -->
      <div id="examlock-proctor-panel">
        <div class="examlock-panel-header">
          <span class="examlock-panel-title">Proctor Control Panel</span>
          <button class="examlock-panel-close" id="examlock-panel-close-btn">&times;</button>
        </div>
        <div class="examlock-panel-body">
          <div style="font-size: 13px; color: #5f6368; margin-bottom: 14px;">
            Proctor Master Access requires PIN:
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
            <input type="password" id="examlock-panel-pin" class="examlock-pin-input" placeholder="Enter PIN" autocomplete="off" />
            <button class="examlock-btn-unlock" id="examlock-btn-panel-verify">Verify PIN</button>
          </div>

          <div id="examlock-panel-proctor-tools" style="display: none; flex-direction: column; gap: 12px;">
            <div style="font-size: 13px; font-weight: 500; color: #137333;">✓ Authorized Access</div>
            <button class="examlock-btn-purple" id="examlock-btn-reset-strikes" style="padding: 9px;">
              Reset Current Strikes (0)
            </button>
            <button class="examlock-btn-export-csv" id="examlock-btn-panel-export" style="width: 100%; justify-content: center;">
              📥 Export Incident Log (CSV)
            </button>
            <button class="examlock-btn-danger" id="examlock-btn-panel-disable" style="padding: 9px;">
              Turn Off Lock for this Form
            </button>
            <button class="examlock-btn-danger" id="examlock-btn-terminate-exam" style="padding: 9px; background-color: #80868b;">
              Manually Terminate Exam
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    setupUIEventHandlers();
  }

  // Completely turn off ExaminationLock for this page
  function disableLockForSession() {
    state.isActive = false;
    state.isLocked = false;
    clearInterval(state.timerInterval);

    // Remove ExaminationLock DOM root
    const root = document.getElementById("examlock-root");
    if (root) root.remove();

    // Re-enable form body & inputs
    document.body.classList.remove("examlock-active");
    enableFormInputs();

    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // Unregister active session from background
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "END_EXAM_SESSION" });
    }

    // Show temporary confirmation
    const notice = document.createElement("div");
    notice.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#323232;color:#ffffff;padding:12px 24px;border-radius:4px;font-family:'Google Sans',Roboto,sans-serif;font-size:14px;box-shadow:0 2px 10px rgba(0,0,0,0.3);z-index:9999999;";
    notice.textContent = "✓ ExaminationLock has been turned off for this form.";
    document.body.appendChild(notice);
    setTimeout(() => notice.remove(), 4000);
  }

  // Setup Event Handlers for UI buttons
  function setupUIEventHandlers() {
    // Start Exam button
    const btnStart = document.getElementById("examlock-btn-start-exam");
    if (btnStart) {
      btnStart.addEventListener("click", () => {
        startExamination();
      });
    }

    // Gateway turn off lock toggle & confirm
    const btnToggleGatewayPin = document.getElementById("examlock-btn-toggle-gateway-pin");
    const gatewayPinBox = document.getElementById("examlock-gateway-pin-box");
    const gatewayPinInput = document.getElementById("examlock-gateway-pin-input");
    const gatewayPinConfirm = document.getElementById("examlock-btn-gateway-pin-confirm");
    const gatewayPinError = document.getElementById("examlock-gateway-pin-error");

    if (btnToggleGatewayPin && gatewayPinBox) {
      btnToggleGatewayPin.addEventListener("click", () => {
        gatewayPinBox.style.display = gatewayPinBox.style.display === "none" ? "block" : "none";
        if (gatewayPinInput && gatewayPinBox.style.display === "block") {
          gatewayPinInput.focus();
        }
      });
    }

    function verifyGatewayPinAndDisable() {
      if (!gatewayPinInput) return;
      const entered = gatewayPinInput.value.trim();
      const doDisable = () => {
        if (gatewayPinError) gatewayPinError.style.display = "none";
        disableLockForSession();
      };

      if (entered === String(state.settings.proctorPin).trim()) {
        doDisable();
      } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "VERIFY_PIN", pin: entered }, (res) => {
          if (res && res.valid) {
            doDisable();
          } else {
            if (gatewayPinError) gatewayPinError.style.display = "block";
          }
        });
      } else {
        if (gatewayPinError) gatewayPinError.style.display = "block";
      }
    }

    if (gatewayPinConfirm) {
      gatewayPinConfirm.addEventListener("click", verifyGatewayPinAndDisable);
    }
    if (gatewayPinInput) {
      gatewayPinInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          verifyGatewayPinAndDisable();
        }
      });
    }

    // Acknowledge Warning modal button
    const btnAck = document.getElementById("examlock-btn-acknowledge");
    if (btnAck) {
      btnAck.addEventListener("click", () => {
        hideWarningModal();
      });
    }

    // Fullscreen resume button
    const btnResumeFs = document.getElementById("examlock-btn-resume-fs");
    if (btnResumeFs) {
      btnResumeFs.addEventListener("click", async () => {
        try {
          await enterFullscreen();
          document.getElementById("examlock-fullscreen-modal").style.display = "none";
        } catch (e) {
          console.warn("Fullscreen request error:", e);
        }
      });
    }

    // Proctor Panel open/close
    const btnProctor = document.getElementById("examlock-btn-proctor-panel");
    const panel = document.getElementById("examlock-proctor-panel");
    const btnClosePanel = document.getElementById("examlock-panel-close-btn");
    if (btnProctor && panel) {
      btnProctor.addEventListener("click", () => {
        panel.classList.toggle("open");
      });
    }
    if (btnClosePanel && panel) {
      btnClosePanel.addEventListener("click", () => {
        panel.classList.remove("open");
      });
    }

    // Proctor Panel PIN verification
    const btnPanelVerify = document.getElementById("examlock-btn-panel-verify");
    const panelPinInput = document.getElementById("examlock-panel-pin");
    const proctorTools = document.getElementById("examlock-panel-proctor-tools");
    if (btnPanelVerify && panelPinInput && proctorTools) {
      btnPanelVerify.addEventListener("click", () => {
        const pin = panelPinInput.value.trim();
        if (pin === String(state.settings.proctorPin).trim()) {
          proctorTools.style.display = "flex";
          panelPinInput.disabled = true;
          btnPanelVerify.style.display = "none";
        } else {
          showToast("Incorrect Proctor PIN");
        }
      });
    }

    // Reset strikes from proctor panel
    const btnResetStrikes = document.getElementById("examlock-btn-reset-strikes");
    if (btnResetStrikes) {
      btnResetStrikes.addEventListener("click", () => {
        state.strikes = 0;
        updateHudStrikes();
        showToast("Strikes reset to 0 by proctor.");
      });
    }

    // Turn off lock completely from proctor panel
    const btnPanelDisable = document.getElementById("examlock-btn-panel-disable");
    if (btnPanelDisable) {
      btnPanelDisable.addEventListener("click", () => {
        if (confirm("Are you sure you want to turn off ExaminationLock for this form?")) {
          disableLockForSession();
        }
      });
    }

    // Manually terminate exam from proctor panel
    const btnTerminate = document.getElementById("examlock-btn-terminate-exam");
    if (btnTerminate) {
      btnTerminate.addEventListener("click", () => {
        panel.classList.remove("open");
        triggerLockout();
      });
    }

    // Export report from panel
    const btnPanelExport = document.getElementById("examlock-btn-panel-export");
    if (btnPanelExport) {
      btnPanelExport.addEventListener("click", () => {
        exportIncidentReport();
      });
    }

    // Lockout Screen Proctor Unlock button & Enter key
    const btnUnlock = document.getElementById("examlock-btn-proctor-unlock");
    const pinInput = document.getElementById("examlock-proctor-pin-input");
    const pinError = document.getElementById("examlock-pin-error");

    function executeUnlock() {
      if (!pinInput) return;
      const enteredPin = pinInput.value.trim();
      
      const doUnlock = () => {
        if (pinError) pinError.style.display = "none";
        pinInput.value = "";
        unlockExamSession();
      };

      if (enteredPin === String(state.settings.proctorPin).trim()) {
        doUnlock();
      } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "VERIFY_PIN", pin: enteredPin }, (res) => {
          if (res && res.valid) {
            doUnlock();
          } else {
            if (pinError) pinError.style.display = "block";
          }
        });
      } else {
        if (pinError) pinError.style.display = "block";
      }
    }

    if (btnUnlock) {
      btnUnlock.addEventListener("click", executeUnlock);
    }
    if (pinInput) {
      pinInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          executeUnlock();
        }
      });
    }

    // Lockout screen turn off lock button
    const btnLockoutTurnOff = document.getElementById("examlock-btn-lockout-turn-off");
    if (btnLockoutTurnOff) {
      btnLockoutTurnOff.addEventListener("click", () => {
        const enteredPin = (pinInput ? pinInput.value : "").trim();
        const doDisable = () => {
          if (pinError) pinError.style.display = "none";
          disableLockForSession();
        };

        if (enteredPin === String(state.settings.proctorPin).trim()) {
          doDisable();
        } else if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: "VERIFY_PIN", pin: enteredPin }, (res) => {
            if (res && res.valid) {
              doDisable();
            } else {
              if (pinError) {
                pinError.textContent = "✕ Please enter valid Proctor PIN to turn off lock.";
                pinError.style.display = "block";
              }
            }
          });
        } else {
          if (pinError) {
            pinError.textContent = "✕ Please enter valid Proctor PIN to turn off lock.";
            pinError.style.display = "block";
          }
        }
      });
    }

    // Export incident report from lockout screen
    const btnExport = document.getElementById("examlock-btn-export-report");
    if (btnExport) {
      btnExport.addEventListener("click", () => {
        exportIncidentReport();
      });
    }
  }

  // Request Fullscreen
  async function enterFullscreen() {
    try {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      } else if (docEl.msRequestFullscreen) {
        await docEl.msRequestFullscreen();
      }
    } catch (err) {
      console.warn("[ExaminationLock] Fullscreen permission denied or blocked:", err);
    }
  }

  // Start Examination Session
  async function startExamination() {
    state.isActive = true;
    state.startTime = Date.now();
    document.body.classList.add("examlock-active");

    // Hide entrance modal & show HUD
    document.getElementById("examlock-gateway-modal").style.display = "none";
    document.getElementById("examlock-hud").style.display = "flex";

    // Enter Fullscreen if required
    if (state.settings.enforceFullscreen) {
      await enterFullscreen();
    }

    // Start Timer Ticker
    startTimer();

    // Register active session with background worker
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: "REGISTER_EXAM_SESSION"
      });
    }

    showToast("ExaminationLock activated. Best of luck!");
  }

  // Start HUD Timer
  function startTimer() {
    clearInterval(state.timerInterval);
    const timerEl = document.getElementById("examlock-hud-timer");
    state.timerInterval = setInterval(() => {
      if (!state.startTime || state.isLocked) return;
      const elapsed = Date.now() - state.startTime;
      if (timerEl) {
        timerEl.textContent = formatTime(elapsed);
      }
    }, 1000);
  }

  // Update HUD Strikes Badge
  function updateHudStrikes() {
    const badge = document.getElementById("examlock-hud-strikes-badge");
    if (!badge) return;

    badge.textContent = `${state.strikes} / ${state.maxStrikes}`;
    badge.className = "examlock-hud-badge";

    if (state.strikes === 0) {
      badge.classList.add("safe");
    } else if (state.strikes < state.maxStrikes) {
      badge.classList.add("warning");
    } else {
      badge.classList.add("danger");
    }
  }

  // Record an Offense / Violation
  let violationDebounce = false;
  function recordViolation(reason, details = "") {
    if (!state.isActive || state.isLocked) return;

    if (violationDebounce) return;
    violationDebounce = true;
    setTimeout(() => {
      violationDebounce = false;
    }, 800);

    state.strikes += 1;
    const violationRecord = {
      index: state.strikes,
      time: new Date().toLocaleTimeString(),
      timestamp: new Date().toISOString(),
      reason,
      details
    };
    state.violations.push(violationRecord);

    console.warn(`[ExaminationLock] Strike ${state.strikes}/${state.maxStrikes}: ${reason} - ${details}`);

    updateHudStrikes();

    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: "RECORD_VIOLATION",
        violation: violationRecord
      });
    }

    if (state.strikes >= state.maxStrikes) {
      triggerLockout();
    } else {
      showWarningModal(reason, details);
    }
  }

  // Show Violation Warning Modal
  function showWarningModal(reason, details) {
    state.inWarningModal = true;
    playAlertSound("warning");

    const modal = document.getElementById("examlock-warning-modal");
    const strikeText = document.getElementById("examlock-warning-strike-text");
    const reasonTitle = document.getElementById("examlock-warning-reason-title");
    const reasonDetail = document.getElementById("examlock-warning-reason-text");

    if (strikeText) {
      strikeText.textContent = `Strike ${state.strikes} of ${state.maxStrikes}`;
    }
    if (reasonTitle) {
      reasonTitle.textContent = reason;
    }
    if (reasonDetail) {
      reasonDetail.textContent = details || "Activity marked as policy violation.";
    }
    if (modal) {
      modal.style.display = "flex";
    }
  }

  // Hide Violation Warning Modal
  function hideWarningModal() {
    state.inWarningModal = false;
    const modal = document.getElementById("examlock-warning-modal");
    if (modal) {
      modal.style.display = "none";
    }

    if (state.settings.enforceFullscreen && !document.fullscreenElement) {
      enterFullscreen();
    }
  }

  // Trigger Permanent Lockout Screen
  function triggerLockout() {
    state.isLocked = true;
    playAlertSound("lockout");

    hideWarningModal();
    disableFormInputs();

    const tableBody = document.getElementById("examlock-lockout-table-body");
    if (tableBody) {
      tableBody.innerHTML = "";
      state.violations.forEach((v) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${v.index}</td>
          <td>${v.time}</td>
          <td class="offense-col">${v.reason}</td>
          <td>${v.details || "-"}</td>
        `;
        tableBody.appendChild(tr);
      });
    }

    const lockoutModal = document.getElementById("examlock-lockout-modal");
    if (lockoutModal) {
      lockoutModal.style.display = "flex";
    }

    setTimeout(() => {
      const pinInput = document.getElementById("examlock-proctor-pin-input");
      if (pinInput) {
        pinInput.removeAttribute("disabled");
        pinInput.style.pointerEvents = "auto";
        pinInput.value = "";
        pinInput.focus();
      }
    }, 150);
  }

  // Disable all Form Inputs upon lockout (Excluding ExaminationLock internal elements)
  function disableFormInputs() {
    const inputs = document.querySelectorAll("input, textarea, button, select, [role='button'], [role='checkbox'], [role='radio']");
    inputs.forEach((el) => {
      if (el.closest("#examlock-root")) return;
      el.setAttribute("disabled", "true");
      el.style.pointerEvents = "none";
    });
  }

  // Enable Form Inputs upon proctor unlock
  function enableFormInputs() {
    const inputs = document.querySelectorAll("input, textarea, button, select, [role='button'], [role='checkbox'], [role='radio']");
    inputs.forEach((el) => {
      if (el.closest("#examlock-root")) return;
      el.removeAttribute("disabled");
      el.style.pointerEvents = "";
    });
  }

  // Proctor Unlock - Clean slate
  function unlockExamSession() {
    state.isLocked = false;
    state.strikes = 0;
    updateHudStrikes();
    enableFormInputs();

    const lockoutModal = document.getElementById("examlock-lockout-modal");
    if (lockoutModal) {
      lockoutModal.style.display = "none";
    }

    if (state.settings.enforceFullscreen) {
      enterFullscreen();
    }

    showToast("Exam successfully authorized & unlocked by Proctor.");
  }

  // Export Incident Report (CSV format)
  function exportIncidentReport() {
    const rows = [
      ["#", "Timestamp", "Offense", "Details"],
      ...state.violations.map((v) => [v.index, v.timestamp, `"${v.reason}"`, `"${v.details || ""}"`])
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ExaminationLock_Report_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Incident report downloaded.");
  }

  // ==========================================
  // EVENT LISTENERS & ENFORCEMENT ENGINE
  // ==========================================

  // 1. Tab Switching & Window Blur Enforcement
  function setupFocusProtection() {
    const curtain = () => document.getElementById("examlock-privacy-curtain");

    document.addEventListener("visibilitychange", () => {
      if (!state.isActive || state.isLocked) return;

      if (document.visibilityState === "hidden") {
        state.lastBlurTime = Date.now();
        if (curtain()) curtain().classList.remove("hidden");
      } else if (document.visibilityState === "visible") {
        if (curtain()) curtain().classList.add("hidden");
        if (state.lastBlurTime) {
          const absentDuration = ((Date.now() - state.lastBlurTime) / 1000).toFixed(1);
          state.lastBlurTime = null;
          if (absentDuration >= 0.4) {
            recordViolation("Switched Tabs / Left Examination Window", `Absent from form tab for ${absentDuration} seconds.`);
          }
        }
      }
    });

    window.addEventListener("blur", () => {
      if (!state.isActive || state.isLocked) return;
      if (!state.lastBlurTime) state.lastBlurTime = Date.now();
      if (curtain()) curtain().classList.remove("hidden");
    });

    window.addEventListener("focus", () => {
      if (!state.isActive || state.isLocked) return;
      if (curtain()) curtain().classList.add("hidden");
      if (state.lastBlurTime) {
        const absentDuration = ((Date.now() - state.lastBlurTime) / 1000).toFixed(1);
        state.lastBlurTime = null;
        if (absentDuration >= 0.4) {
          recordViolation("Switched Tabs / Left Examination Window", `Absent from form tab for ${absentDuration} seconds.`);
        }
      }
    });

    window.addEventListener("examlock-test-violation", (e) => {
      if (e.detail) {
        recordViolation(e.detail.reason, e.detail.details || "Triggered via test sandbox");
      }
    });
  }

  // 2. Fullscreen Enforcement
  function setupFullscreenProtection() {
    document.addEventListener("fullscreenchange", () => {
      if (!state.isActive || state.isLocked) return;
      if (!state.settings.enforceFullscreen) return;

      if (!document.fullscreenElement) {
        recordViolation("Exited Fullscreen Mode", "Student dropped out of full-screen window.");
        const fsModal = document.getElementById("examlock-fullscreen-modal");
        if (fsModal && !state.isLocked) {
          fsModal.style.display = "flex";
        }
      }
    });
  }

  // 3. Clipboard & Keyboard Trapping
  function setupClipboardAndKeyProtection() {
    document.addEventListener("contextmenu", (e) => {
      if (!state.isActive) return;
      if (state.settings.blockContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        showToast("Right-click context menu is disabled.");
      }
    }, true);

    document.addEventListener("copy", (e) => {
      if (!state.isActive) return;
      if (state.settings.blockCopyPaste) {
        e.preventDefault();
        e.stopPropagation();
        if (e.clipboardData) e.clipboardData.setData("text/plain", "");
        recordViolation("Copy Attempt Blocked", "Attempted to copy exam content to clipboard.");
      }
    }, true);

    document.addEventListener("cut", (e) => {
      if (!state.isActive) return;
      if (state.settings.blockCopyPaste) {
        e.preventDefault();
        e.stopPropagation();
        recordViolation("Cut Attempt Blocked", "Attempted to cut form content.");
      }
    }, true);

    document.addEventListener("paste", (e) => {
      if (!state.isActive) return;
      if (state.settings.blockCopyPaste) {
        e.preventDefault();
        e.stopPropagation();
        recordViolation("Paste Attempt Blocked", "Attempted to paste external clipboard content into the form.");
      }
    }, true);

    window.addEventListener("keydown", (e) => {
      if (!state.isActive) return;

      // Allow typing in Proctor PIN inputs!
      if (e.target && (e.target.id === "examlock-proctor-pin-input" || e.target.id === "examlock-gateway-pin-input" || e.target.id === "examlock-panel-pin")) {
        return;
      }

      const key = e.key.toLowerCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (e.key === "PrintScreen" || e.code === "PrintScreen") {
        if (state.settings.blockScreenshots) {
          e.preventDefault();
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText("ExaminationLock: Screenshotting prohibited.").catch(() => {});
          }
          const c = document.getElementById("examlock-privacy-curtain");
          if (c) {
            c.classList.remove("hidden");
            setTimeout(() => c.classList.add("hidden"), 1500);
          }
          recordViolation("Screenshot Detected (PrintScreen)", "User pressed PrintScreen capture button.");
        }
        return;
      }

      if (e.key === "F12" || (ctrlOrMeta && e.shiftKey && ["i", "j", "c"].includes(key))) {
        if (state.settings.blockDevTools) {
          e.preventDefault();
          e.stopPropagation();
          recordViolation("Developer Tools Attempt", "Attempted to open inspection DevTools via keyboard shortcut.");
          return;
        }
      }

      if (ctrlOrMeta && ["c", "v", "x", "p", "s", "u"].includes(key)) {
        e.preventDefault();
        e.stopPropagation();
        const actionMap = {
          c: "Copy",
          v: "Paste",
          x: "Cut",
          p: "Print Page",
          s: "Save Page",
          u: "View Source"
        };
        recordViolation(`Forbidden Shortcut: Ctrl+${key.toUpperCase()}`, `Attempted ${actionMap[key] || "unauthorized"} shortcut.`);
      }
    }, true);

    window.addEventListener("keyup", (e) => {
      if (!state.isActive) return;
      if (e.key === "PrintScreen" || e.code === "PrintScreen") {
        if (state.settings.blockScreenshots) {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText("").catch(() => {});
          }
        }
      }
    }, true);

    window.addEventListener("beforeprint", () => {
      if (state.isActive) {
        recordViolation("Print Attempt", "Attempted to print examination page.");
      }
    });
  }

  // 4. Form Submission Detection
  function setupFormSubmissionListener() {
    document.addEventListener("click", (e) => {
      const target = e.target;
      if (!target) return;

      const submitBtn = target.closest("[role='button']");
      if (submitBtn && (submitBtn.innerText || "").toLowerCase().includes("submit")) {
        console.log("[ExaminationLock] Form submission button clicked.");
        setTimeout(() => {
          if (window.location.href.includes("formResponse")) {
            completeSession();
          }
        }, 1200);
      }
    });

    if (window.location.href.includes("formResponse")) {
      completeSession();
    }
  }

  function completeSession() {
    state.isActive = false;
    clearInterval(state.timerInterval);
    const hud = document.getElementById("examlock-hud");
    if (hud) hud.style.display = "none";
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: "END_EXAM_SESSION" });
    }
    showToast("Exam submitted successfully. ExaminationLock deactivated.");
  }

  // 5. Incoming Messages from Background Worker
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "SECURITY_VIOLATION") {
        if (state.isActive && !state.isLocked) {
          recordViolation(message.violation.reason, message.violation.details);
        }
      } else if (message.type === "FORCE_UNLOCK") {
        unlockExamSession();
      } else if (message.type === "DISABLE_LOCK_COMMAND") {
        disableLockForSession();
      }
      sendResponse({ received: true });
    });
  }

  // Initialize
  function init() {
    initSettings();
    createUI();
    setupFocusProtection();
    setupFullscreenProtection();
    setupClipboardAndKeyProtection();
    setupFormSubmissionListener();
    console.log("[ExaminationLock] Anti-Cheat Engine Loaded for Examination.");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
