const app = document.getElementById("app");
const params = new URLSearchParams(window.location.search);
const screen = params.get("screen") || "home";
const requestedStudentId = params.get("student") || "student-1";

let currentState = null;
let boardOverlay = { type: null, key: null, data: null, readyForNext: false, sceneState: null };
let strokeCanvas = null;

const assetManifest = {
  boardBackground: "/assets/background/battle.png",
  prepareBackground: "/assets/background/prepare.png",
  soundButton: "/assets/button/sound.png",
  retryButton: "/assets/button/retry.png"
  // successSound: "/assets/audio/success.mp3",
  // boardBgm: "/assets/audio/bgm.mp3"
};

const boardLevelLabels = {
  ga: "A",
  na: "B",
  da: "C"
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function currentMonster(student) {
  return student.monsters[student.currentMonsterIndex] || null;
}

function summaryTitle(name) {
  return name === "의찬" ? `${name}이의 몬스터들` : `${name}의 몬스터들`;
}

function isWaitingScreen(student, isActiveTurn) {
  return !isActiveTurn || student.status === "awaitingTeacher" || student.status === "complete";
}

function waitingMessage(student, isActiveTurn) {
  if (student.status === "complete") {
    return "차례를 기다려 주세요";
  }
  if (!isActiveTurn) {
    return "차례를 기다려 주세요";
  }
  if (student.status === "awaitingTeacher") {
    return "선생님이 확인하고 있어요";
  }
  return "";
}

function roundIndicators(monsters, currentIndex, capturedCount, mode) {
  return monsters
    .map((_, index) => {
      let stateClass = "";
      if (index < capturedCount) {
        stateClass = "is-past";
      } else if (index === currentIndex) {
        stateClass = "is-current";
      }
      return `<span class="round-indicator ${stateClass} ${mode === "player" ? "round-indicator--player" : ""}">${index + 1}</span>`;
    })
    .join("");
}

function ttsRead(text) {
  if (!("speechSynthesis" in window) || !text) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 0.82;
  window.speechSynthesis.speak(utterance);
}

function showBoardOverlay(result, sceneState) {
  if (screen !== "board" || !result) {
    return;
  }

  boardOverlay = {
    type: result.type,
    key: `${result.type}-${result.resolvedAt}`,
    data: result,
    readyForNext: false,
    sceneState: sceneState || null
  };

  if (result.type === "success") {
    window.setTimeout(() => {
      if (boardOverlay.key === `${result.type}-${result.resolvedAt}`) {
        boardOverlay.readyForNext = true;
        render(currentState);
      }
    }, 1700);
    return;
  }

  window.setTimeout(() => {
    if (boardOverlay.key === `${result.type}-${result.resolvedAt}`) {
      boardOverlay = { type: null, key: null, data: null, readyForNext: false, sceneState: null };
      render(currentState);
    }
  }, 1200);
}

function renderHome() {
  app.innerHTML = `
    <main class="layout intro-layout">
      <section class="intro-screen">
        <div class="intro-screen__backdrop" style="background-image: url('${assetManifest.prepareBackground}');"></div>
        <div class="intro-screen__overlay"></div>
        <div class="intro-screen__content">
          <h1 class="title-display">숫자 몬스터 잡기</h1>
          <div class="home-starters">
            <button class="home-starter" type="button" data-student-start="student-1">수호</button>
            <button class="home-starter" type="button" data-student-start="student-2">의찬</button>
            <button class="home-starter" type="button" data-student-start="student-3">지후</button>
          </div>
        </div>
      </section>
    </main>
  `;

  app.querySelectorAll("[data-student-start]").forEach((button) => {
    button.addEventListener("click", async () => {
      await postJson("/api/teacher/action", {
        action: "setActiveStudent",
        studentId: button.dataset.studentStart
      });
      window.location.search = "?screen=board";
    });
  });
}

function boardOverlayMarkup() {
  if (boardOverlay.type === "success") {
    const throwData = boardOverlay.data || {};
    const activeStudent = currentState ? currentState.students[currentState.activeStudentId] : null;
    const isLastRound = activeStudent ? activeStudent.captured.length >= 3 : false;
    return `
      <div class="board-overlay board-overlay--success">
        <div class="board-capture-scene ${boardOverlay.readyForNext ? "is-frozen" : ""}">
          <div class="board-capture-scene__monster ${boardOverlay.readyForNext ? "is-frozen" : ""}">
            <img src="${escapeHtml(throwData.monsterAsset || "")}" alt="사라지는 몬스터" onerror="this.style.display='none'; this.parentElement.classList.add('is-fallback');" />
            <span class="board-capture-scene__monster-fallback">몬스터</span>
          </div>
          <div class="board-capture-scene__ball ui-ball ui-ball--overlay ${boardOverlay.readyForNext ? "is-frozen" : ""}">
            ${renderBallFace(throwData.value || "?", throwData.imageData)}
          </div>
          <div class="board-capture-scene__label ${boardOverlay.readyForNext ? "is-frozen" : ""}">잡았다!</div>
          ${boardOverlay.readyForNext ? `<button class="next-monster-button" type="button" id="next-monster-button">${isLastRound ? "잡은 몬스터들 보기" : "다음 몬스터 만나기"}</button>` : ""}
        </div>
      </div>
    `;
  }

  if (boardOverlay.type === "retry") {
    return `
      <div class="board-overlay board-overlay--retry">
        <div class="board-overlay__label">다시 던져 보세요</div>
      </div>
    `;
  }

  return "";
}

function renderBoardSummary(student) {
  app.innerHTML = `
    <main class="layout board-game">
      <section class="summary-screen summary-screen--board" id="board-summary-screen">
        <div class="summary-screen__backdrop" style="background-image: url('${assetManifest.boardBackground}');"></div>
        <div class="summary-screen__overlay"></div>
        <div class="summary-screen__content">
          <h1 class="title-display title-display--summary">${escapeHtml(summaryTitle(student.label))}</h1>
          <div class="summary-grid">
            ${student.captured.map((monster) => renderSummaryMonster(monster)).join("")}
          </div>
        </div>
      </section>
    </main>
  `;

  document.getElementById("board-summary-screen").addEventListener("click", () => {
    window.location.search = "/";
  });
}

function renderBoard(state) {
  const displayState = boardOverlay.type === "success" && boardOverlay.sceneState ? boardOverlay.sceneState : state;
  const activeStudent = displayState.students[displayState.activeStudentId];
  const monster = currentMonster(activeStudent);
  const throwInfo = activeStudent.pendingThrow || activeStudent.previewThrow || activeStudent.lastThrow;

  if (activeStudent.status === "complete" && boardOverlay.type !== "success") {
    renderBoardSummary(activeStudent);
    return;
  }

  app.innerHTML = `
    <main class="layout board-game">
      <section class="board-scene">
        <div class="board-scene__backdrop" style="background-image: url('${assetManifest.boardBackground}');"></div>
        ${boardOverlayMarkup()}

        <div class="board-playfield ${boardOverlay.type === "success" ? "is-hidden" : ""}">
        <div class="board-rounds">
          ${roundIndicators(activeStudent.monsters, activeStudent.currentMonsterIndex, activeStudent.captured.length, "board")}
        </div>

        <div class="board-top-right">
          <button class="icon-button" type="button" id="sound-button" ${monster ? "" : "disabled"}>
            <img src="${assetManifest.soundButton}" alt="읽어주기" onerror="this.style.display='none'; this.parentElement.classList.add('is-fallback');" />
            <span class="icon-button__fallback">소리</span>
          </button>
          <button class="icon-button" type="button" data-action="retryThrow" data-student="${activeStudent.id}" ${activeStudent.pendingThrow ? "" : "disabled"}>
            <img src="${assetManifest.retryButton}" alt="다시하기" onerror="this.style.display='none'; this.parentElement.classList.add('is-fallback');" />
            <span class="icon-button__fallback">다시</span>
          </button>
        </div>

        <div class="board-level-switch">
          ${[
            ["ga", "A"],
            ["na", "B"],
            ["da", "C"]
          ]
            .map(
              ([level, label]) => `
                <button class="ghost-text-button ${activeStudent.level === level ? "is-current" : ""}" type="button" data-action="setLevel" data-student="${activeStudent.id}" data-level="${level}">
                  ${label}
                </button>
              `
            )
            .join("")}
        </div>

        ${
          monster
            ? `
              <button class="board-monster ${activeStudent.pendingThrow ? "is-awaiting-check" : ""}" type="button" id="monster-confirm" ${
                activeStudent.pendingThrow ? "" : "disabled"
              }>
                <img src="${escapeHtml(monster.monsterAsset)}" alt="몬스터" onerror="this.style.display='none'; this.parentElement.classList.add('is-fallback');" />
                <span class="board-monster__fallback">몬스터</span>
              </button>
            `
            : ""
        }

        ${
          monster
            ? `
              <div class="speech-bubble">
                <span>${escapeHtml(monster.label)}</span>
              </div>
            `
            : ""
        }

        <div class="board-ball-zone">
          <div class="ui-ball ui-ball--board ${activeStudent.pendingThrow ? "is-throwing" : ""}">
            ${renderBallFace(throwInfo && throwInfo.value ? throwInfo.value : "?", throwInfo && throwInfo.imageData ? throwInfo.imageData : null)}
          </div>
        </div>
        </div>
      </section>
    </main>
  `;

  const soundButton = document.getElementById("sound-button");
  const monsterButton = document.getElementById("monster-confirm");
  const nextMonsterButton = document.getElementById("next-monster-button");

  if (soundButton && monster) {
    soundButton.addEventListener("click", () => ttsRead(monster.label));
  }

  if (monsterButton) {
    monsterButton.addEventListener("click", async () => {
      if (!activeStudent.pendingThrow) {
        return;
      }

      await postJson("/api/teacher/action", {
        action: "markCorrect",
        studentId: activeStudent.id
      });
    });
  }

  if (nextMonsterButton) {
    nextMonsterButton.addEventListener("click", () => {
      boardOverlay = { type: null, key: null, data: null, readyForNext: false, sceneState: null };
      render(currentState);
    });
  }

  app.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await postJson("/api/teacher/action", {
        action: button.dataset.action,
        studentId: button.dataset.student,
        level: button.dataset.level
      });
    });
  });
}

function renderWaitingPlayer(student, isActiveTurn) {
  app.innerHTML = `
    <main class="layout waiting-layout">
      <section class="waiting-screen">
        <div class="waiting-screen__backdrop" style="background-image: url('${assetManifest.prepareBackground}');"></div>
        <div class="waiting-screen__veil"></div>
        <div class="waiting-screen__content">
          <h1 class="title-display title-display--waiting">${escapeHtml(waitingMessage(student, isActiveTurn))}</h1>
        </div>
      </section>
    </main>
  `;
}

function renderPlayerIntro(student) {
  app.innerHTML = `
    <main class="layout intro-layout">
      <section class="intro-screen">
        <div class="intro-screen__backdrop" style="background-image: url('${assetManifest.prepareBackground}');"></div>
        <div class="intro-screen__overlay"></div>
        <div class="intro-screen__content">
          <h1 class="title-display">숫자 몬스터 잡기</h1>
          <div class="home-starters">
            <button class="home-starter" type="button" id="student-start-button">시작하기</button>
          </div>
        </div>
      </section>
    </main>
  `;

  document.getElementById("student-start-button").addEventListener("click", async () => {
    await postJson("/api/student/start", { studentId: student.id });
  });
}

function renderSummaryMonster(monster) {
  return `
    <div class="summary-monster-card">
      <img src="${escapeHtml(monster.monsterAsset)}" alt="${escapeHtml(monster.label)} 몬스터" onerror="this.style.display='none'; this.parentElement.classList.add('is-fallback');" />
      <span class="summary-monster-card__fallback">${escapeHtml(monster.label)}</span>
    </div>
  `;
}

function renderPlayerSummary(student) {
  app.innerHTML = `
    <main class="layout player-game">
      <section class="summary-screen summary-screen--player">
        <div class="summary-screen__backdrop" style="background-image: url('${assetManifest.prepareBackground}');"></div>
        <div class="summary-screen__overlay"></div>
        <div class="summary-screen__content">
          <h1 class="title-display title-display--summary">${escapeHtml(summaryTitle(student.label))}</h1>
          <div class="summary-grid">
            ${student.captured.map((monster) => renderSummaryMonster(monster)).join("")}
          </div>
        </div>
      </section>
    </main>
  `;
}

function renderPlayer(state) {
  const student = state.students[requestedStudentId];
  if (!student) {
    app.innerHTML = `<main class="layout"><div class="missing">학생 정보를 찾을 수 없어요.</div></main>`;
    return;
  }

  const monster = currentMonster(student);
  const isActiveTurn = state.activeStudentId === student.id;

  if (student.status === "complete") {
    renderPlayerSummary(student);
    return;
  }

  if (isActiveTurn && !student.hasStartedTurn) {
    renderPlayerIntro(student);
    return;
  }

  if (isWaitingScreen(student, isActiveTurn)) {
    renderWaitingPlayer(student, isActiveTurn);
    return;
  }

  app.innerHTML = `
    <main class="layout player-game">
      <section class="player-scene">
        <div class="player-scene__backdrop" style="background-image: url('${assetManifest.prepareBackground}');"></div>
        <div class="player-scene__overlay"></div>
        <div class="player-rounds">
          ${roundIndicators(student.monsters, student.currentMonsterIndex, student.captured.length, "player")}
        </div>

        <div class="player-instruction">
          ${
            student.level === "ga"
              ? "몬스터볼에 숫자를 적고 던져 보세요."
              : student.level === "na"
                ? "서로 다른 몬스터볼 3개 중에서 하나를 고른 뒤 던져요."
                : "준비된 몬스터볼을 던져 보세요."
          }
        </div>

        <form id="throw-form" class="player-throw-layout">
          ${renderBallControls(student, monster)}
          ${student.level === "ga" ? "" : '<button class="launch-button launch-button--side" type="submit">던지기</button>'}
        </form>
      </section>
    </main>
  `;

  const form = document.getElementById("throw-form");
  if (!form) {
    return;
  }

  if (student.level === "na") {
    const hiddenValue = form.querySelector('input[name="throwValue"]');
    const optionButtons = form.querySelectorAll("[data-ball]");

    optionButtons.forEach((button) => {
      button.addEventListener("click", async () => {
        const wasSelected = button.classList.contains("is-selected");
        optionButtons.forEach((item) => item.classList.remove("is-selected"));
        hiddenValue.value = "";

        if (!wasSelected) {
          button.classList.add("is-selected");
          hiddenValue.value = button.dataset.ball;
        }

        await postJson("/api/student/preview", {
          studentId: student.id,
          value: hiddenValue.value,
          imageData: null
        });
      });
    });
  }

  if (student.level === "ga") {
    initHandwritingPad(form, student.id);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const valueInput = form.querySelector('input[name="throwValue"]');
    const imageInput = form.querySelector('input[name="throwImage"]');
    const value = valueInput ? valueInput.value.trim() : "";
    const imageData = imageInput ? imageInput.value : "";

    if (!value && !imageData) {
      window.alert("먼저 몬스터볼을 고르거나 숫자를 적어 주세요.");
      return;
    }

    const response = await postJson("/api/student/throw", {
      studentId: student.id,
      value: value || "손글씨",
      imageData: imageData || null
    });

    if (!response.ok && response.error) {
      window.alert(response.error);
    }
  });
}

function renderBallControls(student, monster) {
  if (!monster) {
    return "";
  }

  if (student.level === "da") {
    return `
      <div class="player-ball-panel">
        <button class="ui-ball ui-ball--choice ui-ball--selected ui-ball--single ui-ball--single-big" type="button" disabled>
          <span>${escapeHtml(monster.numeral)}</span>
        </button>
        <input type="hidden" name="throwValue" value="${escapeHtml(monster.numeral)}" />
      </div>
    `;
  }

  if (student.level === "na") {
    return `
      <div class="player-ball-panel player-ball-panel--row">
        ${monster.choiceBalls
          .map(
            (option) => `
              <button class="ui-ball ui-ball--choice ${student.previewThrow && student.previewThrow.value === option.numeral ? "is-selected" : ""}" type="button" data-ball="${escapeHtml(option.numeral)}">
                <span>${escapeHtml(option.numeral)}</span>
              </button>
            `
          )
          .join("")}
        <input type="hidden" name="throwValue" value="${escapeHtml(student.previewThrow && student.previewThrow.value ? student.previewThrow.value : "")}" />
      </div>
    `;
  }

  return `
    <div class="player-ball-panel player-ball-panel--handwriting">
      <div class="handwriting-ball-shell">
        <div class="ui-ball ui-ball--handwriting">
          <canvas class="handwriting-canvas" width="280" height="280"></canvas>
        </div>
      </div>
      <div class="handwriting-actions">
        <button class="secondary-action" type="button" data-action="rewrite-handwriting">다시 쓰기</button>
        <button class="secondary-action" type="button" data-action="complete-handwriting">완성하기</button>
        <button class="launch-button launch-button--inline" type="submit">던지기</button>
      </div>
      <input type="hidden" name="throwValue" value="${escapeHtml(student.previewThrow && student.previewThrow.value ? student.previewThrow.value : "")}" />
      <input type="hidden" name="throwImage" value="${escapeHtml(student.previewThrow && student.previewThrow.imageData ? student.previewThrow.imageData : "")}" />
    </div>
  `;
}

function renderBallFace(value, imageData) {
  if (imageData) {
    return `<img class="ui-ball__drawing" src="${escapeHtml(imageData)}" alt="손글씨 몬스터볼" />`;
  }

  return `<span>${escapeHtml(value)}</span>`;
}

function initHandwritingPad(form, studentId) {
  const canvas = form.querySelector(".handwriting-canvas");
  const ctx = canvas.getContext("2d");
  const hiddenValue = form.querySelector('input[name="throwValue"]');
  const hiddenImage = form.querySelector('input[name="throwImage"]');
  const rewriteButton = form.querySelector('[data-action="rewrite-handwriting"]');
  const completeButton = form.querySelector('[data-action="complete-handwriting"]');

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "#25180f";

  let drawing = false;

  function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hiddenValue.value = "";
    hiddenImage.value = "";
  }

  function restorePreviewImage() {
    if (!hiddenImage.value) {
      return;
    }
    const image = new Image();
    image.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = hiddenImage.value;
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  }

  function startDraw(event) {
    drawing = true;
    const point = pointerPosition(event);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
  }

  function moveDraw(event) {
    if (!drawing) {
      return;
    }
    const point = pointerPosition(event);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }

  function endDraw() {
    drawing = false;
  }

  canvas.addEventListener("pointerdown", startDraw);
  canvas.addEventListener("pointermove", moveDraw);
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointerleave", endDraw);

  rewriteButton.addEventListener("click", async () => {
    clearCanvas();
    await postJson("/api/student/preview", {
      studentId,
      value: "",
      imageData: null
    });
  });

  completeButton.addEventListener("click", async () => {
    hiddenValue.value = "손글씨";
    hiddenImage.value = canvas.toDataURL("image/png");
    await postJson("/api/student/preview", {
      studentId,
      value: hiddenValue.value,
      imageData: hiddenImage.value
    });
  });

  restorePreviewImage();
  strokeCanvas = { clearCanvas };
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return response.json();
}

function render(state) {
  currentState = state;

  if (screen === "home") {
    renderHome();
    return;
  }

  if (screen === "player") {
    renderPlayer(state);
    return;
  }

  renderBoard(state);
}

async function bootstrap() {
  const initial = await fetch("/api/state").then((response) => response.json());
  render(initial);

  const events = new EventSource("/events");
  events.onmessage = (event) => {
    const nextState = JSON.parse(event.data);
    const previousResolvedAt = currentState && currentState.lastResolvedThrow ? currentState.lastResolvedThrow.resolvedAt : null;
    if (screen === "board" && nextState.lastResolvedThrow && nextState.lastResolvedThrow.resolvedAt !== previousResolvedAt) {
      showBoardOverlay(nextState.lastResolvedThrow, currentState);
    }

    render(nextState);
  };
}

bootstrap();
