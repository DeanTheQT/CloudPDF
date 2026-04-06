/* =============================
   TOASTS
============================= */
function ensureToastRoot() {
    let root = document.getElementById("toastRoot");
    if (root) return root;

    const style = document.createElement("style");
    style.textContent = `
        #toastRoot {
            position: fixed;
            top: 20px;
            right: 20px;
            display: grid;
            gap: 10px;
            z-index: 9999;
            max-width: min(360px, calc(100vw - 32px));
        }

        .app-toast {
            padding: 12px 14px;
            border-radius: 12px;
            color: #fff;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
            font-size: 14px;
            line-height: 1.4;
            animation: toast-slide-in 180ms ease-out;
        }

        .app-toast.info { background: #1f6feb; }
        .app-toast.success { background: #1f8f4e; }
        .app-toast.error { background: #c0392b; }

        @keyframes toast-slide-in {
            from { opacity: 0; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
        }
    `;
    document.head.appendChild(style);

    root = document.createElement("div");
    root.id = "toastRoot";
    document.body.appendChild(root);
    return root;
}

function showToast(message, type = "info") {
    const root = ensureToastRoot();
    const toast = document.createElement("div");
    toast.className = `app-toast ${type}`;
    toast.textContent = message;
    root.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

const nativeFetch = window.fetch.bind(window);
let csrfTokenCache = null;
let csrfTokenPromise = null;

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

function ensureConfirmDialog() {
    let overlay = document.getElementById("adminConfirmDialogOverlay");
    if (overlay) return overlay;

    const style = document.createElement("style");
    style.textContent = `
        .admin-confirm-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.45);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            z-index: 9999;
        }

        .admin-confirm-overlay[hidden] {
            display: none !important;
        }

        .admin-confirm-dialog {
            width: min(460px, 100%);
            background: #fff;
            border-radius: 16px;
            padding: 22px;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.18);
            color: #222;
        }

        .admin-confirm-dialog h3 {
            margin-bottom: 10px;
            font-size: 22px;
        }

        .admin-confirm-dialog p {
            color: #4b5563;
            line-height: 1.5;
            margin-bottom: 18px;
        }

        .admin-confirm-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: wrap;
        }

        .admin-confirm-actions button {
            border: none;
            border-radius: 10px;
            padding: 10px 16px;
            cursor: pointer;
        }

        .admin-confirm-cancel {
            background: #e5e7eb;
            color: #111827;
        }

        .admin-confirm-danger {
            background: #c0392b;
            color: #fff;
        }
    `;
    document.head.appendChild(style);

    overlay = document.createElement("div");
    overlay.id = "adminConfirmDialogOverlay";
    overlay.className = "admin-confirm-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="admin-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="adminConfirmDialogTitle">
            <h3 id="adminConfirmDialogTitle"></h3>
            <p id="adminConfirmDialogMessage"></p>
            <div class="admin-confirm-actions">
                <button type="button" class="admin-confirm-cancel" id="adminConfirmDialogCancel">Cancel</button>
                <button type="button" class="admin-confirm-danger" id="adminConfirmDialogAccept">Delete</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
}

function showConfirmDialog({ title, message, confirmLabel = "Confirm" }) {
    const overlay = ensureConfirmDialog();
    const titleEl = document.getElementById("adminConfirmDialogTitle");
    const messageEl = document.getElementById("adminConfirmDialogMessage");
    const cancelBtn = document.getElementById("adminConfirmDialogCancel");
    const acceptBtn = document.getElementById("adminConfirmDialogAccept");

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

/* =============================
   SESSION + NAVBAR
============================= */
async function updateNavbar() {
    try {
        const res = await nativeFetch("/auth/session");
        if (!res.ok) {
            window.location.href = "login.html";
            return;
        }

        const data = await res.json();
        if (!data.user.isAdmin) {
            window.location.href = "index.html";
            return;
        }

        document.getElementById("loginBtn").style.display = "none";
        document.getElementById("accountBtn").textContent = data.user.email || data.user.username;
        document.getElementById("accountBtn").style.display = "inline-block";
        document.getElementById("logout").style.display = "inline-block";
    } catch (err) {
        console.error(err);
        window.location.href = "login.html";
    }
}

/* =============================
   LOGOUT
============================= */
document.getElementById("logout")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await nativeFetch("/auth/logout");
    window.location.href = "login.html";
});

/* =============================
   USERS
============================= */
let allUsers = [];
let adminMessages = [];
let userFetchLimit = 25;
let uploadFetchLimit = 20;
let messageFetchLimit = 20;
let logFetchLimit = 50;
let selectedUserId = null;
let allLogs = [];
let archivedPayload = { users: [], uploads: [], messages: [] };

async function loadUsers() {
    try {
        const search = document.getElementById("userSearchInput")?.value.trim() || "";
        const role = document.getElementById("userRoleFilter")?.value || "";
        const res = await nativeFetch(`/admin/users?limit=${userFetchLimit}&search=${encodeURIComponent(search)}`);
        if (!res.ok) throw new Error("Failed to load users");

        allUsers = await res.json();
        const filteredUsers = role
            ? allUsers.filter((user) => (role === "admin" ? user.isAdmin : !user.isAdmin))
            : allUsers;
        renderUsers(filteredUsers);
        document.getElementById("statsUsers").textContent = filteredUsers.length;
        document.getElementById("userListInfo").textContent = `Showing ${filteredUsers.length} users`;
        document.getElementById("loadMoreUsersBtn").disabled = allUsers.length < userFetchLimit;
    } catch (err) {
        console.error(err);
        document.getElementById("statsUsers").textContent = "0";
    }
}

async function loadAnalytics() {
    const overview = document.getElementById("analyticsOverview");
    const keywords = document.getElementById("analyticsKeywords");
    if (!overview || !keywords) return;

    try {
        const res = await nativeFetch("/admin/analytics");
        if (!res.ok) throw new Error("Failed to load analytics");

        const data = await res.json();
        const totals = data.totals || {};
        overview.innerHTML = `
            <div class="analytics-grid">
                <div class="analytics-pill"><strong>Active Users</strong><p>${totals.totalUsers ?? 0}</p></div>
                <div class="analytics-pill"><strong>Active Uploads</strong><p>${totals.totalUploads ?? 0}</p></div>
                <div class="analytics-pill"><strong>Active Messages</strong><p>${totals.totalMessages ?? 0}</p></div>
                <div class="analytics-pill"><strong>Registrations Logged</strong><p>${data.actionCounts?.user_registered ?? 0}</p></div>
                <div class="analytics-pill"><strong>Deletions Logged</strong><p>${data.actionCounts?.account_deleted ?? 0}</p></div>
            </div>
        `;

        keywords.innerHTML = `
            <h3>Top Keywords</h3>
            ${data.topKeywords?.length
                ? data.topKeywords.map((item) => `<div class="analytics-pill">${item.keyword} <strong>(${item.count})</strong></div>`).join("")
                : "<p>No keyword data yet.</p>"}
        `;

        document.getElementById("statsArchivedUsers").textContent = totals.totalArchivedUsers ?? 0;
        document.getElementById("statsArchivedUploads").textContent = totals.totalArchivedUploads ?? 0;
        document.getElementById("statsArchivedMessages").textContent = totals.totalArchivedMessages ?? 0;
    } catch (err) {
        console.error(err);
        overview.innerHTML = "<p>Analytics are unavailable right now.</p>";
        keywords.innerHTML = "";
    }
}

function renderArchivedItems() {
    const container = document.getElementById("archivedItemsContainer");
    if (!container) return;

    const sections = [
        {
            label: "Users",
            items: archivedPayload.users || [],
            render: (item) => `
                <div class="archived-card">
                    <strong>${item.email || item.username}</strong>
                    <p>Archived: ${item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "Unknown"}</p>
                    <button onclick="restoreArchivedUser('${item._id}')">Restore User</button>
                </div>
            `
        },
        {
            label: "Uploads",
            items: archivedPayload.uploads || [],
            render: (item) => `
                <div class="archived-card">
                    <strong>${item.originalname || "Untitled upload"}</strong>
                    <p>User: ${item.user?.email || item.user?.username || "Unknown"}</p>
                    <p>Archived: ${item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "Unknown"}</p>
                    <button onclick="restoreArchivedUpload('${item._id}')">Restore Upload</button>
                </div>
            `
        },
        {
            label: "Messages",
            items: archivedPayload.messages || [],
            render: (item) => `
                <div class="archived-card">
                    <strong>${item.subject || "Untitled message"}</strong>
                    <p>User: ${item.username || item.user?.email || item.user?.username || "Unknown"}</p>
                    <p>Archived: ${item.archivedAt ? new Date(item.archivedAt).toLocaleString() : "Unknown"}</p>
                    <button onclick="restoreArchivedMessage('${item._id}')">Restore Message</button>
                </div>
            `
        }
    ];

    container.innerHTML = sections.map((section) => `
        <div>
            <h3>${section.label}</h3>
            ${section.items.length ? section.items.map(section.render).join("") : "<p>No archived items.</p>"}
        </div>
    `).join("");
}

async function loadArchivedItems() {
    try {
        const res = await nativeFetch("/admin/archived");
        if (!res.ok) throw new Error("Failed to load archived items");
        archivedPayload = await res.json();
        renderArchivedItems();
    } catch (err) {
        console.error(err);
        const container = document.getElementById("archivedItemsContainer");
        if (container) container.innerHTML = "<p>Archived items are unavailable right now.</p>";
    }
}

function renderUsers(users) {
    const tbody = document.getElementById("userTableBody");
    tbody.innerHTML = "";

    users.forEach((u) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td onclick="loadUploads('${u._id}')" style="cursor:pointer">
                ${u.email || u.username}
            </td>
            <td>${u.isAdmin ? "Admin" : "User"}</td>
            <td>
                <button onclick="loadUploads('${u._id}')">View Uploads</button>
                <button onclick="toggleAdmin('${u._id}')">
                    ${u.isAdmin ? "Remove Admin" : "Make Admin"}
                </button>
                ${!u.isAdmin ? `<button onclick="deleteUser('${u._id}')">Archive</button>` : ""}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function deleteUser(id) {
    const confirmed = await showConfirmDialog({
        title: "Archive user?",
        message: "This will archive the user and hide their active records from the dashboard.",
        confirmLabel: "Archive User"
    });
    if (!confirmed) return;

    await csrfFetch(`/admin/users/${id}`, { method: "DELETE" });
    loadUsers();
    document.getElementById("adminDocumentList").innerHTML = "";
    document.getElementById("uploadListInfo").textContent = "No uploads loaded";
}

async function toggleAdmin(id) {
    try {
        const res = await csrfFetch(`/admin/users/${id}/admin`, { method: "PATCH" });
        if (!res.ok) throw new Error("Toggle admin is unavailable");
        loadUsers();
    } catch (err) {
        console.error(err);
        showToast("Admin role update is not available right now.", "error");
    }
}

/* =============================
   SEARCH USERS
============================= */
document.getElementById("userSearchInput")?.addEventListener("input", (e) => {
    const value = e.target.value.toLowerCase().trim();

    if (!value) {
        loadUsers();
        return;
    }

    const filtered = allUsers.filter((u) => (u.email || u.username || "").toLowerCase().includes(value));
    renderUsers(filtered);
});

document.getElementById("userRoleFilter")?.addEventListener("change", () => {
    loadUsers();
});

/* =============================
   LOAD UPLOADS BY USER
============================= */
async function loadUploads(userId) {
    selectedUserId = userId;
    const container = document.getElementById("adminDocumentList");
    container.innerHTML = "<p>Loading uploads...</p>";

    try {
        const search = document.getElementById("uploadSearchInput")?.value.trim() || "";
        const res = await nativeFetch(`/admin/uploads?user=${userId}&limit=${uploadFetchLimit}&search=${encodeURIComponent(search)}`);
        if (!res.ok) throw new Error("Failed to load uploads");

        const uploads = await res.json();

        container.innerHTML = "";
        if (!uploads.length) {
            container.innerHTML = "<p>No uploads found.</p>";
            document.getElementById("statsDocs").textContent = "0";
            document.getElementById("statsDocsAside").textContent = "0";
            document.getElementById("uploadListInfo").textContent = "No uploads found";
            document.getElementById("loadMoreUploadsBtn").disabled = true;
            return;
        }

        uploads.forEach((u) => {
            const card = document.createElement("div");
            card.className = "admin-upload-card";
            card.innerHTML = `
                <strong>${u.originalname}</strong>
                <p>Uploaded by: ${u.user?.email || u.user?.username || "unknown"}</p>
                <p><strong>Summary:</strong> <pre style="white-space: pre-wrap; background:#f5f5f5; padding:8px;">${u.summary || "No summary available"}</pre></p>
                <p><strong>Keywords:</strong> ${u.keywords?.join(", ") || "None"}</p>
                <button onclick="deleteUpload('${u._id}')">Archive</button>
            `;
            container.appendChild(card);
        });

        document.getElementById("statsDocs").textContent = uploads.length;
        document.getElementById("statsDocsAside").textContent = uploads.length;
        document.getElementById("uploadListInfo").textContent = `Showing ${uploads.length} uploads`;
        document.getElementById("loadMoreUploadsBtn").disabled = uploads.length < uploadFetchLimit;
    } catch (err) {
        console.error(err);
        container.innerHTML = "<p>Unable to load uploads.</p>";
    }
}

async function deleteUpload(id) {
    const confirmed = await showConfirmDialog({
        title: "Archive upload?",
        message: "This will archive the upload and remove it from active views.",
        confirmLabel: "Archive Upload"
    });
    if (!confirmed) return;

    await csrfFetch(`/admin/uploads/${id}`, { method: "DELETE" });
    if (selectedUserId) {
        loadUploads(selectedUserId);
    } else {
        document.getElementById("adminDocumentList").innerHTML = "<p>Upload deleted. Select the user again to refresh the list.</p>";
    }
}

/* =============================
   LOGS
============================= */
async function loadLogs() {
    const container = document.getElementById("logContainer");
    if (!container) return;

    try {
        const search = document.getElementById("logSearchInput")?.value.trim() || "";
        const action = document.getElementById("logActionFilter")?.value || "";
        const res = await nativeFetch(`/admin/logs${search ? `?search=${encodeURIComponent(search)}` : ""}`);
        if (!res.ok) throw new Error("Logs unavailable");

        const data = await res.json();
        const logs = Array.isArray(data) ? data : data.logs || [];
        allLogs = action ? logs.filter((log) => log.action === action) : logs;
        container.innerHTML = "";

        const limitedLogs = allLogs.slice(0, logFetchLimit);

        limitedLogs.forEach((log) => {
            const p = document.createElement("p");
            const actor = log.username || log.user?.email || log.user?.username || "System";
            const status = log.statusCode ? ` [${log.statusCode}]` : "";
            const duration = Number.isFinite(log.durationMs) ? ` ${log.durationMs}ms` : "";
            p.textContent = `${actor} - ${log.action}${status}${duration} (${new Date(log.createdAt).toLocaleString()})`;
            container.appendChild(p);
        });

        document.getElementById("statsLogs").textContent = allLogs.length;
        document.getElementById("logListInfo").textContent = `Showing ${limitedLogs.length} of ${allLogs.length} logs`;
        document.getElementById("loadMoreLogsBtn").disabled = limitedLogs.length >= allLogs.length;
    } catch (err) {
        console.error(err);
        container.innerHTML = "<p>System logs are unavailable right now.</p>";
        document.getElementById("statsLogs").textContent = "0";
    }
}

/* =============================
   USER MESSAGES
============================= */
function renderMessages(messages) {
    const container = document.getElementById("adminMessageList");
    if (!container) return;

    container.innerHTML = "";

    if (!messages.length) {
        container.innerHTML = "<p>No user messages yet.</p>";
        return;
    }

    messages.forEach((item) => {
        const card = document.createElement("div");
        card.className = "admin-message-card";
        card.innerHTML = `
            <div class="admin-message-meta">
                <span><strong>${item.username || item.user?.email || item.user?.username || "Unknown user"}</strong></span>
                <span>${new Date(item.createdAt).toLocaleString()}</span>
            </div>
            <h3>${item.subject}</h3>
            <p>${item.message}</p>
            <textarea id="replyMessage-${item._id}" placeholder="Reply to this user..." rows="3"></textarea>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                <button onclick="sendReply('${item._id}')">Send Reply</button>
                <button onclick="deleteMessage('${item._id}')">Archive Message</button>
            </div>
        `;
        container.appendChild(card);
    });
}

async function loadMessages() {
    const container = document.getElementById("adminMessageList");
    if (!container) return;

    container.innerHTML = "<p>Loading messages...</p>";

    try {
        const search = document.getElementById("messageSearchInput")?.value.trim() || "";
        const res = await nativeFetch(`/admin/messages${search ? `?search=${encodeURIComponent(search)}` : ""}`);
        if (!res.ok) throw new Error("Failed to load messages");

        adminMessages = await res.json();
        document.getElementById("statsMessages").textContent = adminMessages.length;
        renderMessages(adminMessages.slice(0, messageFetchLimit));
        document.getElementById("messageListInfo").textContent = `Showing ${Math.min(adminMessages.length, messageFetchLimit)} of ${adminMessages.length} messages`;
        document.getElementById("loadMoreMessagesBtn").disabled = messageFetchLimit >= adminMessages.length;
    } catch (err) {
        console.error(err);
        container.innerHTML = "<p>Unable to load user messages.</p>";
        document.getElementById("statsMessages").textContent = "0";
    }
}

window.deleteMessage = async (id) => {
    const confirmed = await showConfirmDialog({
        title: "Archive message?",
        message: "This will archive the user's message and hide it from the active inbox.",
        confirmLabel: "Archive Message"
    });
    if (!confirmed) return;

    try {
        const res = await csrfFetch(`/admin/messages/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");

        adminMessages = adminMessages.filter((message) => message._id !== id);
        document.getElementById("statsMessages").textContent = adminMessages.length;
        renderMessages(adminMessages.slice(0, messageFetchLimit));
        document.getElementById("messageListInfo").textContent = `Showing ${Math.min(adminMessages.length, messageFetchLimit)} of ${adminMessages.length} messages`;
        document.getElementById("loadMoreMessagesBtn").disabled = messageFetchLimit >= adminMessages.length;
    } catch (err) {
        console.error(err);
        showToast("Could not archive the message.", "error");
    }
};

window.restoreArchivedUser = async (id) => {
    try {
        const res = await csrfFetch(`/admin/users/${id}/restore`, { method: "POST" });
        if (!res.ok) throw new Error("Restore failed");
        await Promise.all([loadUsers(), loadArchivedItems(), loadAnalytics()]);
    } catch (err) {
        console.error(err);
        showToast("Could not restore the user.", "error");
    }
};

window.restoreArchivedUpload = async (id) => {
    try {
        const res = await csrfFetch(`/admin/uploads/${id}/restore`, { method: "POST" });
        if (!res.ok) throw new Error("Restore failed");
        await Promise.all([loadArchivedItems(), loadAnalytics()]);
        if (selectedUserId) loadUploads(selectedUserId);
    } catch (err) {
        console.error(err);
        showToast("Could not restore the upload.", "error");
    }
};

window.restoreArchivedMessage = async (id) => {
    try {
        const res = await csrfFetch(`/admin/messages/${id}/restore`, { method: "POST" });
        if (!res.ok) throw new Error("Restore failed");
        await Promise.all([loadMessages(), loadArchivedItems(), loadAnalytics()]);
    } catch (err) {
        console.error(err);
        showToast("Could not restore the message.", "error");
    }
};

window.sendReply = async (id) => {
    const input = document.getElementById(`replyMessage-${id}`);
    const message = input?.value.trim() || "";
    if (!message) {
        showToast("Write a reply first.", "error");
        return;
    }

    try {
        const res = await csrfFetch(`/admin/messages/${id}/reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Failed to send reply");
        if (input) input.value = "";
        showToast("Reply sent to user.", "success");
    } catch (err) {
        console.error(err);
        showToast("Could not send the reply.", "error");
    }
};

/* =============================
   INITIAL LOAD
============================= */
document.addEventListener("DOMContentLoaded", () => {
    updateNavbar();
    loadUsers();
    loadLogs();
    loadMessages();
    loadAnalytics();
    loadArchivedItems();

    document.getElementById("loadMoreUsersBtn")?.addEventListener("click", () => {
        userFetchLimit += 25;
        loadUsers();
    });

    document.getElementById("loadMoreUploadsBtn")?.addEventListener("click", () => {
        if (!selectedUserId) return;
        uploadFetchLimit += 20;
        loadUploads(selectedUserId);
    });

    document.getElementById("loadMoreMessagesBtn")?.addEventListener("click", () => {
        messageFetchLimit += 20;
        renderMessages(adminMessages.slice(0, messageFetchLimit));
        document.getElementById("messageListInfo").textContent = `Showing ${Math.min(adminMessages.length, messageFetchLimit)} of ${adminMessages.length} messages`;
        document.getElementById("loadMoreMessagesBtn").disabled = messageFetchLimit >= adminMessages.length;
    });

    document.getElementById("loadMoreLogsBtn")?.addEventListener("click", () => {
        logFetchLimit += 50;
        loadLogs();
    });

    document.getElementById("uploadSearchInput")?.addEventListener("input", () => {
        if (selectedUserId) loadUploads(selectedUserId);
    });

    document.getElementById("messageSearchInput")?.addEventListener("input", () => {
        loadMessages();
    });

    document.getElementById("logSearchInput")?.addEventListener("input", () => {
        loadLogs();
    });

    document.getElementById("logActionFilter")?.addEventListener("change", () => {
        loadLogs();
    });
});
