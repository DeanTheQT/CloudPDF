/* =========================
   INLINE FEEDBACK
========================= */

function setMessage(targetId, message, type = "") {
    const el = document.getElementById(targetId);
    if (!el) return;

    el.textContent = message || "";
    el.className = type ? `form-message ${type}` : "form-message";

    if (el.classList.contains("status-message")) {
        el.className = type ? `status-message ${type}` : "status-message";
    }
}

function showStatus(targetId, message, type = "error") {
    const el = document.getElementById(targetId);
    if (!el) return;

    const baseClass = el.classList.contains("status-message") ? "status-message" : "form-message";
    el.textContent = message || "";
    el.className = type ? `${baseClass} ${type}` : baseClass;
}

function setButtonLoading(button, isLoading, loadingText, defaultText) {
    if (!button) return;

    if (!button.dataset.defaultText) {
        button.dataset.defaultText = defaultText || button.textContent;
    }

    button.disabled = isLoading;
    button.textContent = isLoading ? loadingText : (defaultText || button.dataset.defaultText);
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const fallbackInput = document.createElement("textarea");
    fallbackInput.value = text;
    fallbackInput.setAttribute("readonly", "");
    fallbackInput.style.position = "absolute";
    fallbackInput.style.left = "-9999px";
    document.body.appendChild(fallbackInput);
    fallbackInput.select();
    document.execCommand("copy");
    document.body.removeChild(fallbackInput);
}

function renderHighlightedText(target, text, keywords = []) {
    if (!target) return;

    target.textContent = "";
    const normalizedKeywords = [...new Set((keywords || [])
        .map((keyword) => String(keyword || "").trim())
        .filter(Boolean))]
        .sort((a, b) => b.length - a.length);

    if (!text || !normalizedKeywords.length) {
        target.textContent = text || "";
        return;
    }

    const escapedKeywords = normalizedKeywords.map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(${escapedKeywords.join("|")})`, "gi");
    const fragments = String(text).split(pattern);

    fragments.forEach((fragment) => {
        if (!fragment) return;

        const isKeyword = normalizedKeywords.some((keyword) => keyword.toLowerCase() === fragment.toLowerCase());
        if (isKeyword) {
            const mark = document.createElement("mark");
            mark.textContent = fragment;
            target.appendChild(mark);
            return;
        }

        target.appendChild(document.createTextNode(fragment));
    });
}

const nativeFetch = window.fetch.bind(window);
let csrfTokenCache = null;
let csrfTokenPromise = null;
let resendOtpCooldownInterval = null;

async function getCsrfToken() {
    if (csrfTokenCache) return csrfTokenCache;
    if (!csrfTokenPromise) {
        csrfTokenPromise = nativeFetch("/auth/csrf-token")
            .then((res) => res.json())
            .then((data) => {
                csrfTokenCache = data.csrfToken;
                return csrfTokenCache;
            })
            .finally(() => {
                csrfTokenPromise = null;
            });
    }
    return csrfTokenPromise;
}

async function csrfFetch(url, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const token = await getCsrfToken();
        if (token) headers.set("x-csrf-token", token);
    }

    return nativeFetch(url, {
        ...init,
        headers
    });
}

async function uploadWithProgress(url, formData, { onProgress, onProcessing } = {}) {
    const token = await getCsrfToken();

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        if (token) {
            xhr.setRequestHeader("x-csrf-token", token);
        }

        xhr.upload.addEventListener("progress", (event) => {
            if (!event.lengthComputable || !onProgress) return;
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
        });

        xhr.upload.addEventListener("load", () => {
            if (onProcessing) onProcessing();
        });

        xhr.addEventListener("load", () => {
            const contentType = xhr.getResponseHeader("content-type") || "";
            const payload = contentType.includes("application/json")
                ? JSON.parse(xhr.responseText || "{}")
                : xhr.responseText;

            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(payload);
                return;
            }

            reject(new Error(
                typeof payload === "string"
                    ? payload
                    : JSON.stringify(payload)
            ));
        });

        xhr.addEventListener("error", () => {
            reject(new Error("Upload failed. Check your connection and try again."));
        });

        xhr.send(formData);
    });
}

function startResendOtpCooldown(seconds = 60) {
    const resendBtn = document.getElementById("resendOtpBtn");
    if (!resendBtn) return;

    if (resendOtpCooldownInterval) {
        clearInterval(resendOtpCooldownInterval);
    }

    let remaining = seconds;
    resendBtn.disabled = true;
    resendBtn.textContent = `Resend OTP (${remaining}s)`;

    resendOtpCooldownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
            clearInterval(resendOtpCooldownInterval);
            resendOtpCooldownInterval = null;
            resendBtn.disabled = false;
            resendBtn.textContent = "Resend OTP";
            return;
        }

        resendBtn.textContent = `Resend OTP (${remaining}s)`;
    }, 1000);
}

let otpCountdownInterval = null;
let latestSummaryText = "";
let latestSummaryKeywords = [];
let latestSummaryHighlights = [];
let latestSummaryCitations = [];
let latestHistoryModalItem = null;
let latestDuplicatePreview = null;
let currentFileFingerprint = "";
let uploadStatusPoller = null;

function startCountdown(targetId, expiresInMs, expiredMessage) {
    const timerEl = document.getElementById(targetId);
    if (!timerEl) return;

    if (otpCountdownInterval) {
        clearInterval(otpCountdownInterval);
    }

    const endAt = Date.now() + expiresInMs;

    const render = () => {
        const remaining = Math.max(0, endAt - Date.now());
        const totalSeconds = Math.ceil(remaining / 1000);
        const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
        const seconds = String(totalSeconds % 60).padStart(2, "0");

        if (remaining <= 0) {
            timerEl.textContent = expiredMessage;
            timerEl.className = "form-message error";
            clearInterval(otpCountdownInterval);
            otpCountdownInterval = null;
            return;
        }

        timerEl.textContent = `OTP expires in ${minutes}:${seconds}`;
        timerEl.className = "form-message";
    };

    render();
    otpCountdownInterval = setInterval(render, 1000);
}

function startOtpTimer(expiresInMs) {
    startCountdown("otpTimer", expiresInMs, "OTP expired. Please register again.");
}

function ensureConfirmDialog() {
    let overlay = document.getElementById("confirmDialogOverlay");
    if (overlay) return overlay;

    const style = document.createElement("style");
    style.textContent = `
        .confirm-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            z-index: 9999;
        }

        .confirm-overlay[hidden] {
            display: none !important;
        }

        .confirm-dialog {
            width: min(460px, 100%);
            background: #fff;
            border-radius: 16px;
            padding: 22px;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
        }

        .confirm-dialog h3 {
            margin-bottom: 10px;
            font-size: 22px;
        }

        .confirm-dialog p {
            color: #4b5563;
            line-height: 1.5;
            margin-bottom: 18px;
        }

        .confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: wrap;
        }

        .confirm-actions button {
            border: none;
            border-radius: 10px;
            padding: 10px 16px;
            cursor: pointer;
        }

        .confirm-cancel {
            background: #e5e7eb;
            color: #111827;
        }

        .confirm-danger {
            background: #c0392b;
            color: #fff;
        }
    `;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "confirmDialogOverlay";
    overlay.className = "confirm-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
            <h3 id="confirmDialogTitle"></h3>
            <p id="confirmDialogMessage"></p>
            <div class="confirm-actions">
                <button type="button" class="confirm-cancel" id="confirmDialogCancel">Cancel</button>
                <button type="button" class="confirm-danger" id="confirmDialogAccept">Delete Account</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function showConfirmDialog({ title, message, confirmLabel = "Confirm" }) {
    const overlay = ensureConfirmDialog();
    const titleEl = document.getElementById("confirmDialogTitle");
    const messageEl = document.getElementById("confirmDialogMessage");
    const cancelBtn = document.getElementById("confirmDialogCancel");
    const acceptBtn = document.getElementById("confirmDialogAccept");

    titleEl.textContent = title;
    messageEl.textContent = message;
    acceptBtn.textContent = confirmLabel;
    overlay.hidden = false;

    return new Promise((resolve) => {
        const close = (value) => {
            overlay.hidden = true;
            cancelBtn.removeEventListener("click", onCancel);
            acceptBtn.removeEventListener("click", onAccept);
            overlay.removeEventListener("click", onOverlayClick);
            resolve(value);
        };

        const onCancel = () => close(false);
        const onAccept = () => close(true);
        const onOverlayClick = (event) => {
            if (event.target === overlay) close(false);
        };

        cancelBtn.addEventListener("click", onCancel);
        acceptBtn.addEventListener("click", onAccept);
        overlay.addEventListener("click", onOverlayClick);
    });
}

function getSummaryOptions() {
    return {
        length: document.getElementById("summaryLength")?.value || "medium",
        style: document.getElementById("summaryStyle")?.value || "academic",
        format: document.getElementById("outputFormat")?.value || "paragraph",
        focusArea: document.getElementById("focusArea")?.value || "",
        includeKeywords: Boolean(document.getElementById("includeKeywords")?.checked),
        includeHighlights: Boolean(document.getElementById("includeHighlights")?.checked),
        includeCitations: Boolean(document.getElementById("includeCitations")?.checked)
    };
}

function renderSummaryResult(data, options = getSummaryOptions()) {
    summaryOverview.style.whiteSpace = "pre-wrap";
    latestSummaryText = data.summary || "";
    latestSummaryKeywords = Array.isArray(data.keywords) ? data.keywords : [];
    latestSummaryHighlights = Array.isArray(data.highlights) ? data.highlights : [];
    latestSummaryCitations = Array.isArray(data.citations) ? data.citations : [];
    renderHighlightedText(summaryOverview, latestSummaryText, latestSummaryKeywords);

    summaryKeywords.innerHTML = "";
    latestSummaryKeywords.forEach((word) => {
        const li = document.createElement("li");
        li.textContent = word;
        li.className = "keyword-tag";
        summaryKeywords.appendChild(li);
    });

    if (summaryPoints) {
        summaryPoints.innerHTML = "";
        latestSummaryHighlights.forEach((point) => {
            const li = document.createElement("li");
            li.textContent = point;
            summaryPoints.appendChild(li);
        });
    }

    if (summaryCitations) {
        summaryCitations.innerHTML = "";
        latestSummaryCitations.forEach((citation) => {
            const li = document.createElement("li");
            li.textContent = citation;
            summaryCitations.appendChild(li);
        });
    }

    if (keywordsSection) keywordsSection.hidden = !options.includeKeywords;
    if (highlightsSection) highlightsSection.hidden = !options.includeHighlights;
    if (citationsSection) citationsSection.hidden = !options.includeCitations;

    summaryStyleUsed.textContent = `Style: ${options.style} | Length: ${options.length}`;
}

async function hashFile(file) {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stopUploadStatusPolling() {
    if (uploadStatusPoller) {
        clearInterval(uploadStatusPoller);
        uploadStatusPoller = null;
    }
}

async function pollUploadStatus(uploadId, options) {
    stopUploadStatusPolling();

    const checkStatus = async () => {
        const res = await nativeFetch(`/upload/status/${uploadId}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || "Could not get upload status.");
        }

        if (data.queued) {
            uploadMessage.textContent = "Upload received. Waiting in queue for AI processing...";
            summaryOverview.textContent = "Your thesis is waiting in the queue.";
            return;
        }

        if (data.processing) {
            uploadMessage.textContent = "Your thesis is being processed. This may take a while...";
            summaryOverview.textContent = "AI is analyzing your thesis now.";
            return;
        }

        if (data.duplicate && data.existingUpload) {
            stopUploadStatusPolling();
            renderSummaryResult(data.existingUpload, options);
            uploadMessage.textContent = data.message || "This thesis was already summarized with the same options.";
            uploadForm?.reset();
            syncSelectedFileLabel();
            return;
        }

        if (data.failed) {
            stopUploadStatusPolling();
            uploadMessage.textContent = data.processingError || data.message || "Processing failed.";
            summaryOverview.textContent = data.processingError || "Failed to generate summary.";
            return;
        }

        if (data.complete) {
            stopUploadStatusPolling();
            renderSummaryResult(data, options);
            uploadMessage.textContent = data.message || "Summary generated successfully!";
            uploadForm?.reset();
            syncSelectedFileLabel();
        }
    };

    await checkStatus();
    uploadStatusPoller = setInterval(() => {
        checkStatus().catch((err) => {
            console.error(err);
            stopUploadStatusPolling();
            uploadMessage.textContent = err.message || "Could not track upload progress.";
        });
    }, 2500);
}

/* =========================
   SESSION HANDLING
========================= */

async function checkSession() {
    try {
        const res = await nativeFetch("/auth/session");
        if (!res.ok) return window.location.href = "login.html";

        const data = await res.json();
        const userDisplay = document.getElementById("userDisplay");
        if (userDisplay) userDisplay.textContent = data.user.email || data.user.username;
        const statusDisplay = document.getElementById("statusDisplay");
        if (statusDisplay) statusDisplay.textContent = data.user.isAdmin ? "Admin" : "User";

    } catch (err) {
        console.error(err);
        window.location.href = "login.html";
    }
}

if (document.body.dataset.page === "user-home" || document.body.dataset.page === "account") checkSession();

async function loadAccountStats() {
    if (document.body.dataset.page !== "account") return;

    try {
        const res = await nativeFetch("/auth/dashboard-stats");
        if (!res.ok) throw new Error("Failed to load stats");

        const data = await res.json();
        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        setText("statsUploadCount", String(data.uploadCount ?? 0));
        setText("statsMessageCount", String(data.messageCount ?? 0));
        setText("statsLatestUpload", data.latestUploadName || "No uploads yet");
        setText("statsMemberSince", data.memberSince ? new Date(data.memberSince).toLocaleDateString() : "-");
        setText(
            "statsLatestUploadDate",
            data.latestUploadAt ? `Saved on ${new Date(data.latestUploadAt).toLocaleString()}` : ""
        );
    } catch (err) {
        console.error(err);
    }
}

async function loadUserInbox() {
    if (document.body.dataset.page !== "account") return;

    const inboxList = document.getElementById("userInboxList");
    if (!inboxList) return;

    try {
        const res = await nativeFetch("/messages/inbox");
        if (!res.ok) throw new Error("Failed to load inbox");

        const messages = await res.json();
        inboxList.innerHTML = "";

        if (!messages.length) {
            inboxList.innerHTML = `<p class="empty-inbox">No admin replies yet.</p>`;
            return;
        }

        messages.forEach((item) => {
            const card = document.createElement("article");
            card.className = `inbox-card${item.readAt ? "" : " unread"}`;
            card.innerHTML = `
                <div class="inbox-meta">
                    <span><strong>Admin</strong></span>
                    <span>${new Date(item.createdAt).toLocaleString()}</span>
                </div>
                <h3>${item.subject}</h3>
                <p>${item.message}</p>
            `;
            inboxList.appendChild(card);
        });

        await Promise.all(
            messages
                .filter((item) => !item.readAt)
                .map((item) => csrfFetch(`/messages/inbox/${item._id}/read`, { method: "POST" }))
        );
        updateNotificationCenter().catch((err) => console.error(err));
    } catch (err) {
        console.error(err);
        inboxList.innerHTML = `<p class="empty-inbox">Could not load admin replies right now.</p>`;
    }
}

function ensureNotificationStyles() {
    if (document.getElementById("notificationStyles")) return;

    const style = document.createElement("style");
    style.id = "notificationStyles";
    style.textContent = `
        .nav-notification {
            position: relative;
        }

        .nav-notification-btn {
            position: relative;
            border: none;
            background: transparent;
            color: #333;
            font-size: 18px;
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 999px;
        }

        .nav-notification-btn:hover {
            background: #eef4fb;
        }

        .nav-notification-badge {
            position: absolute;
            top: -4px;
            right: -2px;
            min-width: 18px;
            height: 18px;
            border-radius: 999px;
            background: #e74c3c;
            color: white;
            font-size: 11px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 5px;
            font-weight: 700;
        }

        .nav-notification-dropdown {
            position: absolute;
            top: calc(100% + 10px);
            right: 0;
            width: min(360px, 86vw);
            background: #fff;
            color: #1f2937;
            border-radius: 14px;
            box-shadow: 0 20px 45px rgba(0, 0, 0, 0.18);
            border: 1px solid #e5e7eb;
            overflow: hidden;
            z-index: 1000;
        }

        .nav-notification-dropdown[hidden] {
            display: none !important;
        }

        .nav-notification-header {
            padding: 14px 16px;
            border-bottom: 1px solid #e5e7eb;
            font-weight: 700;
        }

        .nav-notification-list {
            max-height: 320px;
            overflow-y: auto;
        }

        .nav-notification-item {
            padding: 14px 16px;
            border-bottom: 1px solid #f1f5f9;
        }

        .nav-notification-item.unread {
            background: #f8fbff;
        }

        .nav-notification-item h4 {
            margin-bottom: 6px;
            font-size: 14px;
            color: #153b63;
        }

        .nav-notification-item p {
            margin: 0;
            color: #4b5563;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
        }

        .nav-notification-meta {
            display: block;
            color: #6b7280;
            font-size: 12px;
            margin-top: 8px;
        }

        .nav-notification-footer {
            padding: 12px 16px;
            background: #f8fafc;
        }

        .nav-notification-footer a {
            color: #1f6feb;
            text-decoration: none;
            font-weight: 600;
        }
    `;
    document.head.appendChild(style);
}

function closeNotificationDropdown() {
    const dropdown = document.getElementById("navNotificationDropdown");
    if (dropdown) dropdown.hidden = true;
}

async function updateNotificationCenter() {
    const host = document.getElementById("notificationHost");
    if (!host || host.style.display === "none") return;

    ensureNotificationStyles();
    if (!host.dataset.initialized) {
        host.className = "nav-notification";
        host.innerHTML = `
            <button type="button" class="nav-notification-btn" id="navNotificationBtn" aria-label="Admin replies">
                Inbox
                <span id="navNotificationBadge" class="nav-notification-badge" hidden>0</span>
            </button>
            <div id="navNotificationDropdown" class="nav-notification-dropdown" hidden>
                <div class="nav-notification-header">Admin Replies</div>
                <div id="navNotificationList" class="nav-notification-list">
                    <div class="nav-notification-item"><p>Loading messages...</p></div>
                </div>
                <div class="nav-notification-footer">
                    <a href="account.html">Open full inbox</a>
                </div>
            </div>
        `;
        host.dataset.initialized = "true";

        const btn = document.getElementById("navNotificationBtn");
        const dropdown = document.getElementById("navNotificationDropdown");
        btn?.addEventListener("click", (event) => {
            event.stopPropagation();
            dropdown.hidden = !dropdown.hidden;
        });

        document.addEventListener("click", (event) => {
            if (!host.contains(event.target)) {
                closeNotificationDropdown();
            }
        });
    }

    try {
        const res = await nativeFetch("/messages/inbox/summary?limit=5");
        if (!res.ok) throw new Error("Failed to load inbox summary");
        const data = await res.json();
        const badge = document.getElementById("navNotificationBadge");
        const list = document.getElementById("navNotificationList");

        if (badge) {
            const unreadCount = Number(data.unreadCount || 0);
            badge.hidden = unreadCount <= 0;
            badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
        }

        if (list) {
            const items = Array.isArray(data.items) ? data.items : [];
            if (!items.length) {
                list.innerHTML = `<div class="nav-notification-item"><p>No admin replies yet.</p></div>`;
            } else {
                list.innerHTML = items.map((item) => `
                    <div class="nav-notification-item${item.readAt ? "" : " unread"}">
                        <h4>${item.subject}</h4>
                        <p>${(item.message || "").slice(0, 140)}${item.message?.length > 140 ? "..." : ""}</p>
                        <span class="nav-notification-meta">${new Date(item.createdAt).toLocaleString()}</span>
                    </div>
                `).join("");
            }
        }
    } catch (err) {
        console.error(err);
    }
}

/* =========================
   LOGOUT
========================= */

const logoutBtn = document.getElementById("logout");
if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await nativeFetch("/auth/logout");
        window.location.href = "login.html";
    });
}

/* =========================
   LOGIN
========================= */

const loginForm = document.getElementById("loginForm");
const forgotPasswordToggle = document.getElementById("forgotPasswordToggle");
const forgotPasswordForm = document.getElementById("forgotPasswordForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");
if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!loginForm.reportValidity()) return;

        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPass").value;

        try {
            const res = await csrfFetch("/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();
            if (!res.ok) {
                showStatus("loginFormMessage", data.message || "Invalid login credentials", "error");
                return;
            }

            window.location.href = data.redirect;

        } catch (err) {
            console.error(err);
            showStatus("loginFormMessage", "Login failed", "error");
        }
    });
}

forgotPasswordToggle?.addEventListener("click", () => {
    if (!forgotPasswordForm) return;
    const willShow = forgotPasswordForm.hidden;
    forgotPasswordForm.hidden = !willShow ? true : false;
    if (resetPasswordForm && willShow === false) {
        resetPasswordForm.hidden = true;
    }
});

forgotPasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!forgotPasswordForm.reportValidity()) return;

    const email = document.getElementById("resetEmail").value.trim();
    const submitBtn = document.getElementById("forgotPasswordSubmitBtn");
    showStatus("forgotPasswordMessage", "");
    showStatus("resetPasswordMessage", "");

    try {
        setButtonLoading(submitBtn, true, "Sending OTP...", "Send Reset OTP");
        const res = await csrfFetch("/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const data = await res.json();
        if (!res.ok) {
            showStatus("forgotPasswordMessage", data.error || "Could not send reset OTP", "error");
            return;
        }

        showStatus("forgotPasswordMessage", data.message || "Reset OTP sent.", "success");
        if (resetPasswordForm) {
            resetPasswordForm.hidden = false;
        }
        startCountdown("resetOtpTimer", (data.expiresInSeconds || 600) * 1000, "Reset OTP expired. Request a new code.");
    } catch (err) {
        console.error(err);
        showStatus("forgotPasswordMessage", "Could not send reset OTP", "error");
    } finally {
        setButtonLoading(submitBtn, false, "Sending OTP...", "Send Reset OTP");
    }
});

resetPasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!resetPasswordForm.reportValidity()) return;

    const email = document.getElementById("resetEmail")?.value.trim();
    const otp = document.getElementById("resetOtpCode").value.trim();
    const newPassword = document.getElementById("resetNewPass").value;
    const submitBtn = document.getElementById("resetPasswordSubmitBtn");
    showStatus("resetPasswordMessage", "");

    try {
        setButtonLoading(submitBtn, true, "Resetting...", "Reset Password");
        const res = await csrfFetch("/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, otp, newPassword })
        });

        const data = await res.json();
        if (!res.ok) {
            showStatus("resetPasswordMessage", data.error || "Password reset failed", "error");
            return;
        }

        showStatus("resetPasswordMessage", data.message || "Password reset successful.", "success");
        forgotPasswordForm?.reset();
        resetPasswordForm.reset();
        window.location.href = data.redirect || "index.html";
    } catch (err) {
        console.error(err);
        showStatus("resetPasswordMessage", "Password reset failed", "error");
    } finally {
        setButtonLoading(submitBtn, false, "Resetting...", "Reset Password");
    }
});

/* =========================
   REGISTER
========================= */

const registerForm = document.getElementById("registerForm");
const otpForm = document.getElementById("otpForm");
if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!registerForm.reportValidity()) return;

        const email = document.getElementById("regEmail").value.trim();
        const password = document.getElementById("regPass").value;
        const confirm = document.getElementById("confirmRegPass").value;
        const registerSubmitBtn = document.getElementById("registerSubmitBtn");

        showStatus("registerFormMessage", "");
        showStatus("otpFormMessage", "");

        if (password !== confirm) {
            showStatus("registerFormMessage", "Passwords do not match", "error");
            return;
        }

        try {
            setButtonLoading(registerSubmitBtn, true, "Sending OTP...", "Register");

            const res = await csrfFetch("/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });

            const data = await res.json();
            if (!res.ok) {
                showStatus("registerFormMessage", data.error || "Registration failed", "error");
                return;
            }

            showStatus("registerFormMessage", data.message || "OTP sent. Check your email inbox.", "success");
            if (otpForm) {
                otpForm.hidden = false;
            }
            startOtpTimer((data.expiresInSeconds || 600) * 1000);
            startResendOtpCooldown();

        } catch (err) {
            console.error(err);
            showStatus("registerFormMessage", "Registration error", "error");
        } finally {
            setButtonLoading(registerSubmitBtn, false, "Sending OTP...", "Register");
        }
    });
}

if (otpForm) {
    otpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!otpForm.reportValidity()) return;

        const otp = document.getElementById("otpCode").value.trim();
        const otpSubmitBtn = document.getElementById("otpSubmitBtn");

        showStatus("otpFormMessage", "");

        try {
            setButtonLoading(otpSubmitBtn, true, "Verifying...", "Verify OTP");

            const res = await csrfFetch("/auth/verify-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ otp })
            });

            const data = await res.json();
            if (!res.ok) {
                showStatus("otpFormMessage", data.error || "OTP verification failed", "error");
                return;
            }

            showStatus("otpFormMessage", "Email verified. Redirecting...", "success");
            window.location.href = data.redirect || "home.html";
        } catch (err) {
            console.error(err);
            showStatus("otpFormMessage", "OTP verification failed", "error");
        } finally {
            setButtonLoading(otpSubmitBtn, false, "Verifying...", "Verify OTP");
        }
    });
}

document.getElementById("resendOtpBtn")?.addEventListener("click", async () => {
    const resendBtn = document.getElementById("resendOtpBtn");
    showStatus("otpFormMessage", "");

    try {
        setButtonLoading(resendBtn, true, "Sending...", "Resend OTP");
        const res = await csrfFetch("/auth/resend-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" }
        });
        const data = await res.json();

        if (!res.ok) {
            showStatus("otpFormMessage", data.error || data.message || "Could not resend OTP", "error");
            return;
        }

        showStatus("otpFormMessage", data.message || "A new OTP has been sent.", "success");
        startOtpTimer((data.expiresInSeconds || 600) * 1000);
        startResendOtpCooldown();
    } catch (err) {
        console.error(err);
        showStatus("otpFormMessage", "Could not resend OTP", "error");
    } finally {
        if (!resendOtpCooldownInterval) {
            setButtonLoading(resendBtn, false, "Sending...", "Resend OTP");
        }
    }
});

document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
        const target = document.getElementById(button.dataset.target);
        if (!target) return;

        const isHidden = target.type === "password";
        target.type = isHidden ? "text" : "password";
        button.textContent = isHidden ? "Hide" : "Show";
    });
});

/* =========================
   PDF UPLOAD & SUMMARY
========================= */

const uploadForm = document.getElementById("uploadForm");
const pdfFile = document.getElementById("pdfFile");
const selectedFileName = document.getElementById("selectedFileName");
const uploadMessage = document.getElementById("uploadMessage");
const summaryOverview = document.getElementById("summaryOverview");
const summaryKeywords = document.getElementById("summaryKeywords"); // Targeted the keywords UL
const summaryStyleUsed = document.getElementById("summaryStyleUsed");
const copySummaryBtn = document.getElementById("copySummaryBtn");
const summaryCopyStatus = document.getElementById("summaryCopyStatus");
const summaryPoints = document.getElementById("summaryPoints");
const summaryCitations = document.getElementById("summaryCitations");
const keywordsSection = document.getElementById("keywordsSection");
const highlightsSection = document.getElementById("highlightsSection");
const citationsSection = document.getElementById("citationsSection");
const dropZone = document.getElementById("dropZone");
const preflightWarning = document.getElementById("preflightWarning");

function syncSelectedFileLabel() {
  if (selectedFileName && pdfFile) {
    selectedFileName.textContent = pdfFile.files[0]?.name || "No file selected";
  }
}

function resetPreflightState() {
  latestDuplicatePreview = null;
  currentFileFingerprint = "";
  if (preflightWarning) {
    preflightWarning.textContent = "";
    preflightWarning.className = "preflight-warning";
  }
}

async function runDuplicatePrecheck() {
  if (!pdfFile?.files?.[0]) {
    resetPreflightState();
    return null;
  }

  try {
    const file = pdfFile.files[0];
    const options = getSummaryOptions();
    currentFileFingerprint = await hashFile(file);
    const res = await csrfFetch("/upload/precheck", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileHash: currentFileFingerprint,
        options
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Could not check duplicate history.");
    }

    latestDuplicatePreview = data.duplicate ? data.existingUpload : null;

    if (preflightWarning) {
      if (data.duplicate) {
        preflightWarning.textContent = data.message || "This thesis was already summarized with the same options. Submitting will reuse the existing result.";
        preflightWarning.className = "preflight-warning duplicate";
      } else {
        preflightWarning.textContent = "";
        preflightWarning.className = "preflight-warning";
      }
    }

    return data;
  } catch (err) {
    console.error(err);
    latestDuplicatePreview = null;
    if (preflightWarning) {
      preflightWarning.textContent = "Could not check duplicate history right now.";
      preflightWarning.className = "preflight-warning clear";
    }
    return null;
  }
}

if (pdfFile) {
  pdfFile.addEventListener("change", async () => {
    syncSelectedFileLabel();
    await runDuplicatePrecheck();
  });
}

if (dropZone && pdfFile) {
  dropZone.addEventListener("click", () => pdfFile.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pdfFile.click();
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("drag-active");
    });
  });

  ["dragleave", "dragend", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      if (eventName !== "drop" || event.target === dropZone) {
        dropZone.classList.remove("drag-active");
      }
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    dropZone.classList.remove("drag-active");

    if (!file) return;
    if (file.type !== "application/pdf") {
      uploadMessage.textContent = "Only PDF files can be uploaded.";
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    pdfFile.files = transfer.files;
    syncSelectedFileLabel();
    runDuplicatePrecheck().catch((err) => console.error(err));
  });
}

["summaryLength", "summaryStyle", "outputFormat", "focusArea", "includeKeywords", "includeHighlights", "includeCitations"]
  .forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("change", () => {
      if (pdfFile?.files?.[0]) {
        runDuplicatePrecheck().catch((err) => console.error(err));
      }
    });
  });

uploadForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const file = pdfFile.files[0];
  if (!file) {
    uploadMessage.textContent = "Select a PDF first.";
    return;
  }

  // 1. Capture all UI options
  const options = getSummaryOptions();

  if (!currentFileFingerprint) {
    await runDuplicatePrecheck();
  }

  if (latestDuplicatePreview) {
    renderSummaryResult(latestDuplicatePreview, options);
    uploadMessage.textContent = "This thesis already exists in your history with the same options, so the saved result was loaded instead.";
    return;
  }

  // 2. Prepare UI for loading
  uploadMessage.textContent = "Uploading thesis...";
  summaryOverview.textContent = "Processing...";
  summaryKeywords.innerHTML = ""; // Clear previous keywords
  if (summaryPoints) summaryPoints.innerHTML = "";
  if (summaryCitations) summaryCitations.innerHTML = "";
  summaryStyleUsed.textContent = "Summarizing...";
  if (summaryCopyStatus) summaryCopyStatus.textContent = "";
  latestSummaryText = "";
  latestSummaryKeywords = [];
  latestSummaryHighlights = [];
  latestSummaryCitations = [];

  const formData = new FormData();
  formData.append("pdf", file); // Note: Ensure your backend uses upload.single("pdf")
  
  // Append options to formData
  Object.keys(options).forEach(key => formData.append(key, options[key]));

  try {
    const data = await uploadWithProgress("/upload", formData, {
      onProgress: (percent) => {
        uploadMessage.textContent = `Uploading thesis... ${percent}%`;
      },
      onProcessing: () => {
        uploadMessage.textContent = "Upload complete. Your thesis has been sent to the queue.";
      }
    });

    if (data.queued && data.uploadId) {
      uploadMessage.textContent = data.message || "Upload received. Waiting in queue...";
      summaryOverview.textContent = "Your thesis is waiting in the queue.";
      await pollUploadStatus(data.uploadId, options);
      return;
    }

    renderSummaryResult(data, options);
    uploadMessage.textContent = "Summary generated successfully!";
    uploadForm.reset();
    syncSelectedFileLabel();
    resetPreflightState();

  } catch (err) {
    console.error("[ERROR] PDF upload failed:", err);
    const duplicatePayload = err?.message?.startsWith("{") ? (() => {
      try { return JSON.parse(err.message); } catch (_) { return null; }
    })() : null;

    if (duplicatePayload?.duplicate && duplicatePayload.existingUpload) {
      renderSummaryResult(duplicatePayload.existingUpload, options);
      uploadMessage.textContent = duplicatePayload.message || "This thesis was already summarized with the same options.";
      return;
    }

    uploadMessage.textContent = err.message || "Server error. Please try again.";
    summaryOverview.textContent = "Failed to generate summary.";
  }
});

copySummaryBtn?.addEventListener("click", async () => {
    if (!latestSummaryText) {
        if (summaryCopyStatus) summaryCopyStatus.textContent = "Generate a summary first.";
        return;
    }

    try {
        const keywordLine = latestSummaryKeywords.length ? `\n\nKeywords: ${latestSummaryKeywords.join(", ")}` : "";
        const highlightsBlock = latestSummaryHighlights.length
            ? `\n\nHighlights:\n- ${latestSummaryHighlights.join("\n- ")}`
            : "";
        const citationsBlock = latestSummaryCitations.length
            ? `\n\nAPA Citations:\n- ${latestSummaryCitations.join("\n- ")}`
            : "";
        await copyTextToClipboard(`${latestSummaryText}${highlightsBlock}${citationsBlock}${keywordLine}`);
        if (summaryCopyStatus) summaryCopyStatus.textContent = "Summary copied to clipboard.";
    } catch (err) {
        console.error(err);
        if (summaryCopyStatus) summaryCopyStatus.textContent = "Copy failed. Please try again.";
    }
});

/* =========================
   NAVBAR SESSION UI
========================= */

async function updateNavbar() {
    try {
        const res = await nativeFetch("/auth/session");
        const data = await res.json();

        const loginBtn = document.getElementById("loginBtn");
        const accountBtn = document.getElementById("accountBtn");
        const logoutBtn = document.getElementById("logout");
        const adminLi = document.getElementById("adminLi");
        const historyLink = document.getElementById("historyLink");
        const notificationHost = document.getElementById("notificationHost");

        if (data.loggedIn) {
            if (loginBtn) loginBtn.style.display = "none";
            if (accountBtn) {
                accountBtn.textContent = data.user.email || data.user.username;
                accountBtn.style.display = "inline-block";
            }
            if (logoutBtn) logoutBtn.style.display = "inline-block";
            if (historyLink) historyLink.style.display = "inline-block";
            if (notificationHost) notificationHost.style.display = "inline-block";
            
            if (adminLi) {
                adminLi.style.display = data.user.isAdmin ? "inline-block" : "none";
            }
            await updateNotificationCenter();
        } else {
            // If logged out and trying to view history, redirect to login
            if (document.body.dataset.page === "user-history") {
                window.location.href = "login.html";
            }
            if (loginBtn) loginBtn.style.display = "inline-block";
            if (accountBtn) accountBtn.style.display = "none";
            if (logoutBtn) logoutBtn.style.display = "none";
            if (historyLink) historyLink.style.display = "none";
            if (notificationHost) notificationHost.style.display = "none";
            if (adminLi) adminLi.style.display = "none";
            closeNotificationDropdown();
        }
    } catch (err) {
        console.error("Navbar update failed:", err);
    }
}

// Run on every page load
document.addEventListener("DOMContentLoaded", updateNavbar);

/* =========================
   CHANGE PASSWORD
========================= */

const changePasswordForm = document.getElementById("changePasswordForm");
if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!changePasswordForm.reportValidity()) return;

        const currentPassword = document.getElementById("currentPass").value;
        const newPassword = document.getElementById("newPass").value;
        const confirmNewPass = document.getElementById("confirmNewPass").value;

        if (newPassword !== confirmNewPass) {
            showStatus("changePasswordStatus", "Passwords do not match", "error");
            return;
        }

        try {
            const res = await csrfFetch("/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword })
            });

            const data = await res.json();
            if (!res.ok) {
                showStatus("changePasswordStatus", data.message || "Update failed", "error");
                return;
            }

            showStatus("changePasswordStatus", data.message, "success");
            changePasswordForm.reset();

        } catch (err) {
            console.error(err);
            showStatus("changePasswordStatus", "Error updating password", "error");
        }
    });
}

const accountLogoutBtn = document.getElementById("logoutBtn");
if (accountLogoutBtn) {
    accountLogoutBtn.addEventListener("click", async () => {
        await nativeFetch("/auth/logout");
        window.location.href = "login.html";
    });
}

const deleteAccountBtn = document.getElementById("deleteAccountBtn");
if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
        const confirmed = await showConfirmDialog({
            title: "Delete account?",
            message: "This permanently removes your account, uploads, and messages.",
            confirmLabel: "Delete Account"
        });
        if (!confirmed) return;

        try {
            const res = await csrfFetch("/auth/terminate", { method: "POST" });
            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.message || "Could not delete account");
            }

            showStatus("changePasswordStatus", data.message || "Account deleted.", "success");
            window.location.href = "login.html";
        } catch (err) {
            console.error(err);
            showStatus("changePasswordStatus", err.message || "Could not delete account.", "error");
        }
    });
}

const contactAdminForm = document.getElementById("contactAdminForm");
if (contactAdminForm) {
    contactAdminForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const status = document.getElementById("contactAdminStatus");
        const subject = document.getElementById("messageSubject").value.trim();
        const message = document.getElementById("messageBody").value.trim();

        if (!subject || !message) {
            if (status) status.textContent = "Please complete both fields.";
            return;
        }

        if (status) status.textContent = "Sending message...";

        try {
            const res = await csrfFetch("/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subject, message })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Failed to send message");

            if (status) status.textContent = "Your message has been sent to the admin.";
            contactAdminForm.reset();
            loadAccountStats();
        } catch (err) {
            console.error(err);
            if (status) status.textContent = err.message || "Failed to send message.";
        }
    });
}

/* =========================
   HISTORY PAGE LOGIC 
========================= */

async function loadHistory() {
    const historyList = document.getElementById("historyList");
    const searchInput = document.getElementById("searchHistory");
    const historyListInfo = document.getElementById("historyListInfo");
    const loadMoreHistoryBtn = document.getElementById("loadMoreHistoryBtn");
    const archivedHistoryList = document.getElementById("archivedHistoryList");
    const archivedHistoryInfo = document.getElementById("archivedHistoryInfo");
    let historyFetchLimit = 24;

    if (!historyList) return;

    const renderArchived = async () => {
        if (!archivedHistoryList) return;

        try {
            const res = await nativeFetch("/uploads/archived");
            if (!res.ok) throw new Error("Failed to fetch archived history");
            const archivedUploads = await res.json();

            if (!archivedUploads.length) {
                archivedHistoryList.innerHTML = `<p style="grid-column:1/-1; color:#d6d6d6; text-align:center;">No archived summaries.</p>`;
                if (archivedHistoryInfo) archivedHistoryInfo.textContent = "Showing 0 archived summaries";
                return;
            }

            archivedHistoryList.innerHTML = archivedUploads.map((item) => `
                <article class="archived-history-card">
                    <h3>${item.originalname}</h3>
                    <p>Archived ${item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "recently"}.</p>
                    <button type="button" class="restore-history-btn" data-upload-id="${item._id}">Restore Summary</button>
                </article>
            `).join("");

            if (archivedHistoryInfo) {
                archivedHistoryInfo.textContent = `Showing ${archivedUploads.length} archived summaries`;
            }
        } catch (err) {
            console.error(err);
            archivedHistoryList.innerHTML = `<p style="grid-column:1/-1; color:#ff7675; text-align:center;">Could not load archived summaries.</p>`;
        }
    };

    const fetchAndRender = async () => {
        try {
            const res = await nativeFetch(`/uploads?limit=${historyFetchLimit}`);
            if (!res.ok) throw new Error("Failed to fetch history");

            let uploads = await res.json();
            uploads.sort((a, b) => b._id.localeCompare(a._id));

            const renderCards = (filterText = "") => {
            historyList.innerHTML = "";

            const filtered = uploads.filter(item => 
                item.originalname.toLowerCase().includes(filterText.toLowerCase()) ||
                item.summary.toLowerCase().includes(filterText.toLowerCase())
            );

            if (filtered.length === 0) {
                historyList.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 50px; color: #ccc;">No matching summaries found.</p>`;
                return;
            }

            filtered.forEach(item => {
                const date = new Date(parseInt(item._id.substring(0, 8), 16) * 1000).toLocaleDateString();
                
                const card = document.createElement("div");
                card.className = "history-card";
                card.tabIndex = 0;
                card.addEventListener("click", () => openHistoryModal(item));
                card.addEventListener("keydown", (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openHistoryModal(item);
                    }
                });
                

                card.innerHTML = `
                    <button class="btn-delete-small" onclick="deleteHistoryItem('${item.filename}', this)" title="Delete Summary">×</button>
                    <div class="card-content">
                        <span class="date-label">${date}</span>
                        <h3>${item.originalname}</h3>
                        <p class="history-snippet"></p>
                    </div>
                    <div class="keywords-pills">
                        ${(item.keywords || []).slice(0, 3).map(k => `<span class="style-tag">${k}</span>`).join('')}
                    </div>
                `;
                const deleteBtn = card.querySelector(".btn-delete-small");
                if (deleteBtn) {
                    deleteBtn.dataset.filename = item.filename;
                }
                renderHighlightedText(card.querySelector(".history-snippet"), item.summary, item.keywords || []);
                historyList.appendChild(card);
            });
                if (historyListInfo) {
                    historyListInfo.textContent = `Showing ${filtered.length} summaries`;
                }
            };

            renderCards(searchInput?.value || "");
            if (loadMoreHistoryBtn) {
                loadMoreHistoryBtn.disabled = uploads.length < historyFetchLimit;
            }
            await renderArchived();
        } catch (err) {
            console.error(err);
            historyList.innerHTML = `<p style="text-align:center; color: #ff7675;">Error loading your history.</p>`;
            if (historyListInfo) {
                historyListInfo.textContent = "Could not load summaries";
            }
        }
    };

    window.refreshHistoryView = fetchAndRender;

    if (searchInput && !searchInput.dataset.bound) {
        searchInput.addEventListener("input", () => fetchAndRender());
        searchInput.dataset.bound = "true";
    }
    if (loadMoreHistoryBtn && !loadMoreHistoryBtn.dataset.bound) {
        loadMoreHistoryBtn.addEventListener("click", () => {
            historyFetchLimit += 24;
            fetchAndRender();
        });
        loadMoreHistoryBtn.dataset.bound = "true";
    }

    await fetchAndRender();
}

window.deleteHistoryItem = async (filename, btn) => {
    const confirmed = await showConfirmDialog({
        title: "Delete summary?",
        message: "This will permanently remove this saved summary from your history.",
        confirmLabel: "Delete Summary"
    });
    if (!confirmed) return;
    try {
        const res = await csrfFetch(`/upload/${filename}`, { method: 'DELETE' });
        if (res.ok) {
            btn.closest('.history-card').remove();
            loadAccountStats();
            window.refreshHistoryView?.();
        }
    } catch (err) { console.error(err); }
};

window.restoreHistoryItem = async (uploadId) => {
    try {
        const res = await csrfFetch(`/upload/${uploadId}/restore`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.message || "Could not restore summary.");
        }
        await window.refreshHistoryView?.();
        loadAccountStats();
    } catch (err) {
        console.error(err);
    }
};

function openHistoryModal(item) {
    const overlay = document.getElementById("historyModalOverlay");
    if (!overlay) return;
    latestHistoryModalItem = item;

    const timestamp = parseInt(item._id.substring(0, 8), 16) * 1000;
    document.getElementById("historyModalTitle").textContent = item.originalname || "Summary Details";
    document.getElementById("historyModalDate").textContent = new Date(timestamp).toLocaleString();
    renderHighlightedText(document.getElementById("historyModalSummary"), item.summary || "No summary available.", item.keywords || []);
    const copyStatus = document.getElementById("historyModalCopyStatus");
    if (copyStatus) copyStatus.textContent = "";

    const keywords = document.getElementById("historyModalKeywords");
    keywords.innerHTML = "";

    if ((item.keywords || []).length) {
        item.keywords.forEach((keyword) => {
            const tag = document.createElement("span");
            tag.className = "style-tag";
            tag.textContent = keyword;
            keywords.appendChild(tag);
        });
    } else {
        const empty = document.createElement("p");
        empty.textContent = "No keywords saved for this upload.";
        keywords.appendChild(empty);
    }

    overlay.hidden = false;
}

function closeHistoryModal() {
    const overlay = document.getElementById("historyModalOverlay");
    if (overlay) overlay.hidden = true;
}


document.addEventListener("DOMContentLoaded", () => {
    updateNavbar();
    loadAccountStats();
    loadUserInbox();
    if (document.body.dataset.page === "user-history") {
        loadHistory();
    }

    document.addEventListener("click", (event) => {
        const deleteBtn = event.target.closest(".btn-delete-small");
        if (deleteBtn) {
            event.preventDefault();
            event.stopPropagation();
            const filename = deleteBtn.dataset.filename;
            if (filename) {
                window.deleteHistoryItem(filename, deleteBtn);
            }
        }

        const restoreBtn = event.target.closest(".restore-history-btn");
        if (restoreBtn) {
            event.preventDefault();
            const uploadId = restoreBtn.dataset.uploadId;
            if (uploadId) {
                window.restoreHistoryItem(uploadId);
            }
        }
    }, true);

    const overlay = document.getElementById("historyModalOverlay");
    const closeBtn = document.getElementById("historyModalClose");
    const copyBtn = document.getElementById("historyModalCopy");

    closeBtn?.addEventListener("click", closeHistoryModal);
    copyBtn?.addEventListener("click", async () => {
        if (!latestHistoryModalItem?.summary) return;

        try {
            const keywordLine = (latestHistoryModalItem.keywords || []).length
                ? `\n\nKeywords: ${latestHistoryModalItem.keywords.join(", ")}`
                : "";
            await copyTextToClipboard(`${latestHistoryModalItem.summary}${keywordLine}`);
            const copyStatus = document.getElementById("historyModalCopyStatus");
            if (copyStatus) copyStatus.textContent = "Summary copied to clipboard.";
        } catch (err) {
            console.error(err);
            const copyStatus = document.getElementById("historyModalCopyStatus");
            if (copyStatus) copyStatus.textContent = "Copy failed. Please try again.";
        }
    });
    overlay?.addEventListener("click", (event) => {
        if (event.target === overlay) closeHistoryModal();
    });
});
