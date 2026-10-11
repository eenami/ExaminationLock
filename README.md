# ExaminationLock
### An Anti-Cheat Security System for Google Forms

---

## • PROJECT OVERVIEW
**ExaminationLock** is a specialized client-side browser extension engineered for Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera) running on Manifest V3. The system is purpose-built to transform standard **Google Forms** into a secure, proctored testing environment without requiring educators or students to migrate to external testing websites or paid proprietary learning management systems (LMS).

By injecting directly into Google Forms URLs (`https://docs.google.com/forms/*`), ExaminationLock establishes an active security perimeter around the examination session. It prevents unauthorized tab exploration, monitors window focus, restricts clipboard interactions, frustrates screenshot and screen-recording tools, and enforces full-screen kiosk operation. If students trigger consecutive policy infractions, a progressive strike system issues real-time warnings before invoking a permanent lockout that requires proctor authorization to resume.

---

## • PROBLEM STATEMENT
Google Forms is one of the most widely adopted assessment tools in global education due to its accessibility, automated grading, and tight integration with Google Workspace. However, unmanaged web-based exams on Google Forms suffer from severe academic integrity vulnerabilities:

1. **Uninhibited Tab Switching & Search**: Students can freely open adjacent tabs to look up answers on search engines, forums, or generative AI platforms (e.g., ChatGPT).
2. **Clipboard Tampering**: Questions can be copied and fed to external solvers within seconds, and external text can be directly pasted into response fields.
3. **Screen Capture & Question Leakage**: System shortcuts like PrintScreen or OS snipping tools allow students to capture and distribute test materials in real time.
4. **Desktop Application Multitasking**: Students can multitask with communication apps (Discord, Telegram, WhatsApp Web, Word) behind or alongside the browser.
5. **Developer Tools Exploitation**: Advanced users can inspect hidden DOM attributes, alter CSS, or intercept network traffic using browser DevTools.
6. **Cost and Complexity of Existing Solutions**: Conventional proctoring tools demand complex installations, high per-seat licensing fees, and invasive webcam/biometric monitoring that raise significant privacy concerns.

---

## • PROJECT OBJECTIVES
The primary objectives of the ExaminationLock project include:
- **Direct Google Forms Integration**: Operate seamlessly on native Google Forms pages without modifying form backends or directing students to external websites.
- **Strict Browser Sandboxing**: Intercept and neutralize unauthorized tab creation, tab switching, and window blur events in real time.
- **Clipboard & Interaction Hardening**: Disable copy, cut, paste, text selection, and right-click context menus during active exams.
- **Screen Capture Deterrence**: Block PrintScreen shortcuts, wipe the system clipboard buffer upon capture attempts, and visually obscure questions when focus drops.
- **Enforced Full-Screen Operation**: Ensure examinations are completed in a full-screen environment, flagging manual exits immediately.
- **Progressive Violation Tracking**: Maintain a persistent strike counter that delivers synthesized audible and visual warnings, escalating to a secure lockout upon reaching the violation threshold.
- **Proctor Governance & Incident Auditing**: Enable instructor oversight via a protected Proctor Master PIN and produce tamper-evident, timestamped CSV incident reports.
- **Native, Clean Aesthetics**: Implement a simple, white, Google Forms-matching user interface that avoids distracting or intimidating visual clutter.

---

## • SYSTEM FEATURES

### 1. Real-Time Tab & Window Focus Enforcement
- **New Tab Suppression**: Monitors the browser tab lifecycle; automatically terminates newly spawned tabs and refocuses the active Google Form.
- **Tab Switching Deterrence**: Detects when a student switches away to another open tab and immediately restores focus to the examination tab.
- **Window Blur Detection**: Detects when focus leaves the browser window (e.g., switching to external desktop applications like Discord or text editors).

### 2. Privacy & Anti-Inspection Curtain
- A clean, full-viewport privacy veil instantly obscures the examination questions whenever the page visibility changes or the window loses focus. This prevents unauthorized background viewing, screen splitting, or third-party screen snipping.

### 3. Clipboard & Selection Lockdown
- Complete suppression of `copy`, `cut`, and `paste` DOM events.
- Interception of keyboard shortcuts: <kbd>Ctrl+C</kbd>, <kbd>Ctrl+V</kbd>, <kbd>Ctrl+X</kbd>, <kbd>Ctrl+A</kbd>, <kbd>Ctrl+P</kbd> (Print), <kbd>Ctrl+S</kbd> (Save), and <kbd>Ctrl+U</kbd> (View Source).
- Enforced CSS rules (`user-select: none !important`) preventing question text from being highlighted or dragged.

### 4. Screenshot & Screen Capture Defense
- Intercepts the <kbd>PrintScreen</kbd> key on both keydown and keyup cycles.
- Actively overwrites and erases the system clipboard buffer upon any capture trigger.
- Injects a strict `@media print` stylesheet that completely blanks the page if a print dialog is invoked.

### 5. Developer Tools & Context Menu Blocker
- Disables right-click context menus across the examination document.
- Blocks inspection keyboard shortcuts: <kbd>F12</kbd>, <kbd>Ctrl+Shift+I</kbd>, <kbd>Ctrl+Shift+J</kbd>, and <kbd>Ctrl+Shift+C</kbd>.

### 6. Fullscreen Kiosk Enforcement
- Mandates full-screen entry prior to unlocking form input fields.
- Continuously listens for `fullscreenchange` events; dropping out of full-screen halts the exam, records an infraction, and prompts an immediate recovery dialog.

### 7. Progressive Strikes & Audio Warnings
- Configurable violation threshold (default: 3 strikes).
- Audio cues generated locally using the HTML5 Web Audio API (no external sound files or internet connection required).
- Modal warning dialog with violation reason, timestamp, and remaining allowances.

### 8. Examination Lockout & Proctor Authorization
- Upon reaching the strike limit, form inputs are disabled and covered by a secure suspension screen.
- The Proctor PIN input field remains fully interactive and responsive, allowing instructors to input their Master PIN (default: `1234`) to clear strikes and resume testing.
- An **Export Incident Report** button generates a CSV audit trail containing all timestamped violations for academic records.

---

## • SYSTEM ARCHITECTURE / COMPONENTS

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BROWSER RUNTIME (CHROMIUM)                      │
│                                                                        │
│   ┌────────────────────────────────┐  ┌────────────────────────────┐   │
│   │   Background Service Worker    │  │       Proctor Popup        │   │
│   │        (background.js)         │  │    (popup.html / js)       │   │
│   │  - chrome.tabs Monitoring      │  │  - Live Session Status     │   │
│   │  - chrome.windows Focus Watch  │  │  - Rule Configuration      │   │
│   │  - Auto-close Unauthorized Tab │  │  - Master PIN Controls     │   │
│   │  - Central Incident Logger     │  │  - Audit Log CSV Export    │   │
│   └───────────────┬────────────────┘  └─────────────┬──────────────┘   │
│                   │                                 │                  │
│       Message Bus │ (chrome.runtime messaging)      │                  │
│                   ▼                                 ▼                  │
│   ┌────────────────────────────────────────────────────────────┐       │
│   │                 Content Script Engine                      │       │
│   │             (content.js & content.css)                     │       │
│   │  ┌───────────────────────┐   ┌──────────────────────────┐  │       │
│   │  │   Enforcement Engine  │   │     Native Google UI     │  │       │
│   │  │  - Fullscreen Lock    │   │  - Floating Status HUD   │  │       │
│   │  │  - Clipboard Trapping │   │  - Entrance Gate Modal   │  │       │
│   │  │  - Screenshot Defense │   │  - Warning Dialog Box    │  │       │
│   │  │  - Blur Privacy Veil  │   │  - Lockout Overlay       │  │       │
│   │  │  - Web Audio Alarms   │   │  - Proctor PIN Unlock    │  │       │
│   │  └───────────────────────┘   └──────────────────────────┘  │       │
│   └─────────────────────────────┬──────────────────────────────┘       │
│                                 │ DOM Injection                        │
│                                 ▼                                      │
│                        GOOGLE FORMS WEBPAGE                            │
│               (https://docs.google.com/forms/*)                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Details & Directory Structure
```
ExaminationLock/
├── manifest.json            # Extension configuration (Manifest V3)
├── icons/                   # High-resolution extension icons (16, 48, 128px)
├── Backend/
│   └── background.js        # Service Worker: tab lifecycle, window focus, security bus
└── Frontend/
    ├── content.js           # Security engine, URL filter & proctor lock controls
    ├── content.css          # Clean Google Forms native white styling & overlays
    ├── popup.html           # Proctor control panel interface
    ├── popup.js             # Controller for proctor panel & settings sync
    └── popup.css            # Google Material styling for popup
```

1. **Manifest File (`manifest.json`)**: Declares Manifest V3 architecture, permissions (`tabs`, `storage`, `activeTab`), and routes to `Backend/background.js` and `Frontend/content.js`.
2. **Backend Service Worker (`Backend/background.js`)**: Runs in the background to observe tab creation (`tabs.onCreated`), tab activation shifts (`tabs.onActivated`), and application window focus alterations (`windows.onFocusChanged`).
3. **Frontend Security Engine (`Frontend/content.js`)**: Executes strictly on student examination respondent links (`/viewform`, `/preview`, `/formResponse`). It automatically detects and ignores form editing (`/edit`), form creation (`/create`), analytics, and dashboards. Also provides proctor authorization to disable locks on demand.
4. **Frontend Style Layer (`Frontend/content.css`)**: Implements clean, white, Google Forms-native design styling with Google Sans/Roboto typography, purple accenting (`#673ab7`), and material shadows.
5. **Frontend Proctor Interface (`Frontend/popup.html`, `Frontend/popup.js`, `Frontend/popup.css`)**: Clean management toolbar enabling educators to alter security parameters, disable locks, clear logs, and verify proctor credentials.
6. **Live Examination Target**: Fully integrated with live Google Forms assessments, including the verified test examination: [https://forms.gle/rhFbggfrh8if1zqp7](https://forms.gle/rhFbggfrh8if1zqp7).

---

## • SYSTEM WORKFLOW

```
  [ Student opens Google Form ]
               │
               ▼
  [ Entrance Gate Modal Displayed ] ──> Form inputs blocked until student agrees
               │
               ▼
  [ "Begin Proctored Examination" Clicked ]
               │
               ▼
  ┌────────────────────────────────────────────────────────────┐
  │  1. Request & enter Fullscreen mode                       │
  │  2. Register session with Background Service Worker       │
  │  3. Initialize Floating Status HUD & session timer        │
  │  4. Activate Clipboard, Keyboard, and Focus Traps         │
  └────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
                   [ Student Takes Examination ]
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
     [ Normal Activity ]                  [ Policy Violation ]
           │                         (Tab switch, Copy, Screen capture)
           │                                       │
           │                                       ▼
           │                              [ Strike Incremented ]
           │                              [ Play Audio Alert ]
           │                                       │
           │                        ┌──────────────┴──────────────┐
           │                        │                             │
           │               Strikes < Threshold          Strikes >= Threshold
           │                        │                             │
           │                        ▼                             ▼
           │             [ Display Warning Modal ]     [ Trigger Lockout Screen ]
           │             (Student acknowledges)        (Form inputs disabled)
           │                        │                             │
           │                        ▼                             ▼
           │             [ Return to Fullscreen ]      [ Proctor Enters PIN ]
           │                        │                             │
           │                        └──────────────┬──────────────┘
           │                                       │ (Strikes reset to 0)
           ▼                                       ▼
  [ Form Submitted Gracefully ] <──────────────────┘
  [ Session Deactivated & Cleaned Up ]
```

---

## • TOOLS & TECHNOLOGIES
- **Core Languages**: JavaScript (ECMAScript 2022+), HTML5, CSS3.
- **Platform Architecture**: Google Chromium Extension Platform — **Manifest V3**.
- **Browser APIs Utilized**:
  - `chrome.tabs`: Monitoring tab creation, tab activation changes, and programmatic tab closure.
  - `chrome.windows`: Detecting OS-level application window focus transitions.
  - `chrome.storage.local`: High-performance asynchronous configuration and audit log storage.
  - `chrome.runtime`: Inter-process messaging between Content Scripts, Popup, and Service Workers.
- **Web Standards & DOM APIs**:
  - **Fullscreen API** (`requestFullscreen` / `exitFullscreen`): Enforcing kiosk constraints.
  - **Page Visibility API** (`visibilitychange`): Immediate detection of tab switching.
  - **Clipboard API & Events** (`copy`, `cut`, `paste`, `clipboard.writeText`): Clipboard lockdown.
  - **Web Audio API** (`AudioContext`, `OscillatorNode`, `GainNode`): Offline synthesized alerts.
- **Asset Generation**: Python 3 with Pillow for programmatic multi-resolution icon rendering.

---

## • INSTALLATION / SETUP

### Prerequisites
A modern Chromium-based web browser:
- Google Chrome (Version 100+)
- Microsoft Edge (Version 100+)
- Brave Browser
- Opera / Opera GX

### Step-by-Step Installation
1. Clone or download the repository to your local computer:
   ```bash
   git clone https://github.com/your-repo/ExaminationLock.git
   # Target directory: c:\dev\ExaminationLock
   ```
2. Open your browser and navigate to the Extensions Management page:
   - Google Chrome: `chrome://extensions`
   - Microsoft Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable **Developer mode** via the toggle switch in the upper-right corner.
4. Click the **Load unpacked** button in the upper-left corner.
5. In the file explorer dialog, select the project directory:
   ```text
   c:\dev\ExaminationLock
   ```
6. The **ExaminationLock** extension will appear in your installed extensions list.
7. *(Recommended)* Click the puzzle icon in your browser toolbar and pin **ExaminationLock** to keep the proctor controls accessible.

### 📝 Live Google Forms Test Examination
To immediately test the anti-cheat system on an authentic Google Form, open the test link:
👉 **[https://forms.gle/rhFbggfrh8if1zqp7](https://forms.gle/rhFbggfrh8if1zqp7)**

---

## • USER GUIDE

### For Students
1. **Starting the Exam**:
   - Open the Google Form link provided by your instructor (e.g., [https://forms.gle/rhFbggfrh8if1zqp7](https://forms.gle/rhFbggfrh8if1zqp7)).
   - Read the rules on the **ExaminationLock Active** entrance dialog.
   - Click **Begin Proctored Examination**. Your browser will enter full-screen mode.
2. **During the Exam**:
   - Keep your focus solely on the exam tab.
   - Do not attempt to copy text, paste notes, or use keyboard shortcuts.
   - Do not open other tabs, minimize the window, or press <kbd>Esc</kbd>.
   - A floating status pill in the top-right displays your timer and current strike count.
3. **If a Warning Appears**:
   - Read the violation details, click **I Acknowledge & Return to Exam**, and immediately resume full-screen focus.
4. **Submitting**:
   - Complete your exam and click **Submit**. Once the confirmation page appears, ExaminationLock deactivates automatically.

### For Instructors & Proctors
1. **Configuring Rules**:
   - Click the **ExaminationLock** icon in the browser toolbar before the exam.
   - Adjust the **Max Allowed Strikes** (default: `3`).
   - Toggle individual rules (Fullscreen, Tab Switching, Copy/Paste, Screenshots, Alarms).
   - Review or modify the **Proctor Master PIN** (default: `1234`).
   - Click **Save Security Rules**.
2. **Handling a Student Lockout**:
   - If a student reaches the strike limit, their screen displays **Examination Session Locked**.
   - Review the listed infractions on their screen.
   - Enter your Proctor Master PIN into the authorization box and click **Authorize & Unlock**.
   - Strikes will reset to 0, form inputs will re-enable, and the student can continue.
3. **Downloading Incident Logs**:
   - On the lockout screen (or via the extension popup under the **Incident Logs** tab), click **Download Incident Report (CSV)** to save a timestamped incident report for school records.

---

## • QUALITY ASSURANCE & TESTING

### Testing Methodology
The system underwent rigorous functional, security, and edge-case testing directly on live Google Forms examinations using the verified test form: **[https://forms.gle/rhFbggfrh8if1zqp7](https://forms.gle/rhFbggfrh8if1zqp7)**.

### Test Scenarios Covered
- **TS-01: Tab Lifecycle Trapping**: Verification of tab creation interception and automatic tab closure.
- **TS-02: Window Focus Tracking**: Testing application switching (Alt+Tab, Windows Key, taskbar navigation).
- **TS-03: Fullscreen Escape**: Testing <kbd>Esc</kbd> and F11 key behavior.
- **TS-04: Clipboard Interception**: Testing <kbd>Ctrl+C</kbd>, <kbd>Ctrl+V</kbd>, <kbd>Ctrl+X</kbd>, right-click copy, and paste events.
- **TS-05: Screen Capture Suppression**: Testing <kbd>PrintScreen</kbd>, <kbd>Win+Shift+S</kbd>, and print commands.
- **TS-06: Strike Accumulation & Lockout**: Testing progressive strikes from 1 to 3 and lockout triggering.
- **TS-07: Proctor PIN Responsiveness**: Verifying input focus, keyboard typing, Enter key support, and successful unlock on strike 3/3.
- **TS-08: CSV Audit Generation**: Verifying structure, timestamps, and accuracy of downloaded incident reports.

---

## • TEST RESULTS

| Test ID | Test Scenario | Expected Outcome | Actual Result | Status |
| :--- | :--- | :--- | :--- | :---: |
| **TC-01** | Open new tab with <kbd>Ctrl+T</kbd> | New tab closes; focus returns to exam; strike increments | New tab closed immediately; strike recorded | **PASS** |
| **TC-02** | Switch to existing tab | Focus returns to exam tab; privacy veil displays; strike recorded | Exam tab refocused; violation logged | **PASS** |
| **TC-03** | Switch to external application | Privacy veil covers screen; blur event recorded | Curtain rendered; blur logged upon return | **PASS** |
| **TC-04** | Press <kbd>Esc</kbd> during exam | Fullscreen exits; recovery modal displays; strike recorded | Recovery dialog popped up; strike incremented | **PASS** |
| **TC-05** | Select text & press <kbd>Ctrl+C</kbd> | Selection blocked; shortcut cancelled; clipboard wiped | No text copied; clipboard erased; violation logged | **PASS** |
| **TC-06** | Attempt paste with <kbd>Ctrl+V</kbd> | Paste cancelled; form field unchanged; strike recorded | Paste prevented; violation logged | **PASS** |
| **TC-07** | Press <kbd>PrintScreen</kbd> key | Screen flashes blackout; clipboard cleared; strike logged | Curtain flashed; clipboard wiped; strike logged | **PASS** |
| **TC-08** | Right-click question text | Context menu suppressed; toast notification shown | Context menu blocked; toast displayed | **PASS** |
| **TC-09** | Press <kbd>F12</kbd> (DevTools) | DevTools shortcut cancelled; strike recorded | Keystroke blocked; strike recorded | **PASS** |
| **TC-10** | Accumulate 3 Strikes | Form inputs disabled; lockout screen rendered | Lockout screen displayed; inputs locked | **PASS** |
| **TC-11** | Enter PIN on Lockout Screen | PIN input allows typing; Enter key submits; resets strikes | Input accepts text; PIN verified; form unlocked | **PASS** |
| **TC-12** | Export Incident CSV | Generates downloadable CSV with timestamped infractions | CSV downloaded with complete audit trail | **PASS** |

---

## • LIMITATIONS
While ExaminationLock provides industry-standard browser sandboxing, certain physical and external limitations exist in client-side environments:
1. **Secondary Physical Devices**: Software cannot prevent a student from looking at an external physical smartphone, notes, or secondary computer placed outside the screen.
2. **Virtual Machine Environments**: If the host machine runs the browser inside a virtual machine (VM), operating-system-level actions outside the VM cannot be detected by browser APIs.
3. **Hardware Video Splitters**: Hardware HDMI capture cards or dual-monitor mirror cables cannot be blocked at the browser layer.
4. **Extension Uninstallation**: In unmanaged personal browser profiles, a student with administrator permissions could manually disable extensions unless locked down via Google Chrome Enterprise Management Policies (GPO / Google Workspace Chrome Management).

---

## • CONCLUSION
**ExaminationLock** successfully delivers a robust, lightweight, and non-invasive anti-cheat proctoring solution tailored specifically for Google Forms. By leveraging Manifest V3 browser capabilities, it closes the most prevalent digital cheating vectors—unauthorized tab exploration, clipboard sharing, screen captures, and external program switching—without requiring complex server backends, paid subscriptions, or privacy-invasive webcam surveillance.

With its clean, white Google Forms-native design, progressive strike system, proctor PIN recovery, and automated incident reporting, ExaminationLock empowers educational institutions and educators to administer trustworthy online assessments with confidence and ease.

---

## • APPENDICES

### Appendix A: Default Configuration Parameters
```json
{
  "examActive": true,
  "maxStrikes": 3,
  "enforceFullscreen": true,
  "blockNewTabs": true,
  "autoCloseNewTabs": true,
  "blockCopyPaste": true,
  "blockScreenshots": true,
  "blockContextMenu": true,
  "blockDevTools": true,
  "soundAlerts": true,
  "proctorPin": "1234",
  "autoFocusBack": true
}
```

### Appendix B: Violation Code Reference Table
| Violation Code | Description | Severity | Action Taken |
| :--- | :--- | :--- | :--- |
| `NEW_TAB_ATTEMPT` | Attempted to open an additional browser tab | High | Closes tab, refocuses exam, records strike |
| `TAB_SWITCH` | Active tab focus shifted away from the exam | High | Refocuses exam, records strike |
| `WINDOW_BLUR` | Browser window lost focus to desktop app | Medium | Deploys privacy curtain, records strike |
| `FULLSCREEN_EXIT` | Student exited browser full-screen mode | High | Shows recovery dialog, records strike |
| `COPY_ATTEMPT` | Clipboard copy event or Ctrl+C triggered | Medium | Cancels event, wipes clipboard, records strike |
| `PASTE_ATTEMPT` | Clipboard paste event or Ctrl+V triggered | Medium | Cancels event, records strike |
| `SCREENSHOT_DETECT` | PrintScreen key pressed | High | Flashes curtain, clears clipboard, records strike |
| `DEVTOOLS_ATTEMPT` | F12 or inspect shortcut triggered | High | Blocks shortcut, records strike |

### Appendix C: Proctor PIN Recovery Protocol
1. In the event of an exam lockout, verify the student's physical identity and examine the listed audit table.
2. To unlock the workstation, enter the designated Proctor Master PIN (Default: `1234`) into the password field on the lockout screen.
3. Press <kbd>Enter</kbd> or click **Authorize & Unlock**.
4. The system will reset the strike counter to `0`, restore all input fields, and prompt the student to return to full-screen mode.
5. If an official disciplinary log is required, click **Download Incident Report (CSV)** prior to closing the workstation.
