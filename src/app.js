import {
  RESULT_NON_CHECK,
  RESULT_RISK,
  RESULT_SAFE,
  buildRiskIndex,
  checkSerialNumber,
  normalizeSerialNumber,
  parseRiskCsv,
  validateSerialNumber
} from "./lookup.js";

const APP_VERSION = "web-2026.06.15";
const HISTORY_LIMIT = 3;
const DEFAULT_SUPABASE_URL = "https://iskiqnpsyxxmfdxnxebx.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_yXKeWtM3oCR9q2szpf6BKQ_GKVSbH3J";
const DEFAULT_WAREHOUSE_CODE = "AUTO";
const ZXING_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm";
const LOCAL_KEYS = {
  cloudConfig: "risk-sn-web-cloud-config",
  deviceName: "risk-sn-web-device-name",
  history: "risk-sn-web-history"
};
const NATIVE_BARCODE_FORMATS = [
  "qr_code",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "data_matrix",
  "ean_13",
  "ean_8",
  "itf",
  "pdf417",
  "upc_a",
  "upc_e"
];

const elements = {
  dataDot: document.querySelector("#dataDot"),
  dataStatus: document.querySelector("#dataStatus"),
  cloudStatus: document.querySelector("#cloudStatus"),
  cloudButton: document.querySelector("#cloudButton"),
  scanStage: document.querySelector("#scanStage"),
  video: document.querySelector("#video"),
  cameraFrame: document.querySelector(".camera-frame"),
  cameraHint: document.querySelector("#cameraHint"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  cameraButton: document.querySelector("#cameraButton"),
  imageInput: document.querySelector("#imageInput"),
  manualForm: document.querySelector("#manualForm"),
  manualInput: document.querySelector("#manualInput"),
  historyList: document.querySelector("#historyList"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  resultModal: document.querySelector("#resultModal"),
  resultModalTitle: document.querySelector("#resultModalTitle"),
  resultModalMessage: document.querySelector("#resultModalMessage"),
  resultModalCode: document.querySelector("#resultModalCode"),
  resultModalOk: document.querySelector("#resultModalOk"),
  configModal: document.querySelector("#configModal"),
  configForm: document.querySelector("#configForm"),
  closeConfigButton: document.querySelector("#closeConfigButton"),
  supabaseUrlInput: document.querySelector("#supabaseUrlInput"),
  supabaseKeyInput: document.querySelector("#supabaseKeyInput"),
  operatorInput: document.querySelector("#operatorInput"),
  testDeviceInput: document.querySelector("#testDeviceInput"),
  deviceNameText: document.querySelector("#deviceNameText"),
  resetConfigButton: document.querySelector("#resetConfigButton")
};

const state = {
  riskIndex: new Set(),
  scanTimer: 0,
  scanningFrame: false,
  stream: null,
  zxingControls: null,
  zxingModule: null,
  selectedVideoDeviceId: "",
  selectedVideoLabel: "",
  lastScanCode: "",
  lastScanAt: 0,
  lastAcceptedCode: "",
  history: loadHistory(),
  cloudConfig: loadCloudConfig(),
  deviceName: ensureDeviceName(),
  afterResultOk: null,
  manualSession: makeManualSession()
};

init();

async function init() {
  bindEvents();
  renderHistory();
  renderCloudStatus();
  registerServiceWorker();
  await loadRiskData();
  setTimeout(() => elements.manualInput?.focus(), 0);
}

function bindEvents() {
  elements.startButton.addEventListener("click", () => {
    void startScanner();
  });
  elements.stopButton.addEventListener("click", () => {
    void stopScanner();
  });
  elements.cameraButton.addEventListener("click", () => {
    void switchCamera();
  });
  elements.imageInput.addEventListener("change", (event) => {
    void decodeSelectedImage(event);
  });
  elements.manualInput.addEventListener("keydown", noteManualKeydown);
  elements.manualInput.addEventListener("input", noteManualInput);
  elements.manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void checkManualInput();
  });
  elements.clearHistoryButton.addEventListener("click", () => {
    state.history = [];
    saveHistory();
    renderHistory();
    elements.manualInput.focus();
  });
  elements.resultModalOk.addEventListener("click", closeResultModal);
  elements.cloudButton.addEventListener("click", openConfigModal);
  elements.closeConfigButton.addEventListener("click", closeConfigModal);
  elements.configForm.addEventListener("submit", saveConfig);
  elements.resetConfigButton.addEventListener("click", resetConfig);
}

async function loadRiskData() {
  const startedAt = performance.now();

  try {
    const response = await fetch("./data/risk-sn.csv", { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(`清单加载失败：${response.status}`);
    }

    const csvText = await response.text();
    const rows = parseRiskCsv(csvText);
    state.riskIndex = buildRiskIndex(rows);
    const elapsedMs = Math.round(performance.now() - startedAt);

    elements.dataDot.classList.add("ready");
    elements.dataStatus.textContent =
      `${rows.length.toLocaleString("zh-CN")} 条风险 SN · ${elapsedMs}ms`;
    elements.startButton.disabled = false;
    setCameraHint("等待扫码");
  } catch (error) {
    elements.dataDot.classList.add("error");
    elements.dataStatus.textContent = "风险清单加载失败";
    setCameraHint(error.message || "风险清单加载失败");
  }
}

async function startScanner() {
  if (!state.riskIndex.size) {
    setCameraHint("风险清单尚未加载");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraHint("当前浏览器不支持摄像头");
    return;
  }

  if (!window.isSecureContext) {
    setCameraHint("相机扫码需要 HTTPS 或 localhost");
    return;
  }

  await stopScanner({ silent: true });
  setCameraHint("正在打开摄像头...");

  try {
    const nativeFormats = await getSupportedNativeFormats();
    if (nativeFormats.length > 0) {
      state.stream = await navigator.mediaDevices.getUserMedia(getCameraConstraints());
      elements.video.srcObject = state.stream;
      await elements.video.play();
      updateSelectedVideoLabel();
      startNativeDetectionLoop(nativeFormats);
      setScannerActive(true, "相机扫码中");
      return;
    }

    await startZxingScanner();
    setScannerActive(true, "兼容扫码中");
  } catch (error) {
    await stopScanner({ silent: true });
    setCameraHint(error.message || "摄像头打开失败");
  }
}

async function stopScanner(options = {}) {
  window.clearInterval(state.scanTimer);
  state.scanTimer = 0;
  state.scanningFrame = false;

  if (state.zxingControls) {
    state.zxingControls.stop();
    state.zxingControls = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }

  elements.video.pause();
  elements.video.removeAttribute("src");
  elements.video.srcObject = null;
  setScannerActive(false, options.silent ? "" : "摄像头已停止");
}

async function getSupportedNativeFormats() {
  if (!("BarcodeDetector" in window)) {
    return [];
  }

  if (!BarcodeDetector.getSupportedFormats) {
    return ["qr_code"];
  }

  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    return NATIVE_BARCODE_FORMATS.filter((format) => supported.includes(format));
  } catch {
    return [];
  }
}

function startNativeDetectionLoop(formats) {
  const detector = new BarcodeDetector({ formats });

  state.scanTimer = window.setInterval(async () => {
    if (state.scanningFrame || elements.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }

    state.scanningFrame = true;
    try {
      const codes = await detector.detect(elements.video);
      if (codes.length > 0) {
        await processDecodedValue(codes[0].rawValue, {
          source: "camera",
          label: "相机扫码",
          clearManualOnOk: true,
          restartCameraAfterOk: true
        });
      }
    } catch (error) {
      setCameraHint(error.message || "识别失败");
    } finally {
      state.scanningFrame = false;
    }
  }, 220);
}

async function startZxingScanner() {
  const { BrowserMultiFormatReader } = await loadZxingModule();
  const reader = new BrowserMultiFormatReader();

  state.zxingControls = await reader.decodeFromConstraints(
    getCameraConstraints(),
    elements.video,
    (result) => {
      if (!result) {
        return;
      }
      const text = typeof result.getText === "function" ? result.getText() : result.text;
      void processDecodedValue(text, {
        source: "camera",
        label: "相机扫码",
        clearManualOnOk: true,
        restartCameraAfterOk: true
      });
    }
  );
}

function getCameraConstraints() {
  return {
    audio: false,
    video: {
      ...(state.selectedVideoDeviceId
        ? { deviceId: { exact: state.selectedVideoDeviceId } }
        : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  };
}

async function switchCamera() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setCameraHint("当前浏览器不支持切换摄像头");
    return;
  }

  try {
    const wasRunning = Boolean(state.stream || state.zxingControls);
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((device) => device.kind === "videoinput");
    if (videoDevices.length <= 1) {
      setCameraHint("未发现其它摄像头");
      elements.manualInput.focus();
      return;
    }

    const currentIndex = Math.max(0, videoDevices.findIndex((device) => device.deviceId === state.selectedVideoDeviceId));
    const nextDevice = videoDevices[(currentIndex + 1) % videoDevices.length];
    state.selectedVideoDeviceId = nextDevice.deviceId;
    state.selectedVideoLabel = nextDevice.label || `Camera ${currentIndex + 2}`;

    if (wasRunning) {
      await stopScanner({ silent: true });
      await startScanner();
    }

    setCameraHint(`已切换：${state.selectedVideoLabel}`);
    elements.manualInput.focus();
  } catch (error) {
    setCameraHint(error.message || "摄像头切换失败");
  }
}

async function loadZxingModule() {
  if (state.zxingModule) {
    return state.zxingModule;
  }

  try {
    state.zxingModule = await import(ZXING_URL);
    return state.zxingModule;
  } catch {
    throw new Error("兼容扫码模块加载失败，请检查网络或使用支持 BarcodeDetector 的浏览器。");
  }
}

async function decodeSelectedImage(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  try {
    const nativeFormats = await getSupportedNativeFormats();
    if (nativeFormats.length > 0) {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({ formats: nativeFormats });
      const codes = await detector.detect(bitmap);
      bitmap.close();
      if (!codes.length) {
        throw new Error("图片中未识别到条码或二维码");
      }
      await processDecodedValue(codes[0].rawValue, {
        source: "image",
        label: "图片识别",
        clearManualOnOk: false,
        restartCameraAfterOk: false
      });
      return;
    }

    const { BrowserMultiFormatReader } = await loadZxingModule();
    const reader = new BrowserMultiFormatReader();
    const objectUrl = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(objectUrl);
      const text = typeof result.getText === "function" ? result.getText() : result.text;
      await processDecodedValue(text, {
        source: "image",
        label: "图片识别",
        clearManualOnOk: false,
        restartCameraAfterOk: false
      });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    showResultModal({
      code: "--",
      result: "invalid",
      title: "图片识别失败",
      message: error.message || "请换一张更清晰的图片。"
    });
  } finally {
    event.target.value = "";
  }
}

async function checkManualInput() {
  const source = isLikelyPdaInput() ? "pda_input" : "manual_input";
  await processDecodedValue(elements.manualInput.value, {
    source,
    label: source === "pda_input" ? "PDA扫码" : "输入核验",
    clearManualOnOk: true,
    restartCameraAfterOk: false
  });
}

async function processDecodedValue(rawValue, context) {
  const validation = validateSerialNumber(rawValue);
  if (!validation.valid) {
    if (context.source === "camera") {
      setCameraHint("识别到非 SN 内容，已忽略");
      return;
    }
    showResultModal({
      code: validation.code || "--",
      result: "invalid",
      title: validation.title,
      message: `${validation.message} 不会查询或上传。`
    }, {
      clearManualOnOk: false,
      restartCameraAfterOk: false
    });
    pulse(false);
    return;
  }

  if (!state.riskIndex.size) {
    showResultModal({
      code: validation.code,
      result: "invalid",
      title: "风险清单未加载",
      message: "风险清单加载完成后才可核验。"
    });
    return;
  }

  const code = normalizeSerialNumber(rawValue);
  const now = Date.now();
  if (code === state.lastAcceptedCode) {
    state.lastScanCode = code;
    state.lastScanAt = now;
    setCameraHint(`重复 SN 已跳过：${code}`);
    if (context.clearManualOnOk) {
      clearManualInput();
    }
    return;
  }

  if (code === state.lastScanCode && now - state.lastScanAt < 1400) {
    return;
  }

  state.lastScanCode = code;
  state.lastScanAt = now;

  const result = checkSerialNumber(code, state.riskIndex);
  if (result.invalid) {
    showResultModal(result);
    return;
  }

  if (context.restartCameraAfterOk) {
    await stopScanner({ silent: true });
  }

  const historyItem = addHistory(result, context);
  state.lastAcceptedCode = code;

  showResultModal(result, {
    clearManualOnOk: context.clearManualOnOk,
    restartCameraAfterOk: context.restartCameraAfterOk
  });
  pulse(result.result !== RESULT_RISK);

  if (result.uploadable) {
    void uploadScanEvent(historyItem, result, context);
  }
}

function addHistory(result, context) {
  const item = {
    eventId: makeUuid(),
    code: result.code,
    result: result.result,
    uploadStatus: result.uploadable ? "uploading" : "not_uploaded",
    source: context.source,
    scannedAt: new Date().toISOString()
  };
  state.history.unshift(item);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  saveHistory();
  renderHistory();
  return item;
}

function renderHistory() {
  if (!state.history.length) {
    const row = document.createElement("li");
    row.className = "history-item empty-history";
    row.textContent = "等待检测";
    elements.historyList.replaceChildren(row);
    return;
  }

  elements.historyList.replaceChildren(
    ...state.history.map((item) => {
      const row = document.createElement("li");
      const code = document.createElement("span");
      const resultTag = document.createElement("span");
      const uploadTag = document.createElement("span");

      row.className = "history-item";
      code.className = "history-code";
      code.textContent = item.code;
      resultTag.className = `tag ${resultClass(item.result)}`;
      resultTag.textContent = resultLabel(item.result);
      uploadTag.className = `tag ${uploadClass(item.uploadStatus)}`;
      uploadTag.textContent = uploadLabel(item.uploadStatus);

      row.append(code, resultTag, uploadTag);
      return row;
    })
  );
}

async function uploadScanEvent(historyItem, result, context) {
  const config = effectiveCloudConfig();
  if (!config.supabaseUrl || !config.anonKey || !config.deviceId) {
    updateHistoryUpload(historyItem.eventId, "not_configured", "云端未配置");
    return;
  }

  const payload = {
    event_id: historyItem.eventId,
    sn: result.code,
    result: result.matched ? "risk" : "safe",
    warehouse_code: config.warehouseCode,
    device_id: config.deviceId,
    operator_name: config.operatorName,
    scan_source: context.source,
    app_version: APP_VERSION,
    scanned_at: historyItem.scannedAt,
    is_test: config.testDevice,
    test_tag: config.testDevice ? "test" : null,
    raw_payload: {
      decode_path: context.label,
      camera: state.selectedVideoLabel || "--",
      test_device: config.testDevice,
      user_agent: navigator.userAgent.slice(0, 180)
    }
  };

  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/scan_events`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      updateHistoryUpload(historyItem.eventId, "uploaded");
      return;
    }

    const message = await response.text();
    updateHistoryUpload(historyItem.eventId, "failed", `HTTP ${response.status} ${abbreviate(message, 80)}`);
  } catch (error) {
    updateHistoryUpload(historyItem.eventId, "failed", abbreviate(error.message || "上传失败", 80));
  }
}

function updateHistoryUpload(eventId, uploadStatus, uploadMessage = "") {
  state.history = state.history.map((item) =>
    item.eventId === eventId ? { ...item, uploadStatus, uploadMessage } : item
  );
  saveHistory();
  renderHistory();
}

function showResultModal(result, options = {}) {
  elements.resultModal.dataset.tone = resultTone(result.result);
  elements.resultModalTitle.textContent = result.title;
  elements.resultModalMessage.textContent = result.message;
  elements.resultModalCode.textContent = result.code || "--";
  elements.resultModal.hidden = false;
  elements.resultModalOk.focus();

  state.afterResultOk = async () => {
    if (options.clearManualOnOk) {
      clearManualInput();
    } else {
      elements.manualInput.focus();
    }
    if (options.restartCameraAfterOk) {
      await startScanner();
    }
  };
}

function closeResultModal() {
  elements.resultModal.hidden = true;
  const after = state.afterResultOk;
  state.afterResultOk = null;
  if (after) {
    void after();
  } else {
    elements.manualInput.focus();
  }
}

function openConfigModal() {
  elements.supabaseUrlInput.value = state.cloudConfig.supabaseUrl || "";
  elements.supabaseKeyInput.value = state.cloudConfig.anonKey || "";
  elements.operatorInput.value = state.cloudConfig.operatorName || "";
  elements.testDeviceInput.checked = Boolean(state.cloudConfig.testDevice);
  elements.deviceNameText.textContent = state.deviceName;
  elements.configModal.hidden = false;
  elements.operatorInput.focus();
}

function closeConfigModal() {
  elements.configModal.hidden = true;
  elements.manualInput.focus();
}

function saveConfig(event) {
  event.preventDefault();
  state.cloudConfig = {
    supabaseUrl: trimTrailingSlash(elements.supabaseUrlInput.value),
    anonKey: elements.supabaseKeyInput.value.trim(),
    operatorName: elements.operatorInput.value.trim(),
    testDevice: elements.testDeviceInput.checked
  };
  localStorage.setItem(LOCAL_KEYS.cloudConfig, JSON.stringify(state.cloudConfig));
  renderCloudStatus();
  closeConfigModal();
}

function resetConfig() {
  state.cloudConfig = {
    supabaseUrl: "",
    anonKey: "",
    operatorName: "",
    testDevice: false
  };
  localStorage.setItem(LOCAL_KEYS.cloudConfig, JSON.stringify(state.cloudConfig));
  elements.supabaseUrlInput.value = "";
  elements.supabaseKeyInput.value = "";
  elements.operatorInput.value = "";
  elements.testDeviceInput.checked = false;
  renderCloudStatus();
}

function renderCloudStatus() {
  const config = effectiveCloudConfig();
  const source = state.cloudConfig.supabaseUrl || state.cloudConfig.anonKey ? "自定义云端" : "内置云端";
  const test = config.testDevice ? " · Test" : "";
  elements.cloudStatus.textContent = `${source} · ${config.deviceId}${test}`;
}

function effectiveCloudConfig() {
  return {
    supabaseUrl: trimTrailingSlash(state.cloudConfig.supabaseUrl || DEFAULT_SUPABASE_URL),
    anonKey: state.cloudConfig.anonKey || DEFAULT_SUPABASE_ANON_KEY,
    warehouseCode: DEFAULT_WAREHOUSE_CODE,
    deviceId: state.deviceName,
    operatorName: state.cloudConfig.operatorName || "",
    testDevice: Boolean(state.cloudConfig.testDevice)
  };
}

function noteManualKeydown(event) {
  const now = Date.now();
  if (event.key.length === 1) {
    if (!state.manualSession.firstAt || now - state.manualSession.lastAt > 250) {
      state.manualSession = makeManualSession();
      state.manualSession.firstAt = now;
    }
    state.manualSession.lastAt = now;
    state.manualSession.keyCount += 1;
  }

  if (event.key === "Enter") {
    state.manualSession.entered = true;
  }
}

function noteManualInput(event) {
  if ((event.data && event.data.length > 6) || event.inputType === "insertFromPaste") {
    state.manualSession.pasted = true;
    state.manualSession.lastAt = Date.now();
  }
}

function isLikelyPdaInput() {
  const session = state.manualSession;
  const duration = Math.max(0, session.lastAt - session.firstAt);
  return Boolean(
    session.pasted ||
    session.entered && session.keyCount >= 8 && duration <= 1200
  );
}

function makeManualSession() {
  return {
    firstAt: 0,
    lastAt: 0,
    keyCount: 0,
    entered: false,
    pasted: false
  };
}

function clearManualInput() {
  elements.manualInput.value = "";
  state.manualSession = makeManualSession();
  elements.manualInput.focus();
}

function setScannerActive(active, hint) {
  elements.cameraFrame.classList.toggle("active", active);
  elements.startButton.disabled = active || !state.riskIndex.size;
  elements.stopButton.disabled = !active;
  if (hint) {
    setCameraHint(hint);
  }
}

function setCameraHint(message) {
  elements.cameraHint.textContent = message;
}

async function updateSelectedVideoLabel() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const track = state.stream?.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    const match = devices.find((device) => device.deviceId === settings.deviceId);
    state.selectedVideoLabel = match?.label || track?.label || state.selectedVideoLabel || "Camera";
  } catch {
    state.selectedVideoLabel = state.selectedVideoLabel || "Camera";
  }
}

function pulse(ok) {
  if (!navigator.vibrate) {
    return;
  }
  navigator.vibrate(ok ? 35 : [80, 40, 80]);
}

function resultLabel(result) {
  if (result === RESULT_RISK) {
    return "风险";
  }
  if (result === RESULT_SAFE) {
    return "正常";
  }
  if (result === RESULT_NON_CHECK) {
    return "非待校验产品";
  }
  return "未知";
}

function resultClass(result) {
  if (result === RESULT_RISK) {
    return "risk";
  }
  if (result === RESULT_SAFE) {
    return "safe";
  }
  if (result === RESULT_NON_CHECK) {
    return "skip";
  }
  return "muted";
}

function resultTone(result) {
  if (result === RESULT_RISK) {
    return "risk";
  }
  if (result === RESULT_SAFE) {
    return "safe";
  }
  if (result === RESULT_NON_CHECK) {
    return "skip";
  }
  return "invalid";
}

function uploadLabel(status) {
  if (status === "uploaded") {
    return "已上传";
  }
  if (status === "uploading") {
    return "上传中";
  }
  if (status === "failed") {
    return "上传失败";
  }
  if (status === "not_configured") {
    return "未上传";
  }
  return "不上传";
}

function uploadClass(status) {
  if (status === "uploaded") {
    return "uploaded";
  }
  if (status === "uploading") {
    return "uploading";
  }
  if (status === "failed") {
    return "failed";
  }
  return "muted";
}

function loadHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_KEYS.history) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(LOCAL_KEYS.history, JSON.stringify(state.history));
}

function loadCloudConfig() {
  try {
    return {
      supabaseUrl: "",
      anonKey: "",
      operatorName: "",
      testDevice: false,
      ...JSON.parse(localStorage.getItem(LOCAL_KEYS.cloudConfig) || "{}")
    };
  } catch {
    return {
      supabaseUrl: "",
      anonKey: "",
      operatorName: "",
      testDevice: false
    };
  }
}

function ensureDeviceName() {
  const stored = localStorage.getItem(LOCAL_KEYS.deviceName);
  if (stored) {
    return stored;
  }

  const name = `${detectDeviceFamily()}-${makeShortId()}`;
  localStorage.setItem(LOCAL_KEYS.deviceName, name);
  return name;
}

function detectDeviceFamily() {
  const ua = navigator.userAgent;
  if (/Zebra|TC\d+|ET\d+/i.test(ua)) {
    return "ZEBRA-PDA";
  }
  if (/AUTOID|Seuic|Urovo|iData|Chainway|Honeywell|Datalogic/i.test(ua)) {
    return "ANDROID-PDA";
  }
  if (/Android/i.test(ua)) {
    return "ANDROID";
  }
  if (/iPhone|iPad/i.test(ua)) {
    return "IOS";
  }
  return "WEB";
}

function makeUuid() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeShortId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function abbreviate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  }
}
