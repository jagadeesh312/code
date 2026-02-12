import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbf9-GDkSrXSmw88s_C3g6iNVRvZdf14Q",
  authDomain: "studio-1453988957-3d1c5.firebaseapp.com",
  projectId: "studio-1453988957-3d1c5",
  storageBucket: "studio-1453988957-3d1c5.firebasestorage.app",
  messagingSenderId: "652853189803",
  appId: "1:652853189803:web:5d1d2f4649e69cbc04ebee"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const UI = {
  authSection: document.getElementById("authSection"),
  appSection: document.getElementById("appSection"),
  authForm: document.getElementById("authForm"),
  authSubmit: document.getElementById("authSubmit"),
  authError: document.getElementById("authError"),
  authEmail: document.getElementById("authEmail"),
  authPassword: document.getElementById("authPassword"),
  loginTab: document.getElementById("loginTab"),
  registerTab: document.getElementById("registerTab"),
  taskForm: document.getElementById("taskForm"),
  taskError: document.getElementById("taskError"),
  taskTitle: document.getElementById("taskTitle"),
  taskDescription: document.getElementById("taskDescription"),
  taskReminder: document.getElementById("taskReminder"),
  taskRepeat: document.getElementById("taskRepeat"),
  taskGrid: document.getElementById("taskGrid"),
  emptyState: document.getElementById("emptyState"),
  voiceBtn: document.getElementById("voiceBtn"),
  voiceStatus: document.getElementById("voiceStatus"),
  voiceTranscript: document.getElementById("voiceTranscript"),
  logoutBtn: document.getElementById("logoutBtn"),
  notificationBtn: document.getElementById("notificationBtn"),
  themeToggle: document.getElementById("themeToggle"),
  userBadge: document.getElementById("userBadge"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  toastRoot: document.getElementById("toastRoot"),
  searchInput: document.getElementById("searchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortOrder: document.getElementById("sortOrder"),
  completedToday: document.getElementById("completedToday"),
  productivityScore: document.getElementById("productivityScore"),
  pendingCount: document.getElementById("pendingCount"),
  aiSummaryBtn: document.getElementById("aiSummaryBtn")
};

const State = {
  mode: "login",
  currentUser: null,
  unsubscribeTasks: null,
  tasks: [],
  reminderIntervalId: null,
  reminderDedup: new Set(),
  recognition: null,
  isListening: false
};

const TaskService = {
  async createTask(input) {
    validateTaskInput(input);

    await addDoc(collection(db, "tasks"), {
      userId: State.currentUser.uid,
      title: input.title,
      description: input.description,
      createdAt: serverTimestamp(),
      reminderTime: input.reminderTime ? Timestamp.fromDate(input.reminderTime) : null,
      repeatType: input.repeatType,
      completed: false
    });
  },

  async markTaskComplete(taskId, completed = true) {
    const ref = doc(db, "tasks", taskId);
    await updateDoc(ref, { completed, completedAt: completed ? serverTimestamp() : null });
  },

  async deleteTask(taskId) {
    const ref = doc(db, "tasks", taskId);
    await deleteDoc(ref);
  },

  subscribeToUserTasks(userId) {
    if (State.unsubscribeTasks) {
      State.unsubscribeTasks();
    }

    const q = query(collection(db, "tasks"), where("userId", "==", userId), orderBy("createdAt", "desc"));
    State.unsubscribeTasks = onSnapshot(
      q,
      (snapshot) => {
        State.tasks = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderTasks();
        renderAnalytics();
      },
      (error) => {
        showToast(`Task sync failed: ${error.message}`, "error");
      }
    );
  }
};

const AuthService = {
  async init() {
    await setPersistence(auth, browserLocalPersistence);

    onAuthStateChanged(auth, async (user) => {
      State.currentUser = user;
      if (!user) {
        showAuthSection();
        stopReminderChecker();
        if (State.unsubscribeTasks) {
          State.unsubscribeTasks();
          State.unsubscribeTasks = null;
        }
        State.tasks = [];
        renderTasks();
        return;
      }

      showAppSection(user.email);
      TaskService.subscribeToUserTasks(user.uid);
      await ensureUserProfile(user);
      startReminderChecker();
    });
  },

  async login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
  },

  async register(email, password) {
    return createUserWithEmailAndPassword(auth, email, password);
  },

  async logout() {
    await signOut(auth);
  }
};

const VoiceService = {
  init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      UI.voiceBtn.disabled = true;
      UI.voiceStatus.textContent = "Not supported";
      return;
    }

    State.recognition = new SpeechRecognition();
    State.recognition.lang = "en-US";
    State.recognition.interimResults = false;

    State.recognition.onstart = () => {
      State.isListening = true;
      UI.voiceStatus.textContent = "Listening...";
      UI.voiceStatus.classList.add("listening");
      UI.voiceBtn.textContent = "Listening";
    };

    State.recognition.onend = () => {
      State.isListening = false;
      UI.voiceStatus.textContent = "Idle";
      UI.voiceStatus.classList.remove("listening");
      UI.voiceBtn.textContent = "Start Listening";
    };

    State.recognition.onerror = (event) => {
      showToast(`Voice error: ${event.error}`, "error");
      speak("Voice recognition failed.");
    };

    State.recognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript.trim();
      UI.voiceTranscript.textContent = transcript;
      await handleVoiceCommand(transcript);
    };
  },

  start() {
    if (!State.recognition || State.isListening) {
      return;
    }
    State.recognition.start();
  }
};

function attachEvents() {
  UI.loginTab.addEventListener("click", () => switchAuthMode("login"));
  UI.registerTab.addEventListener("click", () => switchAuthMode("register"));

  UI.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.authError.textContent = "";

    const email = UI.authEmail.value.trim();
    const password = UI.authPassword.value.trim();

    if (!email || password.length < 6) {
      UI.authError.textContent = "Enter a valid email and password (6+ chars).";
      return;
    }

    withLoading(async () => {
      try {
        if (State.mode === "login") {
          await AuthService.login(email, password);
          showToast("Welcome back");
        } else {
          await AuthService.register(email, password);
          showToast("Account created");
        }
        UI.authForm.reset();
      } catch (error) {
        UI.authError.textContent = mapAuthError(error);
      }
    });
  });

  UI.taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    UI.taskError.textContent = "";

    const input = {
      title: sanitize(UI.taskTitle.value),
      description: sanitize(UI.taskDescription.value),
      reminderTime: UI.taskReminder.value ? new Date(UI.taskReminder.value) : null,
      repeatType: UI.taskRepeat.value
    };

    withLoading(async () => {
      try {
        await TaskService.createTask(input);
        UI.taskForm.reset();
        showToast("Task added");
        speak("Task added successfully");
      } catch (error) {
        UI.taskError.textContent = error.message || "Task could not be saved.";
      }
    });
  });

  UI.logoutBtn.addEventListener("click", async () => {
    await withLoading(async () => {
      try {
        await AuthService.logout();
        showToast("Logged out");
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });

  UI.voiceBtn.addEventListener("click", () => VoiceService.start());

  UI.notificationBtn.addEventListener("click", async () => {
    const status = await requestNotificationPermission();
    showToast(`Notifications: ${status}`);
  });

  UI.themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });

  UI.searchInput.addEventListener("input", renderTasks);
  UI.statusFilter.addEventListener("change", renderTasks);
  UI.sortOrder.addEventListener("change", renderTasks);

  UI.aiSummaryBtn.addEventListener("click", () => {
    const summary = generateAiSummary(State.tasks);
    showToast(summary);
    speak(summary);
  });

  UI.taskGrid.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const { id, action } = target.dataset;
    if (!id || !action) {
      return;
    }

    withLoading(async () => {
      try {
        if (action === "complete") {
          await TaskService.markTaskComplete(id, true);
          showToast("Task marked complete");
          return;
        }

        if (action === "reopen") {
          await TaskService.markTaskComplete(id, false);
          showToast("Task reopened");
          return;
        }

        if (action === "delete") {
          const ok = window.confirm("Delete this task permanently?");
          if (!ok) {
            return;
          }
          await TaskService.deleteTask(id);
          showToast("Task deleted");
        }
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  });
}

function showAuthSection() {
  UI.authSection.classList.remove("hidden");
  UI.appSection.classList.add("hidden");
}

function showAppSection(email) {
  UI.authSection.classList.add("hidden");
  UI.appSection.classList.remove("hidden");
  UI.userBadge.textContent = email || "";
}

function switchAuthMode(mode) {
  State.mode = mode;
  const isLogin = mode === "login";
  UI.loginTab.classList.toggle("active", isLogin);
  UI.registerTab.classList.toggle("active", !isLogin);
  UI.authSubmit.textContent = isLogin ? "Login" : "Register";
  UI.authError.textContent = "";
}

function renderTasks() {
  const tasks = getFilteredAndSortedTasks();
  UI.taskGrid.innerHTML = "";
  UI.emptyState.classList.toggle("hidden", tasks.length > 0);

  tasks.forEach((task) => {
    const reminderLabel = task.reminderTime?.toDate ? formatDate(task.reminderTime.toDate()) : "No reminder";
    const statusClass = task.completed ? "completed" : "pending";
    const statusText = task.completed ? "Completed" : "Pending";

    const card = document.createElement("article");
    card.className = "task-card";
    card.innerHTML = `
      <h3 class="task-title">${escapeHtml(task.title)}</h3>
      <span class="chip ${statusClass}">${statusText}</span>
      <p class="task-meta">${escapeHtml(task.description || "No description")}</p>
      <p class="task-meta">Reminder: ${escapeHtml(reminderLabel)}</p>
      <p class="task-meta">Repeat: ${escapeHtml(task.repeatType || "none")}</p>
      <div class="task-actions">
        <button class="btn btn-outline" data-action="${task.completed ? "reopen" : "complete"}" data-id="${task.id}">
          ${task.completed ? "Mark Pending" : "Mark Complete"}
        </button>
        <button class="btn btn-danger" data-action="delete" data-id="${task.id}">Delete</button>
      </div>
    `;
    UI.taskGrid.appendChild(card);
  });
}

function renderAnalytics() {
  const today = new Date();
  const completedToday = State.tasks.filter((task) => {
    if (!task.completedAt?.toDate) {
      return false;
    }
    const dt = task.completedAt.toDate();
    return dt.toDateString() === today.toDateString();
  }).length;

  const total = State.tasks.length;
  const completed = State.tasks.filter((t) => t.completed).length;
  const pending = total - completed;
  const score = total ? Math.round((completed / total) * 100) : 0;

  UI.completedToday.textContent = String(completedToday);
  UI.productivityScore.textContent = `${score}%`;
  UI.pendingCount.textContent = String(pending);
}

function getFilteredAndSortedTasks() {
  const search = UI.searchInput.value.trim().toLowerCase();
  const status = UI.statusFilter.value;
  const sort = UI.sortOrder.value;

  const filtered = State.tasks.filter((task) => {
    const matchSearch =
      task.title?.toLowerCase().includes(search) || task.description?.toLowerCase().includes(search);

    const matchStatus =
      status === "all" || (status === "completed" && task.completed) || (status === "pending" && !task.completed);

    return matchSearch && matchStatus;
  });

  filtered.sort((a, b) => {
    if (sort === "created_asc") {
      return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
    }
    if (sort === "due_asc") {
      return (a.reminderTime?.seconds || Number.MAX_SAFE_INTEGER) - (b.reminderTime?.seconds || Number.MAX_SAFE_INTEGER);
    }
    if (sort === "due_desc") {
      return (b.reminderTime?.seconds || 0) - (a.reminderTime?.seconds || 0);
    }
    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
  });

  return filtered;
}

function startReminderChecker() {
  stopReminderChecker();
  State.reminderIntervalId = window.setInterval(async () => {
    const now = Date.now();

    for (const task of State.tasks) {
      if (task.completed || !task.reminderTime?.toDate) {
        continue;
      }

      const reminderDate = task.reminderTime.toDate();
      const dueTime = reminderDate.getTime();
      const isDue = now >= dueTime && now - dueTime < 60000;
      const dedupKey = `${task.id}-${Math.floor(dueTime / 60000)}`;

      if (!isDue || State.reminderDedup.has(dedupKey)) {
        continue;
      }

      State.reminderDedup.add(dedupKey);
      const text = `Reminder: ${task.title}`;
      speak(text);
      notify(text);
      showToast(text);

      // For recurring tasks, immediately schedule the next reminder.
      if (task.repeatType === "daily" || task.repeatType === "weekly") {
        const next = new Date(reminderDate);
        next.setDate(next.getDate() + (task.repeatType === "daily" ? 1 : 7));
        try {
          await updateDoc(doc(db, "tasks", task.id), {
            reminderTime: Timestamp.fromDate(next),
            completed: false
          });
        } catch (error) {
          showToast(`Repeat update failed: ${error.message}`, "error");
        }
      }
    }
  }, 30000);
}

function stopReminderChecker() {
  if (State.reminderIntervalId) {
    clearInterval(State.reminderIntervalId);
    State.reminderIntervalId = null;
  }
  State.reminderDedup.clear();
}

async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    return "not-supported";
  }

  if (Notification.permission === "granted") {
    return "granted";
  }

  if (Notification.permission === "denied") {
    return "denied";
  }

  const permission = await Notification.requestPermission();
  return permission;
}

function notify(text) {
  if (!("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }

  new Notification("Voice Task Manager", { body: text });
}

async function handleVoiceCommand(transcript) {
  const normalized = transcript.toLowerCase().trim();

  if (normalized.startsWith("add task")) {
    const { title, reminderDate } = parseAddCommand(normalized);
    if (!title) {
      speak("I could not find a task title.");
      showToast("Voice add failed: missing title", "error");
      return;
    }

    try {
      await TaskService.createTask({
        title,
        description: "",
        reminderTime: reminderDate,
        repeatType: "none"
      });
      const msg = `Task added: ${title}`;
      speak(msg);
      showToast(msg);
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }

  if (normalized.startsWith("complete task")) {
    const title = normalized.replace("complete task", "").trim();
    const task = findTaskByTitle(title);
    if (!task) {
      speak("Task not found.");
      showToast("No matching task to complete", "error");
      return;
    }

    await TaskService.markTaskComplete(task.id, true);
    speak(`Marked complete: ${task.title}`);
    showToast(`Completed: ${task.title}`);
    return;
  }

  if (normalized.startsWith("delete task")) {
    const title = normalized.replace("delete task", "").trim();
    const task = findTaskByTitle(title);
    if (!task) {
      speak("Task not found.");
      showToast("No matching task to delete", "error");
      return;
    }

    await TaskService.deleteTask(task.id);
    speak(`Deleted task: ${task.title}`);
    showToast(`Deleted: ${task.title}`);
    return;
  }

  speak("Unknown command. Try add, complete, or delete task.");
}

function parseAddCommand(command) {
  const match = command.match(/^add task\s+(.+?)(?:\s+at\s+(.+))?$/i);
  if (!match) {
    return { title: "", reminderDate: null };
  }

  const title = sanitize(match[1] || "");
  const timePart = match[2] ? match[2].trim() : "";
  const reminderDate = timePart ? parseNaturalTime(timePart) : null;
  return { title, reminderDate };
}

function parseNaturalTime(raw) {
  const input = raw.toLowerCase().trim();
  const base = new Date();

  const hasTomorrow = input.includes("tomorrow");
  if (hasTomorrow) {
    base.setDate(base.getDate() + 1);
  }

  const timeMatch = input.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!timeMatch) {
    const fallback = new Date(Date.parse(raw));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  let hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2] || "0", 10);
  const meridiem = timeMatch[3];

  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  const parsed = new Date(base);
  parsed.setHours(hours, minutes, 0, 0);

  if (!hasTomorrow && parsed.getTime() < Date.now()) {
    parsed.setDate(parsed.getDate() + 1);
  }

  return parsed;
}

function findTaskByTitle(queryTitle) {
  const target = queryTitle.toLowerCase().trim();
  return State.tasks.find((task) => task.title?.toLowerCase() === target) ||
    State.tasks.find((task) => task.title?.toLowerCase().includes(target));
}

function validateTaskInput(input) {
  if (!State.currentUser?.uid) {
    throw new Error("You must be logged in.");
  }

  if (!input.title || input.title.length < 2) {
    throw new Error("Title must be at least 2 characters.");
  }

  if (!["none", "daily", "weekly"].includes(input.repeatType)) {
    throw new Error("Invalid repeat type.");
  }

  if (input.reminderTime && Number.isNaN(input.reminderTime.getTime())) {
    throw new Error("Invalid reminder time.");
  }
}

async function ensureUserProfile(user) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      email: user.email || "",
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function withLoading(fn) {
  showLoading(true);
  return Promise.resolve(fn()).finally(() => showLoading(false));
}

function showLoading(show) {
  UI.loadingOverlay.classList.toggle("hidden", !show);
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = "toast";
  if (type === "error") {
    toast.style.borderColor = "rgba(255, 93, 110, 0.45)";
  }
  toast.textContent = message;
  UI.toastRoot.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2800);
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance);
}

function generateAiSummary(tasks) {
  if (!tasks.length) {
    return "No tasks available to summarize.";
  }

  const completed = tasks.filter((task) => task.completed).length;
  const pending = tasks.length - completed;
  const dueToday = tasks.filter((task) => {
    if (!task.reminderTime?.toDate) {
      return false;
    }
    return task.reminderTime.toDate().toDateString() === new Date().toDateString();
  }).length;

  return `You have ${tasks.length} total tasks: ${completed} completed, ${pending} pending, ${dueToday} due today.`;
}

function sanitize(value) {
  return value.replace(/[<>]/g, "").trim();
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function mapAuthError(error) {
  if (!error?.code) {
    return "Authentication failed.";
  }
  if (error.code.includes("invalid-credential")) {
    return "Invalid email or password.";
  }
  if (error.code.includes("email-already-in-use")) {
    return "Email already in use.";
  }
  if (error.code.includes("weak-password")) {
    return "Password is too weak.";
  }
  return error.message || "Authentication failed.";
}

function bootTheme() {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  }
}

async function start() {
  bootTheme();
  switchAuthMode("login");
  attachEvents();
  VoiceService.init();
  await AuthService.init();
}

start().catch((error) => {
  showToast(`Startup failed: ${error.message}`, "error");
});
