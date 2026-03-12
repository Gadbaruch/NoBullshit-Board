const STORAGE_NAMESPACE = "tiny-task-board-v7";
const LEGACY_KEYS = [
  "tiny-task-board-v6",
  "tiny-task-board-v5",
  "tiny-task-board-v4",
  "tiny-task-board-v3",
  "tiny-task-board-v2",
  "tiny-task-board-v1"
];

const els = {
  boardTitleWrap: document.getElementById("boardTitleWrap"),
  boardNameDisplay: document.getElementById("boardNameDisplay"),
  board: document.getElementById("board"),
  boardTopScroll: document.getElementById("boardTopScroll"),
  boardTopScrollInner: document.getElementById("boardTopScrollInner"),
  globalPie: document.getElementById("globalPie"),
  globalStatsText: document.getElementById("globalStatsText"),
  moreMenu: document.getElementById("moreMenu"),
  moreBtn: document.getElementById("moreBtn"),
  moreDropdown: document.getElementById("moreDropdown"),
  newBoardAction: document.getElementById("newBoardAction"),
  exportPdfAction: document.getElementById("exportPdfAction"),
  exportSheetAction: document.getElementById("exportSheetAction"),
  importSheetAction: document.getElementById("importSheetAction"),
  projectTrash: document.getElementById("projectTrash"),
  projectTemplate: document.getElementById("projectTemplate"),
  taskTemplate: document.getElementById("taskTemplate")
};

let currentBoardSlug = getBoardSlugFromUrl();
let state = loadState(currentBoardSlug);
let dragTaskId = null;
let dragProjectId = null;
let pendingFocusTaskId = null;
let taskPlaceholder = null;
let projectPlaceholder = null;
let resizeState = null;
let openEmojiMenu = null;
const QUICK_EMOJIS = ["😀", "😅", "😍", "🤩", "🔥", "✅", "🚀", "🎯", "🧠", "📌", "📅", "💡", "🛠️", "🧹", "🧩", "🎵", "💰", "📞"];
const DAY_MS = 24 * 60 * 60 * 1000;

wireEvents();
render();
ensureBoardSlugInUrl(currentBoardSlug);

function loadState(boardSlug) {
  const current = localStorage.getItem(storageKeyFor(boardSlug));
  if (current) {
    try {
      const normalized = normalizeState(JSON.parse(current));
      if (normalized) return normalized;
    } catch {
      // keep trying legacy
    }
  }

  for (const key of LEGACY_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    try {
      const normalized = normalizeAnyLegacy(JSON.parse(raw));
      if (normalized) {
        localStorage.setItem(storageKeyFor(boardSlug), JSON.stringify(normalized));
        return normalized;
      }
    } catch {
      // continue
    }
  }

  return makeDefaultState(slugToBoardName(boardSlug));
}

function makeDefaultState(boardName = "_____") {
  const id = makeId();
  return {
    version: 7,
    boardName: boardName.trim() || "_____",
    projects: [{ id, name: "General", view: "todo", width: 1 }],
    tasks: {},
    lists: {
      [id]: { todo: [], done: [] }
    }
  };
}

function normalizeState(parsed) {
  if (!parsed || !Array.isArray(parsed.projects) || typeof parsed.tasks !== "object" || typeof parsed.lists !== "object") {
    return null;
  }

  const projects = parsed.projects
    .filter((p) => p && typeof p.id === "string" && typeof p.name === "string")
    .map((p) => ({
      id: p.id,
      name: p.name.trim(),
      view: p.view === "done" ? "done" : "todo",
      width: clampProjectWidth(Number.isFinite(p.width) ? p.width : 1)
    }))
    .filter((p) => p.name);

  if (!projects.length) return null;

  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = {};

  for (const [id, t] of Object.entries(parsed.tasks)) {
    if (!t || typeof t.projectId !== "string" || !projectIds.has(t.projectId)) continue;

    const createdAt = normalizeTimestamp(t.createdAt) ?? Date.now();
    const updatedAt = normalizeTimestamp(t.updatedAt) ?? createdAt;
    const completedAt = normalizeTimestamp(t.completedAt);
    tasks[id] = {
      id,
      text: typeof t.text === "string" ? t.text : "",
      projectId: t.projectId,
      status: t.status === "done" ? "done" : "todo",
      emojis: Array.isArray(t.emojis) ? t.emojis.filter((e) => typeof e === "string").slice(0, 12) : [],
      createdAt,
      updatedAt,
      completedAt: t.status === "done" ? completedAt ?? updatedAt : null
    };
  }

  const lists = {};
  for (const project of projects) {
    const rawList = parsed.lists[project.id] || {};
    lists[project.id] = {
      todo: Array.isArray(rawList.todo) ? rawList.todo.filter((id) => tasks[id] && tasks[id].status === "todo") : [],
      done: Array.isArray(rawList.done) ? rawList.done.filter((id) => tasks[id] && tasks[id].status === "done") : []
    };
  }

  for (const task of Object.values(tasks)) {
    const bucket = lists[task.projectId][task.status];
    if (!bucket.includes(task.id)) bucket.push(task.id);
  }

  return {
    version: 7,
    boardName: typeof parsed.boardName === "string" && parsed.boardName.trim() ? parsed.boardName.trim() : "_____",
    projects,
    tasks,
    lists
  };
}

function normalizeAnyLegacy(parsed) {
  if (!parsed || !Array.isArray(parsed.projects)) return null;

  if (typeof parsed.tasks === "object" && typeof parsed.lists === "object") {
    const projects = parsed.projects.map((p) => {
      if (typeof p === "string") {
        return { id: makeId(), name: p, view: "todo", width: 1 };
      }
      return {
        id: p.id,
        name: p.name,
        view: p.view === "done" ? "done" : "todo",
        width: clampProjectWidth(Number.isFinite(p.width) ? p.width : 1)
      };
    });

    return normalizeState({ projects, tasks: parsed.tasks, lists: parsed.lists });
  }

  const names = parsed.projects.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim());
  const uniqueNames = [...new Set(names.length ? names : ["General"])];

  const projects = uniqueNames.map((name) => ({ id: makeId(), name, view: "todo", width: 1 }));
  const byName = Object.fromEntries(projects.map((p) => [p.name, p.id]));
  const tasks = {};
  const lists = Object.fromEntries(projects.map((p) => [p.id, { todo: [], done: [] }]));

  const oldTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  for (const old of oldTasks) {
    if (!old || typeof old.text !== "string") continue;

    const projectName = typeof old.project === "string" && old.project.trim() ? old.project.trim() : uniqueNames[0];
    let projectId = byName[projectName];

    if (!projectId) {
      const p = { id: makeId(), name: projectName, view: "todo", width: 1 };
      projects.push(p);
      byName[p.name] = p.id;
      lists[p.id] = { todo: [], done: [] };
      projectId = p.id;
    }

    const id = typeof old.id === "string" ? old.id : makeId();
    const status = old.priority === "done" ? "done" : "todo";

    tasks[id] = {
      id,
      text: old.text,
      projectId,
      status,
      emojis: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: status === "done" ? Date.now() : null
    };
    lists[projectId][status].push(id);
  }

  return normalizeState({ projects, tasks, lists });
}

function saveState(next = state) {
  localStorage.setItem(storageKeyFor(currentBoardSlug), JSON.stringify(next));
}

function storageKeyFor(boardSlug) {
  return `${STORAGE_NAMESPACE}::${boardSlug}`;
}

function getBoardSlugFromUrl() {
  const hash = window.location.hash.replace(/^#/, "").trim();
  return normalizeBoardSlug(hash) || "main";
}

function normalizeBoardSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function slugifyBoardName(name) {
  return normalizeBoardSlug(name) || "board";
}

function slugToBoardName(slug) {
  return String(slug || "_____")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "_____";
}

function ensureUniqueBoardSlug(baseSlug, keepCurrentSlug = "") {
  const base = normalizeBoardSlug(baseSlug) || "board";
  let slug = base;
  let suffix = 2;
  while (slug !== keepCurrentSlug && localStorage.getItem(storageKeyFor(slug))) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function ensureBoardSlugInUrl(slug) {
  const normalized = normalizeBoardSlug(slug) || "main";
  if (getBoardSlugFromUrl() === normalized) return;
  window.location.hash = normalized;
}

function switchBoardFromUrl() {
  const nextSlug = getBoardSlugFromUrl();
  if (nextSlug === currentBoardSlug) return;
  currentBoardSlug = nextSlug;
  state = loadState(currentBoardSlug);
  render();
}

function persistBoardUnderSlug(nextSlug, previousSlug = currentBoardSlug) {
  localStorage.setItem(storageKeyFor(nextSlug), JSON.stringify(state));
  if (previousSlug && previousSlug !== nextSlug) {
    localStorage.removeItem(storageKeyFor(previousSlug));
  }
}

function wireEvents() {
  els.boardNameDisplay.addEventListener("click", () => {
    startBoardNameInlineEdit();
  });
  els.boardNameDisplay.addEventListener("blur", finishBoardNameEdit);
  els.boardNameDisplay.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishBoardNameEdit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      els.boardNameDisplay.textContent = state.boardName || "_____";
      els.boardNameDisplay.contentEditable = "false";
      els.boardTitleWrap.classList.remove("editing");
    }
  });

  els.moreBtn.addEventListener("click", toggleMoreMenu);
  els.newBoardAction.addEventListener("click", () => {
    closeMoreMenu();
    startNewBoard();
  });
  els.exportPdfAction.addEventListener("click", () => {
    closeMoreMenu();
    exportPdfSummary();
  });
  els.exportSheetAction.addEventListener("click", () => {
    closeMoreMenu();
    exportSheetSummary();
  });
  els.importSheetAction.addEventListener("click", () => {
    closeMoreMenu();
    importSheetSummary();
  });

  document.addEventListener("click", (event) => {
    if (!els.moreMenu.contains(event.target)) closeMoreMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMoreMenu();
  });
  window.addEventListener("hashchange", () => {
    switchBoardFromUrl();
  });

  wireBoardScrollSync();

  els.board.addEventListener("dragover", (event) => {
    if (!dragProjectId) return;
    event.preventDefault();
    moveProjectPlaceholder(event.clientX);
  });

  els.board.addEventListener("drop", (event) => {
    if (!dragProjectId) return;
    event.preventDefault();

    const targetIndex = getProjectPlaceholderIndex();
    reorderProject(dragProjectId, targetIndex);
    clearDragState();
  });

  els.projectTrash.addEventListener("dragover", (event) => {
    if (!dragProjectId && !dragTaskId) return;
    event.preventDefault();
    els.projectTrash.classList.add("over");
  });

  els.projectTrash.addEventListener("dragleave", () => {
    els.projectTrash.classList.remove("over");
  });

  els.projectTrash.addEventListener("drop", (event) => {
    event.preventDefault();
    els.projectTrash.classList.remove("over");

    if (dragProjectId) deleteProject(dragProjectId);
    if (dragTaskId) deleteTask(dragTaskId);

    clearDragState();
  });

  document.addEventListener("wheel", onGlobalWheel, { passive: false, capture: true });
}

function toggleMoreMenu(event) {
  event.stopPropagation();
  const isOpen = !els.moreDropdown.hidden;
  els.moreDropdown.hidden = isOpen;
  els.moreBtn.setAttribute("aria-expanded", String(!isOpen));
}

function closeMoreMenu() {
  els.moreDropdown.hidden = true;
  els.moreBtn.setAttribute("aria-expanded", "false");
}

function render() {
  renderBoardTitle();
  renderTopStats();
  renderBoard();
  syncTopScrollSize();
  focusPendingTaskInput();
}

function renderBoardTitle() {
  const value = state.boardName || "_____";
  els.boardNameDisplay.textContent = value;
  document.title = `${value} Board`;
}

function finishBoardNameEdit() {
  const next = (els.boardNameDisplay.textContent || "").replace(/\n+/g, " ").trim() || "_____";
  const previousSlug = currentBoardSlug;
  state.boardName = next;
  els.boardNameDisplay.textContent = next;
  els.boardNameDisplay.contentEditable = "false";
  els.boardTitleWrap.classList.remove("editing");
  const nextSlug = ensureUniqueBoardSlug(slugifyBoardName(next), previousSlug);
  persistBoardUnderSlug(nextSlug, previousSlug);
  currentBoardSlug = nextSlug;
  ensureBoardSlugInUrl(nextSlug);
  renderBoardTitle();
}

function startBoardNameInlineEdit() {
  els.boardTitleWrap.classList.add("editing");
  els.boardNameDisplay.contentEditable = "true";
  els.boardNameDisplay.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(els.boardNameDisplay);
  selection.removeAllRanges();
  selection.addRange(range);
}

function startNewBoard() {
  const raw = prompt("Board name", "_____");
  if (raw == null) return;
  const name = raw.trim() || "_____";
  const slug = ensureUniqueBoardSlug(slugifyBoardName(name));
  const next = makeDefaultState(name);
  localStorage.setItem(storageKeyFor(slug), JSON.stringify(next));
  currentBoardSlug = slug;
  state = next;
  ensureBoardSlugInUrl(slug);
  render();
}

function renderBoard() {
  els.board.innerHTML = "";

  for (const project of state.projects) {
    const node = els.projectTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.projectId = project.id;
    node.style.setProperty("--project-bg", projectColor(project.id));
    node.style.setProperty("--project-width", String(clampProjectWidth(project.width ?? 1)));

    const titleWrap = node.querySelector(".project-title-wrap");
    const title = node.querySelector(".project-title");
    const titleInput = node.querySelector(".project-title-input");
    title.textContent = project.name;
    titleInput.value = project.name;
    title.addEventListener("click", () => {
      titleWrap.classList.add("editing");
      titleInput.focus();
      titleInput.select();
    });
    titleInput.addEventListener("blur", () => {
      finishProjectTitleEdit(project.id, titleWrap, title, titleInput);
    });
    titleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finishProjectTitleEdit(project.id, titleWrap, title, titleInput);
      }
      if (event.key === "Escape") {
        titleInput.value = project.name;
        titleWrap.classList.remove("editing");
      }
    });

    node.addEventListener("dragstart", (event) => {
      if (event.target.closest(".task")) return;
      dragProjectId = project.id;
      node.classList.add("dragging");
      document.body.classList.add("is-dragging");
      createProjectPlaceholder(node);
    });

    node.addEventListener("dragend", () => {
      node.classList.remove("dragging");
      clearDragState();
    });

    const todoCount = state.lists[project.id].todo.length;
    const doneCount = state.lists[project.id].done.length;

    const archiveBtn = node.querySelector(".archive-btn");
    archiveBtn.hidden = project.view !== "done";
    archiveBtn.addEventListener("click", () => archiveDone(project.id));
    node.querySelectorAll(".resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => startResize(event, project.id, node));
    });

    const listToggle = node.querySelector(".list-toggle");
    listToggle.textContent = project.view === "todo" ? `Done (${doneCount})` : `To Do (${todoCount})`;
    listToggle.addEventListener("click", () => {
      project.view = project.view === "todo" ? "done" : "todo";
      saveState();
      render();
    });

    const addStrip = node.querySelector(".task-add-strip");
    addStrip.hidden = project.view !== "todo";
    addStrip.addEventListener("click", () => addEmptyTask(project.id));

    const zone = node.querySelector(".dropzone");
    zone.dataset.status = project.view;
    paintProjectPie(node.querySelector(".project-pie"), project.id);

    const list = state.lists[project.id][project.view];
    if (project.view === "todo") {
      drawTodoList(zone, list);
    } else {
      drawDoneList(zone, list);
    }

    setupTaskDropzone(zone, project.id, project.view);
    els.board.append(node);
  }

  const newProjectTile = document.createElement("button");
  newProjectTile.type = "button";
  newProjectTile.className = "project-new-tile";
  newProjectTile.setAttribute("aria-label", "New project");
  newProjectTile.innerHTML = `<span class="plus">+</span><span class="label">new project</span>`;
  newProjectTile.addEventListener("click", createProject);
  els.board.append(newProjectTile);
}

function drawTodoList(zone, taskIds) {
  zone.innerHTML = "";
  const total = taskIds.length;

  taskIds.forEach((id, index) => {
    const task = state.tasks[id];
    if (!task) return;

    zone.append(taskNode(task, segmentForIndex(index, total)));
  });
}

function drawDoneList(zone, taskIds) {
  zone.innerHTML = "";

  for (const id of taskIds) {
    const task = state.tasks[id];
    if (!task) continue;

    zone.append(taskNode(task, "low"));
  }
}

function segmentForIndex(index, total) {
  if (total <= 0) return "low";

  const highCount = Math.ceil(total / 3);
  const midCount = Math.ceil((total - highCount) / 2);

  if (index < highCount) return "high";
  if (index < highCount + midCount) return "mid";
  return "low";
}

function taskNode(task, segment) {
  const node = els.taskTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.id = task.id;
  node.dataset.status = task.status;
  node.dataset.segment = segment;
  const closedLabel = task.completedAt ? `Closed ${formatTaskCreated(task.completedAt)}` : "";
  const createdLabel = task.createdAt ? `Created ${formatTaskCreated(task.createdAt)}` : "";
  node.dataset.createdLabel = task.status === "done" ? closedLabel : createdLabel;
  applyTaskAgeVisual(node, task, segment);

  const body = node.querySelector(".task-body");
  const tags = node.querySelector(".task-tags");
  const input = node.querySelector(".task-text");
  const preview = node.querySelector(".task-preview");
  input.value = task.text;
  autoSizeTextarea(input);
  renderMarkdownPreview(preview, task.id, input);
  renderTaskTags(tags, task.id);
  if (task.text.trim() === "") body.classList.add("editing");

  input.addEventListener("input", () => {
    state.tasks[task.id].text = input.value;
    state.tasks[task.id].updatedAt = currentNow();
    autoSizeTextarea(input);
    renderMarkdownPreview(preview, task.id, input);
    saveState();
  });

  input.addEventListener("focus", () => {
    body.classList.add("editing");
    autoSizeTextarea(input);
  });

  input.addEventListener("blur", () => {
    body.classList.remove("editing");
    renderMarkdownPreview(preview, task.id, input);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (!isChecklistLineAtCursor(input)) return;

    event.preventDefault();
    insertNewChecklistLine(input);
    state.tasks[task.id].text = input.value;
    state.tasks[task.id].updatedAt = currentNow();
    autoSizeTextarea(input);
    renderMarkdownPreview(preview, task.id, input);
    saveState();
  });

  preview.addEventListener("click", (event) => {
    if (event.target.closest("a")) return;

    const checkbox = event.target.closest("input[type=\"checkbox\"][data-line-index]");
    if (!checkbox) {
      body.classList.add("editing");
      autoSizeTextarea(input);
      input.focus();
      return;
    }

    const lineIndex = Number(checkbox.dataset.lineIndex);
    const nextText = setChecklistLineChecked(input.value, lineIndex, checkbox.checked);
    input.value = nextText;
    state.tasks[task.id].text = nextText;
    state.tasks[task.id].updatedAt = currentNow();
    autoSizeTextarea(input);
    renderMarkdownPreview(preview, task.id, input);
    saveState();
  });

  const doneBtn = node.querySelector(".done-btn");
  doneBtn.textContent = "";
  doneBtn.addEventListener("click", () => handleDoneClick(task.id, doneBtn));

  const emojiBtn = node.querySelector(".emoji-btn");
  emojiBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  emojiBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleEmojiMenu(emojiBtn, input, body, preview, tags, task.id);
  });

  node.addEventListener("dragstart", () => {
    dragTaskId = task.id;
    node.classList.add("dragging");
    document.body.classList.add("is-dragging");
    createTaskPlaceholder(node);
  });

  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    clearDragState();
  });

  return node;
}

function renderMarkdownPreview(container, taskId, textarea) {
  const source = textarea.value;
  if (source.trim() === "") {
    container.innerHTML = "<p></p>";
    return;
  }

  const lines = source.split("\n");
  let html = "";
  let inBullet = false;
  let inChecklist = false;

  const closeLists = () => {
    if (inChecklist) {
      html += "</ul>";
      inChecklist = false;
    }
    if (inBullet) {
      html += "</ul>";
      inBullet = false;
    }
  };

  lines.forEach((line, lineIndex) => {
    const heading = line.match(/^\s*(#{1,3})\s+(.+)$/);
    const checklist = line.match(/^(\s*(?:[-*]\s*)?\[)(\s|x|X)?(\]\s*)(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (heading) {
      closeLists();
      const level = heading[1].length;
      html += `<h${level}>${renderInlineRichText(heading[2])}</h${level}>`;
      return;
    }

    if (checklist) {
      if (inBullet) {
        html += "</ul>";
        inBullet = false;
      }
      if (!inChecklist) {
        html += "<ul>";
        inChecklist = true;
      }
      const checked = (checklist[2] || "").toLowerCase() === "x";
      const checkedAttr = checked ? " checked" : "";
      const checkedClass = checked ? " is-checked" : "";
      html += `<li class="md-check-item${checkedClass}"><input type="checkbox" data-line-index="${lineIndex}"${checkedAttr}><span>${renderInlineRichText(checklist[4] || "")}</span></li>`;
      return;
    }

    if (bullet) {
      if (inChecklist) {
        html += "</ul>";
        inChecklist = false;
      }
      if (!inBullet) {
        html += "<ul>";
        inBullet = true;
      }
      html += `<li>${renderInlineRichText(bullet[1])}</li>`;
      return;
    }

    closeLists();
    if (line.trim() === "") {
      html += "<p>&nbsp;</p>";
      return;
    }

    html += `<p>${renderInlineRichText(line)}</p>`;
  });

  closeLists();
  container.innerHTML = html;
}

function parseChecklistItems(text) {
  const lines = text.split("\n");
  const items = [];

  lines.forEach((line, lineIndex) => {
    const match = line.match(/^(\s*(?:[-*]\s*)?\[)(\s|x|X)?(\]\s*)(.*)$/);
    if (!match) return;

    items.push({
      lineIndex,
      checked: (match[2] || "").toLowerCase() === "x",
      label: match[4]
    });
  });

  return items;
}

function setChecklistLineChecked(text, lineIndex, checked) {
  const lines = text.split("\n");
  const line = lines[lineIndex] || "";
  const replacement = checked ? "x" : " ";
  lines[lineIndex] = line.replace(/^(\s*(?:[-*]\s*)?\[)(?:\s|x|X)?(\])/, `$1${replacement}$2`);
  return lines.join("\n");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineRichText(value) {
  const source = String(value || "");
  const urlPattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi;

  let html = "";
  let cursor = 0;

  source.replace(urlPattern, (raw, match, offset) => {
    html += escapeHtml(source.slice(cursor, offset));

    const label = escapeHtml(match);
    const href = match.toLowerCase().startsWith("www.") ? `https://${match}` : match;
    html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;

    cursor = offset + raw.length;
    return raw;
  });

  html += escapeHtml(source.slice(cursor));
  return html;
}

function isChecklistLineAtCursor(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const line = before.split("\n").pop() || "";
  return /^\s*(?:[-*]\s*)?\[(?:\s|x|X)?\]\s?.*$/.test(line);
}

function insertNewChecklistLine(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const currentLine = value.slice(lineStart, start);
  const prefixMatch = currentLine.match(/^(\s*(?:[-*]\s*)?)\[(?:\s|x|X)?\]\s?/);
  const prefix = prefixMatch ? `${prefixMatch[1]}[ ] ` : "[ ] ";

  const insert = `\n${prefix}`;
  textarea.value = value.slice(0, start) + insert + value.slice(end);
  const nextPos = start + insert.length;
  textarea.setSelectionRange(nextPos, nextPos);
}

function autoSizeTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(46, textarea.scrollHeight)}px`;
}

function addEmptyTask(projectId) {
  const id = makeId();
  state.tasks[id] = {
    id,
    text: "",
    projectId,
    status: "todo",
    emojis: [],
    createdAt: currentNow(),
    updatedAt: currentNow(),
    completedAt: null
  };

  const project = state.projects.find((p) => p.id === projectId);
  if (project) project.view = "todo";

  state.lists[projectId].todo.unshift(id);
  pendingFocusTaskId = id;

  saveState();
  render();
}

function handleDoneClick(taskId, buttonEl) {
  const task = state.tasks[taskId];
  if (!task) return;

  if (task.status === "todo") {
    buttonEl.classList.add("complete-pop");
    launchConfetti(buttonEl);
    setTimeout(() => toggleDone(taskId), 180);
    return;
  }

  toggleDone(taskId);
}

function toggleDone(taskId) {
  const task = state.tasks[taskId];
  if (!task) return;

  removeFromList(task.projectId, task.status, taskId);
  task.status = task.status === "todo" ? "done" : "todo";
  task.updatedAt = currentNow();
  task.completedAt = task.status === "done" ? currentNow() : null;
  state.lists[task.projectId][task.status].unshift(taskId);

  saveState();
  render();
}

function archiveDone(projectId) {
  const doneIds = state.lists[projectId]?.done || [];
  if (!doneIds.length) return;
  if (!confirm("Are you sure you want to archive done tasks?")) return;

  for (const id of doneIds) {
    delete state.tasks[id];
  }
  state.lists[projectId].done = [];

  saveState();
  render();
}

function deleteTask(taskId) {
  const task = state.tasks[taskId];
  if (!task) return;

  removeFromList(task.projectId, task.status, taskId);
  delete state.tasks[taskId];

  saveState();
  render();
}

function createProject() {
  const raw = prompt("Project name");
  if (raw == null) return;

  const name = raw.trim();
  if (!name) return;

  const dupe = state.projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (dupe) return;

  const id = makeId();
  state.projects.push({ id, name, view: "todo", width: 1 });
  state.lists[id] = { todo: [], done: [] };

  saveState();
  render();
}

function renameProject(projectId) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  const raw = prompt("Rename project", project.name);
  if (raw == null) return;

  const name = raw.trim();
  if (!name) return;

  const dupe = state.projects.find((p) => p.id !== projectId && p.name.toLowerCase() === name.toLowerCase());
  if (dupe) return;

  project.name = name;
  saveState();
  render();
}

function deleteProject(projectId) {
  if (state.projects.length <= 1) return;

  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  const count = state.lists[projectId].todo.length + state.lists[projectId].done.length;
  if (!confirm(`Delete "${project.name}" and ${count} task(s)?`)) return;

  for (const id of state.lists[projectId].todo) delete state.tasks[id];
  for (const id of state.lists[projectId].done) delete state.tasks[id];

  delete state.lists[projectId];
  state.projects = state.projects.filter((p) => p.id !== projectId);

  saveState();
  render();
}

function setupTaskDropzone(zone, projectId, status) {
  zone.addEventListener("dragover", (event) => {
    if (!dragTaskId) return;
    event.preventDefault();
    zone.classList.add("over");
    moveTaskPlaceholder(zone, event.clientY);
  });

  zone.addEventListener("dragleave", () => {
    zone.classList.remove("over");
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("over");

    const taskId = dragTaskId;
    if (!taskId) return;

    const task = state.tasks[taskId];
    if (!task) return;

    removeFromList(task.projectId, task.status, taskId);
    task.projectId = projectId;
    task.status = status;

    const list = state.lists[projectId][status];
    const index = getTaskPlaceholderIndex(zone);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, taskId);

    saveState();
    render();
    clearDragState();
  });
}

function reorderProject(projectId, targetIndex) {
  const from = state.projects.findIndex((p) => p.id === projectId);
  if (from < 0) return;

  const [item] = state.projects.splice(from, 1);
  const rawTo = Math.max(0, Math.min(targetIndex, state.projects.length + 1));
  const to = from < rawTo ? rawTo - 1 : rawTo;
  state.projects.splice(to, 0, item);

  saveState();
  render();
}

function createProjectPlaceholder(projectNode) {
  if (!projectPlaceholder) {
    projectPlaceholder = document.createElement("div");
    projectPlaceholder.className = "project project-placeholder";
  }

  const widthPx = `${projectNode.getBoundingClientRect().width}px`;
  projectPlaceholder.style.width = widthPx;
  projectPlaceholder.style.flexBasis = widthPx;
  projectNode.insertAdjacentElement("afterend", projectPlaceholder);
}

function moveProjectPlaceholder(x) {
  if (!projectPlaceholder) return;

  const cards = [...els.board.querySelectorAll(".project")].filter(
    (card) => !card.classList.contains("dragging") && !card.classList.contains("project-placeholder")
  );

  let before = null;
  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (x < box.left + box.width / 2) {
      before = card;
      break;
    }
  }

  if (before) {
    els.board.insertBefore(projectPlaceholder, before);
    return;
  }

  const newProjectTile = els.board.querySelector(".project-new-tile");
  if (newProjectTile) {
    els.board.insertBefore(projectPlaceholder, newProjectTile);
  } else {
    els.board.append(projectPlaceholder);
  }
}

function getProjectPlaceholderIndex() {
  if (!projectPlaceholder || !projectPlaceholder.parentElement) return state.projects.length;

  let index = 0;
  for (const node of els.board.children) {
    if (node === projectPlaceholder) return index;
    if (node.classList.contains("project") && !node.classList.contains("project-placeholder")) {
      index += 1;
    }
  }
  return state.projects.length;
}

function createTaskPlaceholder(taskNode) {
  if (!taskPlaceholder) {
    taskPlaceholder = document.createElement("div");
    taskPlaceholder.className = "task-placeholder";
  }

  taskPlaceholder.style.height = `${Math.max(58, taskNode.getBoundingClientRect().height)}px`;
  taskNode.insertAdjacentElement("afterend", taskPlaceholder);
}

function moveTaskPlaceholder(zone, y) {
  if (!taskPlaceholder) return;

  const cards = [...zone.querySelectorAll(".task")].filter((card) => !card.classList.contains("dragging"));
  let before = null;

  for (const card of cards) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) {
      before = card;
      break;
    }
  }

  if (before) zone.insertBefore(taskPlaceholder, before);
  else zone.append(taskPlaceholder);
}

function getTaskPlaceholderIndex(zone) {
  if (!taskPlaceholder || taskPlaceholder.parentElement !== zone) return zone.querySelectorAll(".task").length;

  let index = 0;
  for (const child of zone.children) {
    if (child === taskPlaceholder) return index;
    if (child.classList.contains("task") && !child.classList.contains("dragging")) index += 1;
  }
  return index;
}

function removeFromList(projectId, status, taskId) {
  const list = state.lists[projectId]?.[status];
  if (!list) return;

  const idx = list.indexOf(taskId);
  if (idx >= 0) list.splice(idx, 1);
}

function focusPendingTaskInput() {
  if (!pendingFocusTaskId) return;

  const input = els.board.querySelector(`.task[data-id="${pendingFocusTaskId}"] .task-text`);
  if (!input) return;

  input.focus();
  pendingFocusTaskId = null;
}

function clearDragState() {
  dragTaskId = null;
  dragProjectId = null;

  document.body.classList.remove("is-dragging");
  els.projectTrash.classList.remove("over");
  document.querySelectorAll(".dropzone.over").forEach((z) => z.classList.remove("over"));
  document.querySelectorAll(".project.dragging").forEach((p) => p.classList.remove("dragging"));
  document.querySelectorAll(".task.dragging").forEach((t) => t.classList.remove("dragging"));
  if (projectPlaceholder) projectPlaceholder.remove();
  if (taskPlaceholder) taskPlaceholder.remove();
  closeEmojiMenu();
}

function currentNow() {
  return Date.now();
}

function renderTopStats() {
  const report = buildReportData();
  const total = report.total || 1;
  const donePct = (report.done / total) * 100;
  const todoPct = (report.todo / total) * 100;
  const red = getComputedStyle(document.documentElement).getPropertyValue("--high").trim() || "#ff5d7d";
  const green = getComputedStyle(document.documentElement).getPropertyValue("--low-pie").trim() || "#36a879";
  const todoEnd = todoPct.toFixed(2);
  const doneEnd = (todoPct + donePct).toFixed(2);
  els.globalPie.style.background = `radial-gradient(circle at 28% 22%, rgba(255,255,255,0.26), rgba(255,255,255,0) 46%), conic-gradient(from -90deg, ${red} 0 ${todoEnd}%, ${green} ${todoEnd}% ${doneEnd}%, rgba(255,255,255,0.14) ${doneEnd}% 100%)`;
  els.globalStatsText.textContent = `${report.done}/${report.total} done • ${(report.completionRate * 100).toFixed(1)}% • ${report.doneLast7d} done in 7d`;
}

function paintProjectPie(el, projectId) {
  if (!el) return;
  const stats = getProjectSliceCounts(projectId);
  const total = Math.max(1, stats.done + stats.high + stats.mid + stats.low);
  const highPct = (stats.high / total) * 100;
  const midPct = (stats.mid / total) * 100;
  const lowPct = (stats.low / total) * 100;
  const donePct = (stats.done / total) * 100;

  const high = highPct;
  const mid = high + midPct;
  const low = mid + lowPct;
  const done = low + donePct;

  el.style.background = `radial-gradient(circle at 28% 22%, rgba(255,255,255,0.24), rgba(255,255,255,0) 48%), conic-gradient(from -90deg, var(--high) 0 ${high.toFixed(2)}%, var(--mid) ${high.toFixed(2)}% ${mid.toFixed(2)}%, var(--low-pie) ${mid.toFixed(2)}% ${low.toFixed(2)}%, var(--done) ${low.toFixed(2)}% ${done.toFixed(2)}%, rgba(255,255,255,0.1) ${done.toFixed(2)}% 100%)`;
}

function getProjectSliceCounts(projectId) {
  const todoIds = state.lists[projectId]?.todo || [];
  const doneIds = state.lists[projectId]?.done || [];
  const totalTodo = todoIds.length || 1;
  let high = 0;
  let mid = 0;
  let low = 0;

  todoIds.forEach((id, index) => {
    const seg = segmentForIndex(index, totalTodo);
    if (seg === "high") high += 1;
    else if (seg === "mid") mid += 1;
    else low += 1;
  });

  return { done: doneIds.length, high, mid, low };
}

function finishProjectTitleEdit(projectId, wrap, titleEl, inputEl) {
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  const name = inputEl.value.trim();
  if (!name) {
    inputEl.value = project.name;
    wrap.classList.remove("editing");
    return;
  }

  const dupe = state.projects.find((p) => p.id !== projectId && p.name.toLowerCase() === name.toLowerCase());
  if (dupe) {
    inputEl.value = project.name;
    wrap.classList.remove("editing");
    return;
  }

  project.name = name;
  titleEl.textContent = name;
  wrap.classList.remove("editing");
  saveState();
}

function applyTaskAgeVisual(node, task, segment) {
  if (task.status === "done") return;
  const ageDays = Math.floor((currentNow() - (task.createdAt || currentNow())) / DAY_MS);
  if (ageDays < 3) return;

  node.classList.add("flash-once");
  if (segment === "mid" && ageDays >= 7) {
    node.classList.add("age-alert-soft");
    return;
  }
  if (ageDays >= 3) {
    node.classList.add("age-alert-hard");
  }
}

function wireBoardScrollSync() {
  let syncingFromBoard = false;
  let syncingFromTop = false;

  els.board.addEventListener("scroll", () => {
    if (syncingFromTop) return;
    syncingFromBoard = true;
    els.boardTopScroll.scrollLeft = els.board.scrollLeft;
    syncingFromBoard = false;
  });

  els.boardTopScroll.addEventListener("scroll", () => {
    if (syncingFromBoard) return;
    syncingFromTop = true;
    els.board.scrollLeft = els.boardTopScroll.scrollLeft;
    syncingFromTop = false;
  });

  window.addEventListener("resize", syncTopScrollSize);
}

function syncTopScrollSize() {
  const width = els.board.scrollWidth;
  els.boardTopScrollInner.style.width = `${Math.max(width, 1)}px`;
  const overflow = hasHorizontalOverflow(els.board);
  els.boardTopScroll.hidden = !overflow;
  els.boardTopScroll.scrollLeft = els.board.scrollLeft;
}

function onGlobalWheel(event) {
  if (!hasHorizontalOverflow(els.board)) return;
  if (event.target.closest(".emoji-menu")) return;

  // Only react to true horizontal intent to avoid vertical-scroll jitter.
  const delta = event.deltaX;
  if (Math.abs(delta) < 0.2) return;

  const before = els.board.scrollLeft;
  els.board.scrollLeft += delta;
  if (els.board.scrollLeft !== before) {
    event.preventDefault();
  }
}

function hasHorizontalOverflow(element) {
  return element.scrollWidth > element.clientWidth + 1;
}

function startResize(event, projectId, projectNode) {
  event.preventDefault();
  event.stopPropagation();

  const project = state.projects.find((p) => p.id === projectId);
  if (!project) return;

  const startWidthPx = projectNode.getBoundingClientRect().width;
  const direction = event.currentTarget.classList.contains("left") ? -1 : 1;

  resizeState = {
    projectId,
    projectNode,
    startX: event.clientX,
    startWidthPx,
    direction
  };

  projectNode.classList.add("resizing");
  projectNode.draggable = false;

  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", endResize, { once: true });
}

function onResizeMove(event) {
  if (!resizeState) return;

  const deltaX = (event.clientX - resizeState.startX) * resizeState.direction;
  const nextWidthPx = Math.max(260, Math.min(720, resizeState.startWidthPx + deltaX));
  const nextScale = clampProjectWidth(nextWidthPx / 360);

  const project = state.projects.find((p) => p.id === resizeState.projectId);
  if (!project) return;
  project.width = nextScale;

  resizeState.projectNode.style.setProperty("--project-width", String(nextScale));
}

function endResize() {
  if (!resizeState) return;

  resizeState.projectNode.classList.remove("resizing");
  resizeState.projectNode.draggable = true;
  resizeState = null;

  window.removeEventListener("pointermove", onResizeMove);
  saveState();
}

function clampProjectWidth(value) {
  const rounded = Math.round(value * 100) / 100;
  return Math.max(0.72, Math.min(1.9, rounded));
}

function launchConfetti(anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const count = 18;
  const colors = ["#ff5d7d", "#ffbe55", "#43d29c", "#72a8ff", "#ffffff"];

  for (let i = 0; i < count; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${x}px`;
    piece.style.top = `${y}px`;
    piece.style.background = colors[i % colors.length];
    piece.style.setProperty("--dx", `${(Math.random() - 0.5) * 160}px`);
    piece.style.setProperty("--dy", `${-30 - Math.random() * 120}px`);
    piece.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    document.body.append(piece);
    setTimeout(() => piece.remove(), 760);
  }
}

function projectColor(projectId) {
  const hue = hashString(projectId) % 360;
  return `hsl(${hue} 40% 20%)`;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toggleEmojiMenu(anchorBtn, textarea, taskBody, previewEl, tagsEl, taskId) {
  if (openEmojiMenu?.anchor === anchorBtn) {
    closeEmojiMenu();
    return;
  }

  closeEmojiMenu();

  const menu = document.createElement("div");
  menu.className = "emoji-menu";

  QUICK_EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      addTaskEmoji(taskId, emoji);
      autoSizeTextarea(textarea);
      renderMarkdownPreview(previewEl, taskId, textarea);
      renderTaskTags(tagsEl, taskId);
      saveState();
      taskBody.classList.add("editing");
      textarea.focus();
      closeEmojiMenu();
    });
    menu.append(btn);
  });

  document.body.append(menu);
  positionEmojiMenu(anchorBtn, menu);

  openEmojiMenu = { menu, anchor: anchorBtn };

  setTimeout(() => {
    window.addEventListener("resize", onGlobalPointerOrResize);
    document.addEventListener("pointerdown", onGlobalPointerOrResize);
    document.addEventListener("keydown", onEscapeCloseEmoji);
  }, 0);
}

function positionEmojiMenu(anchorBtn, menu) {
  const rect = anchorBtn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - menuRect.width / 2;
  let top = rect.bottom + 6;

  left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, left));
  if (top + menuRect.height > window.innerHeight - 8) {
    top = rect.top - menuRect.height - 6;
  }
  top = Math.max(8, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function onGlobalPointerOrResize(event) {
  if (!openEmojiMenu) return;

  if (event?.type === "pointerdown") {
    const target = event.target;
    if (openEmojiMenu.menu.contains(target) || openEmojiMenu.anchor.contains(target)) return;
  }

  closeEmojiMenu();
}

function onEscapeCloseEmoji(event) {
  if (event.key === "Escape") closeEmojiMenu();
}

function closeEmojiMenu() {
  if (!openEmojiMenu) return;
  openEmojiMenu.menu.remove();
  openEmojiMenu = null;
  window.removeEventListener("resize", onGlobalPointerOrResize);
  document.removeEventListener("pointerdown", onGlobalPointerOrResize);
  document.removeEventListener("keydown", onEscapeCloseEmoji);
}

function renderTaskTags(container, taskId) {
  container.innerHTML = "";
  const task = state.tasks[taskId];
  if (!task || !Array.isArray(task.emojis)) return;

  for (const emoji of task.emojis) {
    const chip = document.createElement("span");
    chip.className = "task-tag";
    chip.textContent = emoji;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      removeTaskEmoji(taskId, emoji);
      renderTaskTags(container, taskId);
      saveState();
    });

    chip.append(remove);
    container.append(chip);
  }
}

function addTaskEmoji(taskId, emoji) {
  const task = state.tasks[taskId];
  if (!task) return;
  if (!Array.isArray(task.emojis)) task.emojis = [];
  task.emojis.push(emoji);
  task.updatedAt = currentNow();
}

function removeTaskEmoji(taskId, emoji) {
  const task = state.tasks[taskId];
  if (!task || !Array.isArray(task.emojis)) return;
  const idx = task.emojis.indexOf(emoji);
  if (idx >= 0) task.emojis.splice(idx, 1);
  task.updatedAt = currentNow();
}

function normalizeTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function exportSummary() {
  const choice = (prompt("Export type: pdf or sheet", "pdf") || "").trim().toLowerCase();
  if (!choice) return;
  if (choice === "pdf") return exportPdfSummary();
  if (choice === "sheet") return exportSheetSummary();
  alert("Use 'pdf' or 'sheet'.");
}

function exportPdfSummary() {
  const report = buildReportData();
  const win = window.open("", "_blank");
  if (!win) return;

  win.document.write(`
    <html><head><title>Task Summary</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        .muted { color: #666; margin-bottom: 16px; }
        .cards { display: grid; grid-template-columns: repeat(6, minmax(110px, 1fr)); gap: 8px; }
        .card { border: 1px solid #ccc; border-radius: 8px; padding: 8px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { border: 1px solid #ccc; padding: 6px; font-size: 12px; text-align: left; }
      </style>
    </head><body>
      <h1>Task Summary</h1>
      <div class="muted">Generated ${new Date(report.generatedAt).toLocaleString()}</div>
      <div class="cards">
        <div class="card"><b>Total</b><div>${report.total}</div></div>
        <div class="card"><b>Done</b><div>${report.done}</div></div>
        <div class="card"><b>To Do</b><div>${report.todo}</div></div>
        <div class="card"><b>Done 7d</b><div>${report.doneLast7d}</div></div>
        <div class="card"><b>Done/day</b><div>${report.donePerDay7d.toFixed(2)}</div></div>
        <div class="card"><b>Rate</b><div>${(report.completionRate * 100).toFixed(1)}%</div></div>
      </div>
      <h2>By Project</h2>
      <table><thead><tr><th>Project</th><th>To Do</th><th>Done</th><th>Total</th></tr></thead>
      <tbody>${report.projects.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${p.todo}</td><td>${p.done}</td><td>${p.total}</td></tr>`).join("")}</tbody></table>
      <h2>Tasks</h2>
      <table><thead><tr><th>Project</th><th>Status</th><th>Task</th><th>Tags</th><th>Created</th><th>Updated</th><th>Completed</th></tr></thead>
      <tbody>${report.tasks.map((t) => `<tr><td>${escapeHtml(t.project)}</td><td>${t.status}</td><td>${escapeHtml(t.text)}</td><td>${escapeHtml(t.tags)}</td><td>${fmtTs(t.createdAt)}</td><td>${fmtTs(t.updatedAt)}</td><td>${fmtTs(t.completedAt)}</td></tr>`).join("")}</tbody></table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function exportSheetSummary() {
  const report = buildReportData();
  const rows = [];
  rows.push(["Generated", new Date(report.generatedAt).toISOString()]);
  rows.push(["Total", report.total], ["Done", report.done], ["To Do", report.todo], ["Done Last 7d", report.doneLast7d], ["Done per Day 7d", report.donePerDay7d.toFixed(2)], ["Completion Rate", `${(report.completionRate * 100).toFixed(1)}%`], []);
  rows.push(["Project", "To Do", "Done", "Total"]);
  report.projects.forEach((p) => rows.push([p.name, p.todo, p.done, p.total]));
  rows.push([]);
  rows.push(["Project", "Status", "Task", "Tags", "Created", "Updated", "Completed"]);
  report.tasks.forEach((t) => rows.push([t.project, t.status, t.text, t.tags, isoTs(t.createdAt), isoTs(t.updatedAt), isoTs(t.completedAt)]));

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `task-summary-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSheetSummary() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,.tsv,text/csv,text/tab-separated-values";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const result = importRowsIntoBoard(text);
        if (!result.imported) {
          alert("No tasks found to import.");
          return;
        }
        saveState();
        render();
        alert(`Imported ${result.imported} task${result.imported === 1 ? "" : "s"} across ${result.projects} project${result.projects === 1 ? "" : "s"}.`);
      } catch {
        alert("Could not import this sheet.");
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function importRowsIntoBoard(raw) {
  const rows = parseSheetRows(raw);
  if (!rows.length) return { imported: 0, projects: 0 };

  const normalized = rows.map((row) => row.map((cell) => (cell || "").trim()));
  const parsed = extractImportedTaskRows(normalized);
  if (!parsed.rows.length) return { imported: 0, projects: 0 };

  const projectByName = new Map(
    state.projects.map((p) => [p.name.trim().toLowerCase(), p])
  );

  let imported = 0;
  const touchedProjects = new Set();

  for (const row of parsed.rows) {
    const taskText = row.task?.trim() || "";
    if (!taskText) continue;

    const projectName = (row.project?.trim() || "General");
    const projectKey = projectName.toLowerCase();
    let project = projectByName.get(projectKey);
    if (!project) {
      const id = makeId();
      project = { id, name: projectName, view: "todo", width: 1 };
      state.projects.push(project);
      state.lists[id] = { todo: [], done: [] };
      projectByName.set(projectKey, project);
    }

    const status = normalizeImportedStatus(row.status);
    const createdAt = parseImportedTimestamp(row.created) ?? currentNow();
    const updatedAt = parseImportedTimestamp(row.updated) ?? createdAt;
    const completedAt = status === "done" ? (parseImportedTimestamp(row.completed) ?? updatedAt) : null;

    const id = makeId();
    state.tasks[id] = {
      id,
      text: taskText,
      projectId: project.id,
      status,
      emojis: parseImportedTags(row.tags),
      createdAt,
      updatedAt,
      completedAt
    };

    state.lists[project.id][status].push(id);
    touchedProjects.add(project.id);
    imported += 1;
  }

  return { imported, projects: touchedProjects.size };
}

function parseSheetRows(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) return [];
  if (text.includes(",") || text.includes("\"")) return parseCsvRows(text);
  return text.split("\n").map((line) => line.split("\t"));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          value += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      value += ch;
      i += 1;
      continue;
    }

    if (ch === "\"") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(value);
      value = "";
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      i += 1;
      continue;
    }

    value += ch;
    i += 1;
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function extractImportedTaskRows(rows) {
  const headerIndex = findTaskHeaderRow(rows);
  if (headerIndex >= 0) {
    const map = mapHeaderIndices(rows[headerIndex]);
    const out = [];
    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      const rec = mapImportedRow(rows[i], map);
      if (!rec.task) continue;
      out.push(rec);
    }
    return { rows: out };
  }

  const guess = [];
  for (const raw of rows) {
    if (!raw.some((v) => v && v.trim())) continue;
    const task = raw[0]?.trim() || "";
    if (!task) continue;
    guess.push({
      task,
      project: raw[1]?.trim() || "General",
      status: raw[2]?.trim() || "todo",
      tags: raw[3]?.trim() || "",
      created: raw[4]?.trim() || "",
      updated: raw[5]?.trim() || "",
      completed: raw[6]?.trim() || ""
    });
  }
  return { rows: guess };
}

function findTaskHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const map = mapHeaderIndices(rows[i]);
    if (map.task >= 0) return i;
  }
  return -1;
}

function mapHeaderIndices(headerRow) {
  const headers = headerRow.map((h) => String(h || "").trim().toLowerCase());
  const byAny = (terms) => headers.findIndex((h) => terms.some((t) => h === t || h.includes(t)));
  return {
    project: byAny(["project", "board", "list"]),
    status: byAny(["status", "state"]),
    task: byAny(["task", "title", "item", "description", "text"]),
    tags: byAny(["tags", "tag", "emoji", "emojis", "labels"]),
    created: byAny(["created", "created at", "added"]),
    updated: byAny(["updated", "updated at", "modified"]),
    completed: byAny(["completed", "closed", "done at", "finished"])
  };
}

function mapImportedRow(row, map) {
  const at = (idx) => (idx >= 0 ? row[idx] : "");
  return {
    project: String(at(map.project) || ""),
    status: String(at(map.status) || ""),
    task: String(at(map.task) || ""),
    tags: String(at(map.tags) || ""),
    created: String(at(map.created) || ""),
    updated: String(at(map.updated) || ""),
    completed: String(at(map.completed) || "")
  };
}

function normalizeImportedStatus(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "todo";
  if (text === "done" || text === "completed" || text === "closed" || text === "complete") return "done";
  if (text === "todo" || text === "to do" || text === "open" || text === "active") return "todo";
  if (text === "1" || text === "true" || text === "yes") return "done";
  return "todo";
}

function parseImportedTags(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function parseImportedTimestamp(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const ts = Date.parse(text);
  return Number.isFinite(ts) ? ts : null;
}

function buildReportData() {
  const now = currentNow();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const all = Object.values(state.tasks);
  const done = all.filter((t) => t.status === "done").length;
  const todo = all.length - done;
  const doneLast7d = all.filter((t) => t.completedAt && t.completedAt >= sevenDaysAgo).length;

  return {
    generatedAt: now,
    total: all.length,
    done,
    todo,
    doneLast7d,
    donePerDay7d: doneLast7d / 7,
    completionRate: all.length ? done / all.length : 0,
    projects: state.projects.map((p) => {
      const pTodo = state.lists[p.id]?.todo?.length || 0;
      const pDone = state.lists[p.id]?.done?.length || 0;
      return { name: p.name, todo: pTodo, done: pDone, total: pTodo + pDone };
    }),
    tasks: state.projects.flatMap((p) => {
      const ids = [...(state.lists[p.id]?.todo || []), ...(state.lists[p.id]?.done || [])];
      return ids
        .map((id) => state.tasks[id])
        .filter(Boolean)
        .map((t) => ({
          project: p.name,
          status: t.status,
          text: t.text || "",
          tags: (t.emojis || []).join(" "),
          createdAt: t.createdAt || null,
          updatedAt: t.updatedAt || null,
          completedAt: t.completedAt || null
        }));
    })
  };
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (!/[\",\n]/.test(text)) return text;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function fmtTs(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

function isoTs(ts) {
  if (!ts) return "";
  return new Date(ts).toISOString();
}

function formatTaskCreated(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
