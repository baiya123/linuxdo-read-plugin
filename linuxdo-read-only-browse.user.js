// ==UserScript==
// @name         LINUX DO Read-Only Browse Helper
// @namespace    https://linux.do/
// @version      0.4.2
// @description  Read latest LINUX DO topics with visible, manual controls and optional assistive main-post likes. No comments, bookmarks, or other interactions.
// @author       Codex
// @match        https://linux.do/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/baiya123/linuxdo-read-plugin/main/linuxdo-read-only-browse.user.js
// @updateURL    https://raw.githubusercontent.com/baiya123/linuxdo-read-plugin/main/linuxdo-read-only-browse.user.js
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "linuxdo_read_only_browse_state";
  const VISITED_LIMIT = 1000;
  const DAILY_TOPIC_LIMIT = 2000;
  const LIST_REFRESH_AFTER_TOPICS = 10;
  const TOPIC_BOTTOM_EXTRA_STEPS = 20;
  const DEFAULTS = {
    enabled: false,
    minReadMs: 25000,
    maxReadMs: 65000,
    minPauseMs: 5000,
    maxPauseMs: 14000,
    scrollStepsMin: 3,
    scrollStepsMax: 8,
    breakAfterTopics: 10,
    longBreakMs: 300000,
    topicsReadInBatch: 0,
    topicsReadSinceListRefresh: 0,
    panelCollapsed: false,
    mainPostLikeThreshold: 0,
    autoLikeMainPost: false,
    autoLiked: [],
    dailyReadDate: "",
    dailyReadCount: 0,
    dailyLikeDate: "",
    dailyLikeCount: 0,
    dailyTopicDate: "",
    dailyTopicCount: 0,
    dailyTopics: [],
    idleCycles: 0,
    visited: [],
  };

  const safeJson = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const loadState = () => ({
    ...DEFAULTS,
    ...safeJson(GM_getValue(STORAGE_KEY, "{}"), {}),
  });

  const saveState = (patch) => {
    const next = { ...loadState(), ...patch };
    GM_setValue(STORAGE_KEY, JSON.stringify(next));
    return next;
  };

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const randomInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
  const isTopicPage = () => /^\/t\//.test(location.pathname);
  const isListPage = () => /^(\/|\/latest|\/new|\/top|\/categories)$/.test(location.pathname);

  function todayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function secondsToMs(value, fallbackMs) {
    return clampNumber(value, 3, 3600, fallbackMs / 1000) * 1000;
  }

  function positiveInt(value, min, max, fallback) {
    return Math.round(clampNumber(value, min, max, fallback));
  }

  function parseCompactNumber(text) {
    const match = String(text || "")
      .replace(/,/g, "")
      .match(/(\d+(?:\.\d+)?)\s*([kKmM万]?)/);
    if (!match) return null;

    const number = Number(match[1]);
    if (!Number.isFinite(number)) return null;

    const unit = match[2].toLowerCase();
    if (unit === "k") return Math.round(number * 1000);
    if (unit === "m") return Math.round(number * 1000000);
    if (unit === "万") return Math.round(number * 10000);
    return Math.round(number);
  }

  function normalizeTopicUrl(url) {
    try {
      const parsed = new URL(url, location.origin);
      const match = parsed.pathname.match(/^\/t\/[^/]+\/\d+/);
      if (!match) return null;
      parsed.pathname = match[0];
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }

  function getTopicLinks() {
    const anchors = Array.from(document.querySelectorAll('a[href*="/t/"]'));
    const seen = new Set();

    return anchors
      .map((anchor) => ({
        anchor,
        title: (anchor.textContent || "").trim(),
        url: normalizeTopicUrl(anchor.href),
      }))
      .filter((item) => {
        if (!item.url || !item.title || item.title.length < 4) return false;
        if (/^\d+(\.\d+)?k?$|^\d+\s*(分钟|小时|天)$/.test(item.title)) return false;
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      });
  }

  function chooseNextTopic() {
    const state = loadState();
    const visited = new Set(state.visited || []);
    const currentTopic = normalizeTopicUrl(location.href);
    return getTopicLinks().find((topic) => topic.url !== currentTopic && !visited.has(topic.url));
  }

  function rememberVisited(url) {
    const state = loadState();
    const normalized = normalizeTopicUrl(url);
    if (!normalized) return;
    const visited = [normalized, ...(state.visited || []).filter((item) => item !== normalized)].slice(0, VISITED_LIMIT);
    saveState({ visited });
  }

  function getDailyReadCount() {
    const state = loadState();
    return state.dailyReadDate === todayKey() ? state.dailyReadCount || 0 : 0;
  }

  function incrementDailyReadCount() {
    const state = loadState();
    const today = todayKey();
    const dailyReadCount = state.dailyReadDate === today ? (state.dailyReadCount || 0) + 1 : 1;
    saveState({ dailyReadDate: today, dailyReadCount });
    return dailyReadCount;
  }

  function resetDailyReadCount() {
    saveState({ dailyReadDate: todayKey(), dailyReadCount: 0 });
  }

  function getDailyLikeCount() {
    const state = loadState();
    return state.dailyLikeDate === todayKey() ? state.dailyLikeCount || 0 : 0;
  }

  function incrementDailyLikeCount() {
    const state = loadState();
    const today = todayKey();
    const dailyLikeCount = state.dailyLikeDate === today ? (state.dailyLikeCount || 0) + 1 : 1;
    saveState({ dailyLikeDate: today, dailyLikeCount });
    return dailyLikeCount;
  }

  function resetDailyLikeCount() {
    saveState({ dailyLikeDate: todayKey(), dailyLikeCount: 0 });
  }

  function getDailyTopicCount() {
    const state = loadState();
    return state.dailyTopicDate === todayKey() ? state.dailyTopicCount || 0 : 0;
  }

  function rememberDailyTopic(url) {
    const normalized = normalizeTopicUrl(url);
    if (!normalized) return getDailyTopicCount();

    const state = loadState();
    const today = todayKey();
    const dailyTopics = state.dailyTopicDate === today ? state.dailyTopics || [] : [];

    if (dailyTopics.includes(normalized)) return state.dailyTopicDate === today ? state.dailyTopicCount || 0 : 0;

    const nextDailyTopics = [normalized, ...dailyTopics].slice(0, DAILY_TOPIC_LIMIT);
    const dailyTopicCount = state.dailyTopicDate === today ? (state.dailyTopicCount || 0) + 1 : 1;
    saveState({ dailyTopicDate: today, dailyTopicCount, dailyTopics: nextDailyTopics });
    return dailyTopicCount;
  }

  function resetDailyTopicCount() {
    saveState({ dailyTopicDate: todayKey(), dailyTopicCount: 0, dailyTopics: [] });
  }

  function buildPanel() {
    const existing = document.getElementById("linuxdo-read-only-helper");
    if (existing) return existing;

    const panel = document.createElement("div");
    panel.id = "linuxdo-read-only-helper";
    panel.innerHTML = `
      <div class="ldo-roh-header">
        <div class="ldo-roh-title">LINUX DO 只读浏览</div>
        <button type="button" class="ldo-roh-collapse" data-role="collapse"></button>
      </div>
      <div class="ldo-roh-content">
        <div class="ldo-roh-status" data-role="status">待机</div>
        <div class="ldo-roh-daily" data-role="daily-count">今日已读 0 篇 / 新话题 0 个 / 点赞 0 次</div>
        <div class="ldo-roh-like-hint" data-role="like-hint"></div>
        <label>阅读秒数
          <span>
            <input type="number" min="10" max="3600" step="5" data-role="min-read">
            -
            <input type="number" min="10" max="3600" step="5" data-role="max-read">
          </span>
        </label>
        <label>间隔秒数
          <span>
            <input type="number" min="3" max="600" step="1" data-role="min-pause">
            -
            <input type="number" min="3" max="600" step="1" data-role="max-pause">
          </span>
        </label>
        <label>滚动步数
          <span>
            <input type="number" min="1" max="30" step="1" data-role="min-steps">
            -
            <input type="number" min="1" max="30" step="1" data-role="max-steps">
          </span>
        </label>
        <label>读几篇休息
          <input type="number" min="1" max="200" step="1" data-role="break-after">
        </label>
        <label>休息秒数
          <input type="number" min="10" max="86400" step="10" data-role="long-break">
        </label>
        <label>主帖赞阈值
          <input type="number" min="0" max="1000000" step="1" data-role="like-threshold">
        </label>
        <label>自动点赞
          <input type="checkbox" data-role="auto-like">
        </label>
        <div class="ldo-roh-row">
          <button type="button" data-role="toggle"></button>
          <button type="button" data-role="reset">清记录</button>
        </div>
      </div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #linuxdo-read-only-helper {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        width: 230px;
        padding: 12px;
        border: 1px solid rgba(125, 125, 125, 0.25);
        border-radius: 12px;
        background: rgba(32, 34, 37, 0.94);
        color: #fff;
        font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      }
      #linuxdo-read-only-helper .ldo-roh-title {
        font-weight: 700;
      }
      #linuxdo-read-only-helper .ldo-roh-header {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      #linuxdo-read-only-helper .ldo-roh-collapse {
        position: relative;
        flex: none;
        padding: 4px 8px;
        font-size: 12px;
        min-width: 44px;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed {
        width: 58px;
        height: 58px;
        padding: 0;
        border-radius: 50%;
        background: rgba(32, 34, 37, 0.96);
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-title,
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-content {
        display: none;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-header {
        width: 100%;
        height: 100%;
        margin-bottom: 0;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-collapse {
        width: 100%;
        height: 100%;
        padding: 0;
        border-radius: 50%;
        background: #f5f5f5;
        color: transparent;
        font-size: 0;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-collapse::before {
        content: "";
        position: absolute;
        left: 50%;
        top: 50%;
        width: 34px;
        height: 34px;
        transform: translate(-50%, -50%);
        background: #2e3033;
        clip-path: polygon(50% 4%, 88% 25%, 88% 75%, 50% 96%, 12% 75%, 12% 25%);
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-collapse::after {
        content: "展开";
        position: absolute;
        left: 50%;
        bottom: -22px;
        transform: translateX(-50%);
        min-width: 42px;
        padding: 3px 6px;
        border-radius: 999px;
        background: rgba(32, 34, 37, 0.9);
        color: #fff;
        font-size: 12px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed:hover .ldo-roh-collapse::after {
        opacity: 1;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-header::before,
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-header::after {
        content: "";
        position: absolute;
        z-index: 1;
        left: 50%;
        top: 50%;
        width: 18px;
        height: 4px;
        border-radius: 999px;
        background: #f5f5f5;
        transform-origin: center;
        pointer-events: none;
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-header::before {
        transform: translate(-50%, -50%) rotate(30deg) translateY(-5px);
      }
      #linuxdo-read-only-helper.ldo-roh-collapsed .ldo-roh-header::after {
        transform: translate(-50%, -50%) rotate(-30deg) translateY(-5px);
      }
      #linuxdo-read-only-helper .ldo-roh-status {
        min-height: 22px;
        opacity: 0.88;
        margin-bottom: 4px;
      }
      #linuxdo-read-only-helper .ldo-roh-daily {
        opacity: 0.88;
        margin-bottom: 10px;
      }
      #linuxdo-read-only-helper .ldo-roh-like-hint {
        display: none;
        margin-bottom: 10px;
        padding: 7px 8px;
        border-radius: 8px;
        background: rgba(255, 209, 102, 0.16);
        color: #ffe7a3;
      }
      #linuxdo-read-only-helper .ldo-roh-like-hint:not(:empty) {
        display: block;
      }
      #linuxdo-read-only-helper label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 7px 0;
        color: rgba(255, 255, 255, 0.9);
      }
      #linuxdo-read-only-helper input {
        width: 54px;
        box-sizing: border-box;
        border: 0;
        border-radius: 7px;
        padding: 5px 6px;
        color: #111;
        background: #fff;
      }
      #linuxdo-read-only-helper input[type="checkbox"] {
        width: auto;
        transform: scale(1.15);
      }
      #linuxdo-read-only-helper .ldo-roh-row {
        display: flex;
        gap: 8px;
        margin-top: 10px;
      }
      #linuxdo-read-only-helper button {
        flex: 1;
        border: 0;
        border-radius: 8px;
        padding: 7px 8px;
        cursor: pointer;
        color: #111;
        background: #f0f0f0;
      }
      #linuxdo-read-only-helper button[data-role="toggle"] {
        background: #9ee493;
      }
      .ldo-roh-like-highlight {
        outline: 3px solid #ffd166 !important;
        outline-offset: 3px !important;
        border-radius: 8px !important;
        box-shadow: 0 0 0 4px rgba(255, 209, 102, 0.22) !important;
      }
    `;

    document.documentElement.appendChild(style);
    document.documentElement.appendChild(panel);
    return panel;
  }

  function syncPanelVisibility() {
    const panel = buildPanel();
    const state = loadState();
    panel.classList.toggle("ldo-roh-collapsed", state.panelCollapsed);
    panel.querySelector('[data-role="collapse"]').textContent = state.panelCollapsed ? "展开" : "收起";
  }

  function syncDailyReadCount() {
    const panel = buildPanel();
    panel.querySelector(
      '[data-role="daily-count"]'
    ).textContent = `今日已读 ${getDailyReadCount()} 篇 / 新话题 ${getDailyTopicCount()} 个 / 点赞 ${getDailyLikeCount()} 次`;
  }

  function setStatus(text) {
    const panel = buildPanel();
    const status = panel.querySelector('[data-role="status"]');
    const toggle = panel.querySelector('[data-role="toggle"]');
    const state = loadState();

    status.textContent = text;
    toggle.textContent = state.enabled ? "停止" : "开始";
    toggle.style.background = state.enabled ? "#ffb3b3" : "#9ee493";
    syncDailyReadCount();
  }

  function setLikeHint(text) {
    const hint = buildPanel().querySelector('[data-role="like-hint"]');
    hint.textContent = text;
  }

  function syncInputsFromState() {
    const panel = buildPanel();
    const state = loadState();
    panel.querySelector('[data-role="min-read"]').value = Math.round(state.minReadMs / 1000);
    panel.querySelector('[data-role="max-read"]').value = Math.round(state.maxReadMs / 1000);
    panel.querySelector('[data-role="min-pause"]').value = Math.round(state.minPauseMs / 1000);
    panel.querySelector('[data-role="max-pause"]').value = Math.round(state.maxPauseMs / 1000);
    panel.querySelector('[data-role="min-steps"]').value = state.scrollStepsMin;
    panel.querySelector('[data-role="max-steps"]').value = state.scrollStepsMax;
    panel.querySelector('[data-role="break-after"]').value = state.breakAfterTopics;
    panel.querySelector('[data-role="long-break"]').value = Math.round(state.longBreakMs / 1000);
    panel.querySelector('[data-role="like-threshold"]').value = state.mainPostLikeThreshold;
    panel.querySelector('[data-role="auto-like"]').checked = state.autoLikeMainPost;
  }

  function saveInputsToState() {
    const panel = buildPanel();
    let minReadMs = secondsToMs(panel.querySelector('[data-role="min-read"]').value, DEFAULTS.minReadMs);
    let maxReadMs = secondsToMs(panel.querySelector('[data-role="max-read"]').value, DEFAULTS.maxReadMs);
    let minPauseMs = secondsToMs(panel.querySelector('[data-role="min-pause"]').value, DEFAULTS.minPauseMs);
    let maxPauseMs = secondsToMs(panel.querySelector('[data-role="max-pause"]').value, DEFAULTS.maxPauseMs);
    let scrollStepsMin = positiveInt(
      panel.querySelector('[data-role="min-steps"]').value,
      1,
      30,
      DEFAULTS.scrollStepsMin
    );
    let scrollStepsMax = positiveInt(
      panel.querySelector('[data-role="max-steps"]').value,
      1,
      30,
      DEFAULTS.scrollStepsMax
    );
    const breakAfterTopics = positiveInt(
      panel.querySelector('[data-role="break-after"]').value,
      1,
      200,
      DEFAULTS.breakAfterTopics
    );
    const longBreakMs =
      positiveInt(panel.querySelector('[data-role="long-break"]').value, 10, 86400, DEFAULTS.longBreakMs / 1000) *
      1000;
    const mainPostLikeThreshold = positiveInt(
      panel.querySelector('[data-role="like-threshold"]').value,
      0,
      1000000,
      DEFAULTS.mainPostLikeThreshold
    );
    const autoLikeMainPost = panel.querySelector('[data-role="auto-like"]').checked;

    if (minReadMs > maxReadMs) [minReadMs, maxReadMs] = [maxReadMs, minReadMs];
    if (minPauseMs > maxPauseMs) [minPauseMs, maxPauseMs] = [maxPauseMs, minPauseMs];
    if (scrollStepsMin > scrollStepsMax) [scrollStepsMin, scrollStepsMax] = [scrollStepsMax, scrollStepsMin];

    saveState({
      minReadMs,
      maxReadMs,
      minPauseMs,
      maxPauseMs,
      scrollStepsMin,
      scrollStepsMax,
      breakAfterTopics,
      longBreakMs,
      mainPostLikeThreshold,
      autoLikeMainPost,
    });
    syncInputsFromState();
  }

  function getMainPostElement() {
    return (
      document.querySelector('[data-post-number="1"]') ||
      document.querySelector("#post_1") ||
      document.querySelector(".topic-post")
    );
  }

  function getMainPostLikeInfo() {
    const post = getMainPostElement();
    if (!post) return null;

    const counter = post.querySelector(
      ".post-controls .discourse-reactions-counter .reactions-counter, .post-controls .discourse-reactions-counter"
    );
    const topicMapLikes = post.querySelector(".topic-map__likes-trigger .number");
    const button = post.querySelector(
      [
        ".post-controls button.btn-toggle-reaction-like.reaction-button",
        '.post-controls button[title*="点赞"]',
        '.post-controls button[aria-label*="点赞"]',
        '.post-controls button[title*="like" i]',
        '.post-controls button[aria-label*="like" i]',
      ].join(",")
    );

    const counterText = counter
      ? [counter.textContent, counter.getAttribute("aria-label"), counter.getAttribute("title")].filter(Boolean).join(" ")
      : "";
    const topicMapLikesText = topicMapLikes ? topicMapLikes.textContent : "";
    const parsed = parseCompactNumber(counterText);
    const topicMapParsed = parseCompactNumber(topicMapLikesText);
    const count = parsed ?? topicMapParsed ?? 0;
    const buttonText = button
      ? [button.textContent, button.getAttribute("aria-label"), button.getAttribute("title"), button.className]
          .filter(Boolean)
          .join(" ")
      : "";
    const alreadyLiked = Boolean(button && (/取消|已赞|liked/i.test(buttonText) || button.querySelector('use[href="#heart"]')));

    return { count, target: button || counter || topicMapLikes || null, button, alreadyLiked };
  }

  async function waitForMainPostLikeInfo() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const info = getMainPostLikeInfo();
      if (info && (info.button || info.target || info.count > 0)) return info;
      await sleep(500);
    }

    return getMainPostLikeInfo();
  }

  function clearLikeHighlight() {
    document.querySelectorAll(".ldo-roh-like-highlight").forEach((element) => {
      element.classList.remove("ldo-roh-like-highlight");
    });
  }

  function rememberAutoLiked(url) {
    const state = loadState();
    const normalized = normalizeTopicUrl(url);
    if (!normalized) return;
    const autoLiked = [normalized, ...(state.autoLiked || []).filter((item) => item !== normalized)].slice(0, 200);
    saveState({ autoLiked });
  }

  function wasAutoLiked(url) {
    const normalized = normalizeTopicUrl(url);
    return Boolean(normalized && (loadState().autoLiked || []).includes(normalized));
  }

  async function updateLikeAssist() {
    clearLikeHighlight();
    const state = loadState();
    if (!isTopicPage() || state.mainPostLikeThreshold <= 0) {
      setLikeHint("");
      return;
    }

    const info = await waitForMainPostLikeInfo();
    if (!info) {
      setLikeHint("未找到主帖点赞信息");
      return;
    }

    if (info.count >= state.mainPostLikeThreshold) {
      if (info.target) info.target.classList.add("ldo-roh-like-highlight");
      if (state.autoLikeMainPost && state.enabled) {
        if (info.alreadyLiked || wasAutoLiked(location.href)) {
          setLikeHint(`主帖 ${info.count} 赞，已点赞`);
          return;
        }

        if (info.button) {
          setLikeHint(`主帖 ${info.count} 赞，自动点赞中`);
          await sleep(randomInt(700, 1800));
          const latest = loadState();
          if (!latest.enabled || !latest.autoLikeMainPost || !isTopicPage() || !info.button.isConnected) return;
          info.button.click();
          rememberAutoLiked(location.href);
          incrementDailyLikeCount();
          syncDailyReadCount();
          setLikeHint(`主帖 ${info.count} 赞，已自动点赞`);
          return;
        }

        setLikeHint(`主帖 ${info.count} 赞，未找到可点击点赞按钮`);
        return;
      }

      setLikeHint(`主帖 ${info.count} 赞，达到阈值，可手动点赞`);
      return;
    }

    setLikeHint(`主帖 ${info.count} 赞，未达到阈值`);
  }

  function setupPanel() {
    const panel = buildPanel();
    const toggle = panel.querySelector('[data-role="toggle"]');
    const reset = panel.querySelector('[data-role="reset"]');
    const collapse = panel.querySelector('[data-role="collapse"]');
    const inputs = panel.querySelectorAll("input");

    syncInputsFromState();
    syncPanelVisibility();
    syncDailyReadCount();

    collapse.addEventListener("click", () => {
      saveState({ panelCollapsed: !loadState().panelCollapsed });
      syncPanelVisibility();
    });

    toggle.addEventListener("click", () => {
      const state = loadState();
      saveInputsToState();
      const enabled = !state.enabled;
      saveState({ enabled, idleCycles: 0, topicsReadInBatch: 0, topicsReadSinceListRefresh: 0 });
      setStatus(enabled ? "已启动，前往最新贴" : "已停止");
      window.setTimeout(() => {
        if (enabled) {
          location.href = "https://linux.do/latest";
          return;
        }

        location.reload();
      }, 600);
    });

    reset.addEventListener("click", () => {
      saveState({ visited: [], autoLiked: [], idleCycles: 0, topicsReadInBatch: 0, topicsReadSinceListRefresh: 0 });
      resetDailyReadCount();
      resetDailyLikeCount();
      resetDailyTopicCount();
      syncDailyReadCount();
      setStatus("已清空浏览记录");
    });

    inputs.forEach((input) => {
      input.addEventListener("change", () => {
        saveInputsToState();
        setStatus(loadState().enabled ? "设置已保存，继续运行" : "设置已保存");
        updateLikeAssist();
      });
    });

    setStatus(loadState().enabled ? "运行中" : "待机");
  }

  async function scrollTopicLikeReading() {
    const state = loadState();
    const totalReadMs = randomInt(state.minReadMs, state.maxReadMs);
    const steps = randomInt(state.scrollStepsMin, state.scrollStepsMax);
    const stepDelay = Math.max(2500, Math.floor(totalReadMs / steps));

    for (let i = 0; i < steps; i += 1) {
      if (!loadState().enabled) return false;
      if (isTopicBottomVisible()) {
        setStatus(`已读到底 ${i}/${steps}`);
        return true;
      }

      setStatus(`阅读帖子中 ${i + 1}/${steps}`);
      window.scrollBy({
        top: randomInt(260, 760),
        left: 0,
        behavior: "smooth",
      });
      await sleep(stepDelay + randomInt(-900, 1400));

      if (isTopicBottomVisible()) {
        setStatus(`已读到底 ${i + 1}/${steps}`);
        return true;
      }
    }

    for (let i = 0; i < TOPIC_BOTTOM_EXTRA_STEPS; i += 1) {
      if (!loadState().enabled) return false;
      if (isTopicBottomVisible()) {
        setStatus("已读到底");
        return true;
      }

      setStatus(`补充下拉到底 ${i + 1}/${TOPIC_BOTTOM_EXTRA_STEPS}`);
      window.scrollBy({
        top: randomInt(420, 980),
        left: 0,
        behavior: "smooth",
      });
      await sleep(randomInt(2200, 5200));
    }

    return isTopicBottomVisible();
  }

  async function scrollListLikeBrowsingMore() {
    const steps = randomInt(2, 5);
    for (let i = 0; i < steps; i += 1) {
      if (!loadState().enabled) return;
      setStatus(`列表下拉找新话题 ${i + 1}/${steps}`);
      window.scrollBy({
        top: randomInt(480, 1250),
        left: 0,
        behavior: "smooth",
      });
      await sleep(randomInt(1800, 5200));
    }
  }

  function clickTopicLink(anchor) {
    anchor.removeAttribute("target");
    anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function isElementVisibleInViewport(element, bottomPadding = 80) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.top < window.innerHeight - bottomPadding && rect.bottom > 0;
  }

  function getRemainingScrollPx() {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollHeight - (window.scrollY + window.innerHeight));
  }

  function isTopicBottomVisible() {
    if (!isTopicPage()) return false;
    if (getRemainingScrollPx() <= 260) return true;

    return [
      "#topic-footer-buttons",
      ".topic-footer-buttons",
      ".topic-footer-main-buttons",
      ".topic-footer",
    ].some((selector) => Array.from(document.querySelectorAll(selector)).some((element) => isElementVisibleInViewport(element)));
  }

  async function runOnTopicPage() {
    rememberVisited(location.href);
    rememberDailyTopic(location.href);
    syncDailyReadCount();
    saveState({ idleCycles: 0 });
    const state = loadState();
    await updateLikeAssist();
    setStatus("停留阅读中");
    await sleep(randomInt(state.minPauseMs, state.maxPauseMs));
    const completed = await scrollTopicLikeReading();

    if (loadState().enabled) {
      if (completed) {
        const nextState = loadState();
        const topicsReadInBatch = (nextState.topicsReadInBatch || 0) + 1;
        const topicsReadSinceListRefresh = (nextState.topicsReadSinceListRefresh || 0) + 1;
        incrementDailyReadCount();
        syncDailyReadCount();
        saveState({ topicsReadInBatch, topicsReadSinceListRefresh });

        if (topicsReadInBatch >= nextState.breakAfterTopics) {
          setStatus(`已读 ${topicsReadInBatch} 篇，休息中`);
          await sleep(nextState.longBreakMs);
          if (!loadState().enabled) return;
          saveState({ topicsReadInBatch: 0 });
        }
      } else {
        setStatus("未检测到底部，跳过不计已读");
        await sleep(randomInt(state.minPauseMs, state.maxPauseMs));
      }

      setStatus("返回最新列表");
      if (history.length > 1) {
        const beforeUrl = location.href;
        history.back();
        window.setTimeout(() => {
          if (!loadState().enabled) return;

          if (location.href !== beforeUrl && isListPage()) {
            if (loadState().topicsReadSinceListRefresh >= LIST_REFRESH_AFTER_TOPICS) {
              saveState({ topicsReadSinceListRefresh: 0 });
              setStatus("已读 10 篇，刷新最新列表");
              location.reload();
              return;
            }

            setStatus("已返回列表，继续找下一篇");
            runOnListPage().catch((error) => {
              console.error("[LINUX DO Read-Only Browse Helper]", error);
              setStatus("脚本遇到错误，已停止");
              saveState({ enabled: false });
            });
            return;
          }

          if (location.href === beforeUrl || !isListPage()) {
            location.href = "https://linux.do/latest";
          }
        }, 3500);
        return;
      }

      location.href = "https://linux.do/latest";
    }
  }

  async function runOnListPage() {
    await sleep(randomInt(2000, 5000));
    const topic = chooseNextTopic();

    if (!topic) {
      const state = loadState();
      const idleCycles = (state.idleCycles || 0) + 1;
      saveState({ idleCycles });
      setStatus("未找到未读帖子，向下找一找");
      window.scrollBy({ top: randomInt(650, 1600), left: 0, behavior: "smooth" });
      await sleep(randomInt(9000, 22000));

      if (!loadState().enabled) return;
      if (idleCycles >= 3) {
        saveState({ idleCycles: 0 });
        setStatus("可见列表读完，继续加载更多话题");
        await sleep(randomInt(4000, 9000));
        await scrollListLikeBrowsingMore();
        location.href = "https://linux.do/latest";
        return;
      }

      location.reload();
      return;
    }

    saveState({ idleCycles: 0 });
    setStatus(`准备打开：${topic.title.slice(0, 26)}`);
    await sleep(randomInt(loadState().minPauseMs, loadState().maxPauseMs));
    if (loadState().enabled) {
      rememberVisited(topic.url);
      const beforeUrl = location.href;
      setStatus(`点击进入：${topic.title.slice(0, 26)}`);
      clickTopicLink(topic.anchor);
      await sleep(3200);
      if (!loadState().enabled) return;

      if (location.href !== beforeUrl) {
        setStatus("已进入话题，重新载入阅读流程");
        location.reload();
        return;
      }

      if (location.href === beforeUrl) {
        setStatus("点击未跳转，兜底打开话题");
        location.assign(topic.url);
      }
    }
  }

  async function main() {
    setupPanel();
    const state = loadState();
    await updateLikeAssist();
    if (!state.enabled) return;

    if (isTopicPage()) {
      await runOnTopicPage();
      return;
    }

    if (!isListPage()) {
      setStatus("前往最新列表");
      await sleep(randomInt(2000, 5000));
      if (loadState().enabled) location.href = "https://linux.do/latest";
      return;
    }

    await runOnListPage();
  }

  main().catch((error) => {
    console.error("[LINUX DO Read-Only Browse Helper]", error);
    setStatus("脚本遇到错误，已停止");
    saveState({ enabled: false });
  });
})();
