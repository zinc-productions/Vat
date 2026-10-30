
"use strict";

// ==========================================
// VAT CONFIGURATION
// ==========================================

const VAT_VERSION = "V1.7";

const VAT_WORKER_URL =
  "https://flat-resonance-e3df.zzsniper800.workers.dev/";

const VAT_MESSAGE_LIMIT = 15;
const VAT_WINDOW_MS = 60 * 60 * 1000;

// ==========================================
// ELEMENTS
// ==========================================

const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const chatLengthInput = document.getElementById("chatLength");
const personalityInput = document.getElementById("personality");
const nicknameInput = document.getElementById("nickname");

const statusElement = document.getElementById("status");
const usageText = document.getElementById("usageText");
const usageTimer = document.getElementById("usageTimer");
const clearChatButton = document.getElementById("clearChat");

// ==========================================
// CHAT STATE
// ==========================================

let conversationHistory = [];
let isSending = false;

// ==========================================
// SETTINGS
// ==========================================

function getSettings() {
  return {
    chatLength: chatLengthInput.value,
    personality: personalityInput.value,
    nickname: nicknameInput.value.trim().slice(0, 40)
  };
}

// ==========================================
// MESSAGE DISPLAY
// ==========================================

function showWelcome() {
  const welcome = document.createElement("div");
  welcome.className = "welcome";

  const icon = document.createElement("div");
  icon.className = "welcome-icon";
  icon.textContent = "V";

  const heading = document.createElement("h2");
  heading.textContent = "Hello! I'm Vat.";

  const paragraph = document.createElement("p");
  paragraph.textContent = "What would you like to talk about?";

  welcome.append(icon, heading, paragraph);
  chatMessages.appendChild(welcome);
}

function addMessage(role, content, extraClass = "") {
  const welcome = chatMessages.querySelector(".welcome");

  if (welcome) welcome.remove();

  const message = document.createElement("div");

  message.className =
    "message " + role +
    (extraClass ? " " + extraClass : "");

  const name = document.createElement("div");
  name.className = "message-name";
  name.textContent = role === "user" ? "You" : "Vat";

  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;

  message.append(name, body);
  chatMessages.appendChild(message);

  chatMessages.scrollTop = chatMessages.scrollHeight;

  return message;
}

function showTyping() {
  return addMessage(
    "assistant",
    "Vat is thinking...",
    "typing"
  );
}

// ==========================================
// HOURLY MESSAGE LIMIT
// ==========================================

const USAGE_STORAGE_KEY = "vat_usage_v17";

function loadUsage() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(USAGE_STORAGE_KEY) || "[]"
    );

    if (!Array.isArray(saved)) return [];

    const now = Date.now();

    return saved.filter(timestamp =>
      Number.isFinite(timestamp) &&
      timestamp > now - VAT_WINDOW_MS &&
      timestamp <= now
    ).sort((a, b) => a - b);

  } catch (error) {
    return [];
  }
}

function saveUsage(timestamps) {
  try {
    localStorage.setItem(
      USAGE_STORAGE_KEY,
      JSON.stringify(timestamps)
    );
  } catch (error) {
    console.error("Vat could not save usage:", error);
  }
}

function formatTime(milliseconds) {
  const seconds = Math.ceil(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);

  return minutes + "m " + (seconds % 60) + "s";
}

function updateUsage() {
  const timestamps = loadUsage();

  const remaining = Math.max(
    0,
    VAT_MESSAGE_LIMIT - timestamps.length
  );

  usageText.textContent =
    remaining + " / " + VAT_MESSAGE_LIMIT +
    " messages remaining";

  if (timestamps.length) {
    const resetIn =
      timestamps[0] + VAT_WINDOW_MS - Date.now();

    usageTimer.textContent =
      remaining === 0
        ? "Next message in " + formatTime(resetIn)
        : "Next reset in " + formatTime(resetIn);
  } else {
    usageTimer.textContent = "Hourly limit";
  }

  sendButton.disabled = isSending || remaining <= 0;

  return remaining;
}

function recordMessage() {
  const timestamps = loadUsage();

  if (timestamps.length >= VAT_MESSAGE_LIMIT) {
    return false;
  }

  timestamps.push(Date.now());
  saveUsage(timestamps);

  updateUsage();

  return true;
}

// ==========================================
// CLOUDFLARE WORKER CONNECTION
// ==========================================

async function askVat(message) {
  const payload = {
    message: message,

    history: conversationHistory.slice(-10),

    settings: getSettings()
  };

  let response;

  try {
    response = await fetch(VAT_WORKER_URL, {
      method: "POST",

      headers: {
        "Content-Type": "text/plain;charset=UTF-8"
      },

      body: JSON.stringify(payload),

      signal: AbortSignal.timeout(60000)
    });

  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error("Vat took too long to respond.");
    }

    throw new Error(
      "Could not connect to Vat's Cloudflare Worker. " +
      "Check the Worker and its CORS settings."
    );
  }

  const responseText = await response.text();

  let result;

  try {
    result = JSON.parse(responseText);
  } catch (error) {
    throw new Error(
      "Vat received an invalid response from Cloudflare."
    );
  }

  if (!response.ok) {
    throw new Error(
      result.error || result.message ||
      "Worker returned HTTP " + response.status
    );
  }

  // Accept a few common response formats.
  const answer =
    result.answer ||
    result.response ||
    result.reply ||
    result.choices?.[0]?.message?.content;

  if (typeof answer !== "string" || !answer.trim()) {
    throw new Error(
      result.message ||
      "Cloudflare responded, but no AI answer was returned."
    );
  }

  return answer;
}

// ==========================================
// SEND MESSAGE
// ==========================================

async function sendMessage() {
  if (isSending) return;

  const message = messageInput.value.trim();

  if (!message) return;

  if (message.length > 4000) {
    addMessage(
      "assistant",
      "Your message is too long. Maximum length is 4000 characters.",
      "error"
    );
    return;
  }

  if (updateUsage() <= 0) {
    addMessage(
      "assistant",
      "You've reached your 15-message hourly limit. Please wait for a message to reset.",
      "error"
    );
    return;
  }

  if (!recordMessage()) return;

  isSending = true;
  updateUsage();

  addMessage("user", message);

  messageInput.value = "";
  messageInput.style.height = "auto";

  statusElement.textContent = "Vat is thinking...";

  const typing = showTyping();

  try {
    const answer = await askVat(message);

    typing.remove();

    addMessage("assistant", answer);

    conversationHistory.push(
      {
        role: "user",
        content: message
      },
      {
        role: "assistant",
        content: answer
      }
    );

  } catch (error) {
    typing.remove();

    console.error("Vat error:", error);

    addMessage(
      "assistant",
      error.message,
      "error"
    );

  } finally {
    isSending = false;

    statusElement.textContent = "Ready to chat";

    updateUsage();
    messageInput.focus();
  }
}

// ==========================================
// NEW CHAT
// ==========================================

function newChat() {
  if (isSending) return;

  conversationHistory = [];
  chatMessages.innerHTML = "";

  showWelcome();
}

// ==========================================
// EVENTS
// ==========================================

chatForm.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage();
});

messageInput.addEventListener("keydown", event => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});

messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";

  messageInput.style.height =
    Math.min(messageInput.scrollHeight, 150) + "px";
});

clearChatButton.addEventListener("click", newChat);

// ==========================================
// INITIALIZATION
// ==========================================

function initializeVat() {
  document.title = "Vat " + VAT_VERSION;

  updateUsage();
  showWelcome();

  setInterval(updateUsage, 1000);

  console.log("Vat " + VAT_VERSION + " initialized.");
  console.log("Cloudflare Worker:", VAT_WORKER_URL);
}

initializeVat();
