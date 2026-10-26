const MODEL_URL = "./my_model/";

// 확신도가 이 값 이상이고, 같은 결과가 STABLE_FRAMES번 연속으로 나와야 화면에 표시
const THRESHOLD = 0.75;
const STABLE_FRAMES = 5;

// 모델 라벨(metadata.json의 labels)별 안내 문구
const INFO = {
  plastic: {
    name: "플라스틱",
    icon: "🧴",
    tips: [
      "내용물을 비우고 물로 헹궈주세요.",
      "라벨(비닐)을 떼어 비닐류로 따로 버려주세요.",
      "찌그러뜨려 부피를 줄인 뒤 플라스틱 수거함에 넣어주세요.",
      "투명 페트병은 따로 모아 투명 페트병 수거함에 버려주세요.",
    ],
  },
  can: {
    name: "캔",
    icon: "🥫",
    tips: [
      "내용물을 비우고 물로 헹궈주세요.",
      "라벨(비닐)을 떼어 비닐류로 따로 버려주세요.",
      "찌그러뜨려 부피를 줄인 뒤 플라스틱 수거함에 넣어주세요.",
      "투명 페트병은 따로 모아 투명 페트병 수거함에 버려주세요.",
    ],
  },
  paper: {
    name: "종이",
    icon: "📦",
    tips: [
      "테이프, 스테이플러 심, 송장 스티커를 제거해주세요.",
      "물기 없이 펼치거나 접어서 묶어 종이 수거함에 버려주세요.",
      "종이컵·우유팩은 헹군 뒤 일반 종이와 따로 모아주세요.",
      "영수증, 코팅지, 오염된 종이는 일반쓰레기예요.",
    ],
  },
  general: {
    name: "일반쓰레기",
    icon: "🗑️",
    tips: [
      "재활용이 어려운 쓰레기예요.",
      "종량제 봉투에 담아 버려주세요.",
    ],
  },
  none: {
    name: "인식 중…",
    short: "없음",
    icon: "🔍",
    tips: ["쓰레기를 점선 안에 가까이 비춰주세요."],
  },
};

const $ = (id) => document.getElementById(id);
const video = $("video");
const crop = $("crop");
const cropCtx = crop.getContext("2d");

let model;
let labels = [];
let stream;
let facingMode = "environment";
let running = false;
let lastLabel = null;
let streak = 0;
let shownLabel = null;

$("startBtn").addEventListener("click", start);
$("flipBtn").addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  await openCamera();
});

async function start() {
  const btn = $("startBtn");
  btn.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("이 브라우저는 카메라를 지원하지 않아요. (https 또는 localhost에서 열어주세요)");
    }
    setStatus("모델 불러오는 중…");
    if (!model) {
      model = await tmImage.load(MODEL_URL + "model.json", MODEL_URL + "metadata.json");
      labels = model.getClassLabels();
      buildBars();
    }
    setStatus("카메라 켜는 중…");
    await openCamera();
    $("overlay").classList.add("hidden");
    $("flipBtn").hidden = false;
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }
  } catch (err) {
    console.error(err);
    setStatus(describeError(err));
    btn.disabled = false;
  }
}

function describeError(err) {
  if (location.protocol === "file:") {
    return "파일을 직접 열면 동작하지 않아요. 서버를 띄운 뒤 http://localhost:8000 으로 열어주세요.";
  }
  switch (err.name) {
    case "NotAllowedError":
      return "카메라 권한이 차단됐어요. 주소창 왼쪽 자물쇠 아이콘에서 카메라를 '허용'으로 바꾼 뒤 새로고침해주세요.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "사용할 수 있는 카메라를 찾지 못했어요.";
    case "NotReadableError":
      return "다른 프로그램(줌, 팀즈, 카메라 앱 등)이 카메라를 쓰고 있어요. 그 프로그램을 닫고 다시 시도해주세요.";
  }
  return `오류: ${err.message || err}`;
}

async function openCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 640 }, height: { ideal: 640 } },
    audio: false,
  });
  video.srcObject = stream;
  video.classList.toggle("mirror", facingMode === "user");
  await video.play();
}

async function loop() {
  if (video.readyState >= 2) {
    // 영상 가운데 정사각형을 잘라 224x224로 맞춘 뒤 예측
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    cropCtx.drawImage(video, sx, sy, size, size, 0, 0, crop.width, crop.height);
    const preds = await model.predict(crop);
    update(preds);
  }
  requestAnimationFrame(loop);
}

function update(preds) {
  updateBars(preds);

  const top = preds.reduce((a, b) => (b.probability > a.probability ? b : a));
  const label = top.probability >= THRESHOLD ? top.className : "none";

  streak = label === lastLabel ? streak + 1 : 1;
  lastLabel = label;
  if (streak < STABLE_FRAMES || label === shownLabel) {
    if (label === shownLabel && label !== "none") {
      $("confidence").textContent = `확신도 ${Math.round(top.probability * 100)}%`;
    }
    return;
  }

  shownLabel = label;
  const info = INFO[label] || { name: label, icon: "❔", tips: [] };
  $("result").className = `result ${label}`;
  $("icon").textContent = info.icon;
  $("label").textContent = info.name;
  $("confidence").textContent = label === "none" ? "" : `확신도 ${Math.round(top.probability * 100)}%`;
  $("tips").innerHTML = info.tips.map((t) => `<li>${t}</li>`).join("");
  if (label !== "none") navigator.vibrate?.(60);
}

function buildBars() {
  $("bars").innerHTML = labels
    .map(
      (l) => `<div class="bar">
        <span>${INFO[l]?.short || INFO[l]?.name || l}</span>
        <div class="bar-track"><div class="bar-fill" id="bar-${l}"></div></div>
        <span class="bar-val" id="val-${l}">0%</span>
      </div>`
    )
    .join("");
}

function updateBars(preds) {
  for (const p of preds) {
    const pct = Math.round(p.probability * 100);
    const fill = $(`bar-${p.className}`);
    if (fill) fill.style.width = pct + "%";
    const val = $(`val-${p.className}`);
    if (val) val.textContent = pct + "%";
  }
}

function setStatus(msg) {
  $("status").textContent = msg;
}
