const STORAGE_KEY = "time-options-v1";
const IMAGE_DB_NAME = "time-options-images";
const IMAGE_STORE = "images";
const IMAGE_LIMIT = 4 * 1024 * 1024;
const defaults = [
  { title: "Summa Theologica", minutes: 15, energy: "gentle", prompt: "Read a little of the Summa Theologica.", tags: ["reading", "study"] },
  { title: "Write an essay", minutes: 15, energy: "focused", choices: ["DSW", "AQ"], tags: ["writing", "study"] },
  { title: "Anki cards", minutes: 5, energy: "focused", prompt: "Review a few cards.", tags: ["study"] },
  { title: "Favorite books", minutes: 15, energy: "gentle", choices: ["Current book", "A favorite to revisit"], tags: ["reading", "leisure"] },
  { title: "Take a walk", minutes: 15, energy: "gentle", tags: ["movement", "leisure"] },
  { title: "Rest", minutes: 5, energy: "gentle", tags: ["rest", "leisure"] }
];

const $ = selector => document.querySelector(selector);
const grid = $("#activity-grid");
const homeView = $("#home-view");
const guideView = $("#guide-view");
const dialog = $("#options-dialog");
const optionsList = $("#options-list");
const form = $("#activity-form");
const formHeading = $("#form-heading");
const formIndex = $("#activity-index");
const formTitle = $("#form-title");
const formIcon = $("#form-icon");
const formPrompt = $("#form-prompt");
const formMinutes = $("#form-minutes");
const formTags = $("#form-tags");
const formEnergy = $("#form-energy");
const formUrl = $("#form-url");
const formImageUrl = $("#form-image-url");
const formImageFile = $("#form-image-file");
const formChoices = $("#form-choices");
const imagePreview = $("#image-preview");
const pictureName = $("#picture-name");
const removePictureButton = $("#remove-picture");
const cancelEdit = $("#cancel-edit");
const status = $("#status");
const timeButtons = [...document.querySelectorAll(".time-option[data-minutes]")];
let activities = loadActivities();
let selectedMinutes = 15;
let gentleOnly = false;
let selectedTags = new Set();
let tagMatch = "OR";
let currentActivity;
let currentChoice;
let statusTimeout;
let currentImageId = "";
let previewObjectUrl = "";
const tileObjectUrls = new Set();
let imageDatabase;

function makeId() {
  return crypto.randomUUID?.() || `option-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidUrl(value) {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateActivities(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid options file.");
  const validated = value.map(item => {
    if (!item || typeof item !== "object" || typeof item.title !== "string" ||
        !item.title.trim() || item.title.length > 80) {
      throw new Error("Each option needs a name of 1–80 characters.");
    }
    const minutes = Number(item.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error(`Invalid time for “${item.title}”.`);
    }
    if (item.energy !== undefined && !["any", "gentle", "focused"].includes(item.energy)) {
      throw new Error(`Invalid energy for “${item.title}”.`);
    }
    for (const [key, label] of [["prompt", "note"], ["url", "link"], ["imageUrl", "picture URL"]]) {
      if (item[key] !== undefined && typeof item[key] !== "string") {
        throw new Error(`Invalid ${label} for “${item.title}”.`);
      }
    }
    const prompt = (item.prompt || "").trim();
    const url = (item.url || "").trim();
    const imageUrl = (item.imageUrl || "").trim();
    if (prompt.length > 180) throw new Error(`The note for “${item.title}” is too long.`);
    if (!isValidUrl(url)) throw new Error(`The link for “${item.title}” must start with http:// or https://.`);
    if (!isValidUrl(imageUrl)) throw new Error(`The picture URL for “${item.title}” must start with http:// or https://.`);
    if (item.choices !== undefined && (!Array.isArray(item.choices) ||
        item.choices.length > 50 ||
        item.choices.some(choice => typeof choice !== "string" || !choice.trim() || choice.length > 80))) {
      throw new Error(`Invalid choices for “${item.title}”.`);
    }
    if (item.tags !== undefined && (!Array.isArray(item.tags) ||
        item.tags.length > 30 ||
        item.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.length > 30))) {
      throw new Error(`Invalid tags for “${item.title}”.`);
    }
    if (item.imageId !== undefined && typeof item.imageId !== "string") {
      throw new Error(`Invalid uploaded picture for “${item.title}”.`);
    }
    if (item.icon !== undefined && (typeof item.icon !== "string" || item.icon.length > 8)) {
      throw new Error(`Invalid icon for “${item.title}”.`);
    }
    return {
      id: typeof item.id === "string" && item.id ? item.id : makeId(),
      title: item.title.trim(),
      icon: item.icon || "",
      minutes,
      energy: item.energy || "any",
      prompt,
      url,
      choices: (item.choices || []).map(choice => choice.trim()),
      tags: [...new Set((item.tags || []).map(tag => tag.trim()).filter(Boolean))],
      imageUrl,
      imageId: item.imageId || ""
    };
  });
  if (new Set(validated.map(item => item.id)).size !== validated.length) {
    throw new Error("Each option must have a unique ID.");
  }
  return validated;
}

function loadActivities() {
  let stored;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return validateActivities(defaults);
  } catch (error) {
    window.setTimeout(() => showStatus(`Could not load saved options: ${error.message}`), 0);
    return validateActivities(defaults);
  }
  let parsed;
  let validated;
  try {
    parsed = JSON.parse(stored);
    validated = validateActivities(parsed);
  } catch (error) {
    window.setTimeout(() => showStatus(`Could not load saved options: ${error.message}`), 0);
    return validateActivities(defaults);
  }
  if (JSON.stringify(parsed) !== JSON.stringify(validated)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
    } catch (error) {
      window.setTimeout(() => showStatus(`Could not update saved options: ${error.message}`), 0);
    }
  }
  return validated;
}

function openImageDatabase() {
  if (imageDatabase) return imageDatabase;
  imageDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open picture storage."));
  });
  return imageDatabase;
}

async function imageRequest(mode, operation) {
  const db = await openImageDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGE_STORE, mode);
    const request = operation(transaction.objectStore(IMAGE_STORE));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Could not access picture storage."));
    transaction.onabort = () => reject(transaction.error || new Error("Picture storage failed."));
    transaction.oncomplete = () => resolve(result);
  });
}

const getImage = id => imageRequest("readonly", store => store.get(id));
const putImage = (id, blob) => imageRequest("readwrite", store => store.put(blob, id));
const deleteImage = id => imageRequest("readwrite", store => store.delete(id));

async function saveActivities(next, imageBlobs = new Map()) {
  const valid = validateActivities(next);
  for (const [id, blob] of imageBlobs) await putImage(id, blob);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
  const retainedImages = new Set(valid.map(item => item.imageId).filter(Boolean));
  const removedImages = activities.map(item => item.imageId).filter(id => id && !retainedImages.has(id));
  activities = valid;
  renderTiles();
  renderOptionsList();
  renderTagFilters();
  refreshSuggestion();
  for (const id of removedImages) {
    try {
      await deleteImage(id);
    } catch (error) {
      showStatus(`Options saved, but an old picture could not be removed: ${error.message}`);
    }
  }
}

function showStatus(message) {
  window.clearTimeout(statusTimeout);
  status.textContent = message;
  status.classList.add("visible");
  statusTimeout = window.setTimeout(() => status.classList.remove("visible"), 3500);
}

function disposeTileUrls() {
  for (const url of tileObjectUrls) URL.revokeObjectURL(url);
  tileObjectUrls.clear();
}

async function addTileImage(tile, activity) {
  let source = activity.imageUrl;
  if (activity.imageId) {
    try {
      const blob = await getImage(activity.imageId);
      if (blob && tile.isConnected) {
        source = URL.createObjectURL(blob);
        tileObjectUrls.add(source);
      }
    } catch (error) {
      showStatus(`Could not load picture: ${error.message}`);
    }
  }
  if (!source || !tile.isConnected) return;
  const image = document.createElement("img");
  image.className = "tile-image";
  image.alt = "";
  image.src = source;
  const shade = document.createElement("span");
  shade.className = "tile-shade";
  shade.setAttribute("aria-hidden", "true");
  image.onerror = () => {
    image.remove();
    shade.remove();
    tile.classList.remove("has-image");
  };
  tile.classList.add("has-image");
  tile.prepend(image, shade);
}

function renderTiles() {
  disposeTileUrls();
  grid.replaceChildren();
  if (!activities.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No options";
    grid.append(empty);
    return;
  }
  activities.forEach(activity => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "activity-tile";
    tile.setAttribute("aria-label", `${activity.title}${activity.url ? ", opens a link" : ""}, ${activity.minutes} min`);
    const name = document.createElement("span");
    name.className = "tile-title";
    name.append(document.createTextNode(activity.title));
    if (activity.url) {
      const linkIcon = document.createElement("span");
      linkIcon.className = "tile-link";
      linkIcon.setAttribute("aria-label", "link");
      linkIcon.textContent = "🔗";
      name.append(linkIcon);
    }
    const minutes = document.createElement("span");
    minutes.className = "tile-minutes";
    minutes.textContent = `${activity.minutes} min`;
    if (activity.icon) {
      const tileIcon = document.createElement("span");
      tileIcon.className = "tile-icon";
      tileIcon.setAttribute("aria-hidden", "true");
      tileIcon.textContent = activity.icon;
      tile.append(tileIcon);
    }
    tile.append(name, minutes);
    tile.addEventListener("click", () => startActivity(activity, chooseChoice(activity)));
    grid.append(tile);
    addTileImage(tile, activity);
  });
}

function renderOptionsList() {
  optionsList.replaceChildren();
  activities.forEach((activity, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    const name = document.createElement("span");
    name.className = "option-name";
    name.textContent = `${activity.title}${activity.url ? " 🔗" : ""}`;
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => editActivity(index));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", `Delete ${activity.title}`);
    remove.addEventListener("click", () => deleteActivity(index));
    row.append(name, edit, remove);
    optionsList.append(row);
  });
}

function renderTagFilters() {
  const tagFilter = $("#tag-filter");
  const tagOptions = $("#tag-options");
  const tags = [...new Set(activities.flatMap(activity => activity.tags))].sort((a, b) => a.localeCompare(b));
  selectedTags = new Set([...selectedTags].filter(tag => tags.includes(tag)));
  tagOptions.replaceChildren();
  tags.forEach(tag => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tag-chip";
    button.textContent = tag;
    button.setAttribute("aria-pressed", String(selectedTags.has(tag)));
    button.addEventListener("click", () => {
      if (selectedTags.has(tag)) selectedTags.delete(tag);
      else selectedTags.add(tag);
      renderTagFilters();
      refreshSuggestion();
    });
    tagOptions.append(button);
  });
  tagFilter.hidden = tags.length === 0;
  $("#tag-match").hidden = selectedTags.size < 2;
}

function chooseChoice(activity) {
  const choiceName = activity.choices.length
    ? activity.choices[Math.floor(Math.random() * activity.choices.length)]
    : "";
  return { title: choiceName || activity.title, prompt: activity.prompt, url: activity.url };
}

function startActivity(activity, choice) {
  currentActivity = activity;
  currentChoice = choice;
  if (choice.url) window.open(choice.url, "_blank", "noopener,noreferrer");
  showStatus(choice.prompt || choice.title);
}

function getEligibleActivities() {
  return activities.filter(activity => {
    if (activity.minutes > selectedMinutes) return false;
    if (gentleOnly && !["gentle", "any"].includes(activity.energy)) return false;
    if (!selectedTags.size) return true;
    const matches = [...selectedTags].filter(tag => activity.tags.includes(tag)).length;
    return tagMatch === "AND" ? matches === selectedTags.size : matches > 0;
  });
}

function showSuggestionImage(activity) {
  const container = $("#suggestion-image");
  const oldObjectUrl = container.dataset.objectUrl;
  if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);
  delete container.dataset.objectUrl;
  container.replaceChildren();
  container.hidden = true;
  if (!activity.imageUrl && activity.imageId) {
    getImage(activity.imageId).then(blob => {
      if (!blob || currentActivity !== activity) return;
      const url = URL.createObjectURL(blob);
      container.dataset.objectUrl = url;
      displaySuggestionImage(container, url);
    }).catch(error => showStatus(`Could not load picture: ${error.message}`));
    return;
  }
  if (activity.imageUrl) displaySuggestionImage(container, activity.imageUrl);
}

function displaySuggestionImage(container, source) {
  const image = document.createElement("img");
  image.alt = "";
  image.src = source;
  image.onerror = () => {
    if (container.dataset.objectUrl === source) URL.revokeObjectURL(source);
    delete container.dataset.objectUrl;
    container.replaceChildren();
    container.hidden = true;
  };
  container.replaceChildren(image);
  container.hidden = false;
}

function clearSuggestionImage() {
  const container = $("#suggestion-image");
  if (container.dataset.objectUrl) URL.revokeObjectURL(container.dataset.objectUrl);
  delete container.dataset.objectUrl;
  container.replaceChildren();
  container.hidden = true;
}

function refreshSuggestion() {
  clearSuggestionImage();
  const eligible = getEligibleActivities();
  const alternatives = eligible.filter(activity => activity !== currentActivity);
  const pool = alternatives.length ? alternatives : eligible;
  const title = $("#activity-title");
  const prompt = $("#activity-prompt");
  const time = $("#activity-time");
  const begin = $("#begin-button");
  if (!pool.length) {
    currentActivity = undefined;
    currentChoice = undefined;
    title.textContent = "No matching options";
    prompt.textContent = "";
    time.textContent = "";
    begin.disabled = true;
    return;
  }
  currentActivity = pool[Math.floor(Math.random() * pool.length)];
  currentChoice = chooseChoice(currentActivity);
  title.replaceChildren(document.createTextNode(currentChoice.title));
  if (currentChoice.url) {
    const linkIcon = document.createElement("span");
    linkIcon.setAttribute("aria-label", "link");
    linkIcon.textContent = " 🔗";
    title.append(linkIcon);
  }
  prompt.textContent = currentChoice.prompt || "";
  time.textContent = `${currentActivity.minutes} min`;
  begin.disabled = false;
  showSuggestionImage(currentActivity);
}

function setPicturePreview(source, name = "") {
  if (previewObjectUrl && previewObjectUrl !== source) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = source?.startsWith("blob:") ? source : "";
  imagePreview.hidden = !source;
  if (source) imagePreview.src = source;
  else imagePreview.removeAttribute("src");
  pictureName.textContent = name || (source ? "Picture selected" : "No picture chosen");
  removePictureButton.hidden = !source && !formImageUrl.value;
}

function resetForm() {
  form.reset();
  formIndex.value = "";
  formMinutes.value = "15";
  formHeading.textContent = "Add option";
  currentImageId = "";
  setPicturePreview("");
  cancelEdit.hidden = true;
}

async function editActivity(index) {
  const activity = activities[index];
  formIndex.value = String(index);
  formTitle.value = activity.title;
  formIcon.value = activity.icon;
  formPrompt.value = activity.prompt;
  formMinutes.value = String(activity.minutes);
  formEnergy.value = activity.energy;
  formTags.value = activity.tags.join(", ");
  formUrl.value = activity.url;
  formImageUrl.value = activity.imageUrl;
  formChoices.value = activity.choices.join("\n");
  currentImageId = activity.imageId;
  formHeading.textContent = "Edit option";
  cancelEdit.hidden = false;
  let blob = null;
  if (activity.imageId) {
    try {
      blob = await getImage(activity.imageId);
    } catch (error) {
      showStatus(`Could not load picture: ${error.message}`);
    }
  }
  if (blob) {
    setPicturePreview(URL.createObjectURL(blob), "Stored picture");
  } else {
    setPicturePreview(activity.imageUrl, activity.imageUrl ? "Picture URL" : "");
  }
  formTitle.focus();
}

async function deleteActivity(index) {
  if (!window.confirm(`Delete “${activities[index].title}”?`)) return;
  try {
    await saveActivities(activities.filter((_, currentIndex) => currentIndex !== index));
    resetForm();
    showStatus("Deleted");
  } catch (error) {
    showStatus(`Could not save: ${error.message}`);
  }
}

$("#edit-options").addEventListener("click", () => {
  resetForm();
  renderOptionsList();
  dialog.showModal();
  formTitle.focus();
});
$("#close-dialog").addEventListener("click", () => dialog.close());
cancelEdit.addEventListener("click", resetForm);
dialog.addEventListener("close", resetForm);

formImageFile.addEventListener("change", () => {
  const file = formImageFile.files[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(file.type) || file.size > IMAGE_LIMIT) {
    formImageFile.value = "";
    showStatus("Choose a PNG, JPEG, WebP, GIF or AVIF under 4 MB.");
    return;
  }
  formImageUrl.value = "";
  previewObjectUrl = URL.createObjectURL(file);
  setPicturePreview(previewObjectUrl, file.name);
});
formImageUrl.addEventListener("input", () => {
  if (formImageFile.files[0]) return;
  setPicturePreview(formImageUrl.value.trim());
});
removePictureButton.addEventListener("click", () => {
  formImageFile.value = "";
  formImageUrl.value = "";
  currentImageId = "";
  setPicturePreview("");
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  const index = formIndex.value === "" ? -1 : Number(formIndex.value);
  const id = index < 0 ? makeId() : activities[index].id;
  const file = formImageFile.files[0];
  const activity = {
    id,
    title: formTitle.value.trim(),
    icon: formIcon.value.trim(),
    prompt: formPrompt.value.trim(),
    minutes: Number(formMinutes.value),
    energy: formEnergy.value,
    url: formUrl.value.trim(),
    imageUrl: formImageUrl.value.trim(),
    imageId: file || currentImageId ? id : "",
    choices: formChoices.value.split("\n").map(choice => choice.trim()).filter(Boolean),
    tags: formTags.value.split(",").map(tag => tag.trim()).filter(Boolean)
  };
  const next = [...activities];
  if (index < 0) next.push(activity);
  else next[index] = activity;
  try {
    const images = new Map();
    if (file) images.set(id, file);
    await saveActivities(next, images);
    resetForm();
    showStatus("Saved");
  } catch (error) {
    showStatus(`Could not save: ${error.message}`);
  }
});

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function dataUrlToBlob(value) {
  const match = /^data:image\/(png|jpeg|webp|gif|avif);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new Error("The backup contains an unsupported picture.");
  const binary = atob(match[2]);
  if (binary.length > IMAGE_LIMIT) throw new Error("A backup picture exceeds 4 MB.");
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Blob([bytes], { type: `image/${match[1]}` });
}

$("#backup-options").addEventListener("click", async () => {
  try {
    const backupActivities = [];
    for (const activity of activities) {
      const backupItem = { ...activity };
      if (activity.imageId) {
        const blob = await getImage(activity.imageId);
        if (!blob) throw new Error(`The stored picture for “${activity.title}” is missing.`);
        backupItem.imageData = await blobToDataUrl(blob);
      }
      backupActivities.push(backupItem);
    }
    const backup = new Blob([JSON.stringify({ version: 2, activities: backupActivities }, null, 2)], { type: "application/json" });
    if (backup.size > 100 * 1024 * 1024) throw new Error("Backup exceeds 100 MB.");
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = "time-options.json";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showStatus("Backup downloaded");
  } catch (error) {
    showStatus(`Could not create backup: ${error.message}`);
  }
});

const restoreInput = $("#restore-file");
$("#restore-options").addEventListener("click", () => restoreInput.click());
restoreInput.addEventListener("change", async () => {
  const file = restoreInput.files[0];
  if (!file) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error("Backup exceeds 100 MB.");
    const backup = JSON.parse(await file.text());
    const rawActivities = Array.isArray(backup) ? backup : backup.activities;
    if (!Array.isArray(rawActivities)) throw new Error("This is not a valid options backup.");
    const imageBlobs = new Map();
    const restoredRaw = rawActivities.map(item => {
      if (item.imageData !== undefined) {
        if (typeof item.imageData !== "string") throw new Error("Invalid picture data in backup.");
        const blob = dataUrlToBlob(item.imageData);
        const id = typeof item.id === "string" && item.id ? item.id : makeId();
        imageBlobs.set(id, blob);
        return { ...item, id, imageId: id };
      }
      return { ...item, imageId: "" };
    });
    const restored = validateActivities(restoredRaw);
    if (!window.confirm("Replace current options?")) return;
    await saveActivities(restored, imageBlobs);
    showStatus("Backup restored");
  } catch (error) {
    showStatus(`Could not restore backup: ${error.message}`);
  } finally {
    restoreInput.value = "";
  }
});

$("#decide-button").addEventListener("click", () => {
  homeView.hidden = true;
  guideView.hidden = false;
  renderTagFilters();
  refreshSuggestion();
  $("#back-button").focus();
});
$("#back-button").addEventListener("click", () => {
  guideView.hidden = true;
  homeView.hidden = false;
  $("#decide-button").focus();
});
$("#another-button").addEventListener("click", refreshSuggestion);
$("#begin-button").addEventListener("click", () => {
  if (currentActivity && currentChoice) startActivity(currentActivity, currentChoice);
});

timeButtons.forEach(button => button.addEventListener("click", () => {
  selectedMinutes = Number(button.dataset.minutes);
  timeButtons.forEach(option => {
    const selected = option === button;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  refreshSuggestion();
}));

const gentleButton = $("#gentle-option");
gentleButton.addEventListener("click", () => {
  gentleOnly = !gentleOnly;
  gentleButton.setAttribute("aria-pressed", String(gentleOnly));
  gentleButton.classList.toggle("is-selected", gentleOnly);
  refreshSuggestion();
});

document.querySelectorAll(".match-option").forEach(button => button.addEventListener("click", () => {
  tagMatch = button.dataset.match;
  document.querySelectorAll(".match-option").forEach(option => {
    const selected = option === button;
    option.classList.toggle("is-selected", selected);
    option.setAttribute("aria-pressed", String(selected));
  });
  refreshSuggestion();
}));

renderTiles();
renderOptionsList();
renderTagFilters();
refreshSuggestion();

if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(error => {
      showStatus(`Offline support unavailable: ${error.message}`);
    });
  });
}
