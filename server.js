const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");

const numberPool = [
  { numeral: "1", read: "일", alt: "하나" },
  { numeral: "2", read: "이", alt: "둘" },
  { numeral: "3", read: "삼", alt: "셋" },
  { numeral: "4", read: "사", alt: "넷" },
  { numeral: "5", read: "오", alt: "다섯" },
  { numeral: "6", read: "육", alt: "여섯" },
  { numeral: "7", read: "칠", alt: "일곱" },
  { numeral: "8", read: "팔", alt: "여덟" },
  { numeral: "9", read: "구", alt: "아홉" }
];

const monsterAssets = Array.from({ length: 9 }, (_, index) => `/assets/monsters/monster${index + 1}.webp`);
const ballAssets = Array.from({ length: 9 }, (_, index) => `/assets/balls/ball${index + 1}.webp`);

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function sampleUnique(items, count) {
  return shuffle(items).slice(0, count);
}

function buildChoices(answer) {
  const allNumerals = numberPool.map((item) => item.numeral);
  const wrongChoices = sampleUnique(
    allNumerals.filter((numeral) => numeral !== answer),
    2
  );
  const choiceAssets = sampleUnique(ballAssets, 3);

  return shuffle([answer, ...wrongChoices]).map((numeral, index) => ({
    numeral,
    ballAsset: choiceAssets[index]
  }));
}

function createMonster(item, index, monsterAsset, throwBallAsset) {
  return {
    id: `monster-slot-${index + 1}`,
    numeral: item.numeral,
    label: index % 2 === 0 ? item.read : item.alt,
    readText: item.read,
    altReadText: item.alt,
    monsterAsset,
    throwBallAsset,
    choiceBalls: []
  };
}

function attachChoiceBalls(monsterList) {
  return monsterList.map((monster) => ({
    ...monster,
    choiceBalls: buildChoices(monster.numeral)
  }));
}

function createStudent(id, label, level) {
  const chosenNumbers = sampleUnique(numberPool, 3);
  const chosenMonsterAssets = sampleUnique(monsterAssets, 3);
  const chosenThrowBallAssets = sampleUnique(ballAssets, 3);
  const monsters = attachChoiceBalls(
    chosenNumbers.map((item, index) => createMonster(item, index, chosenMonsterAssets[index], chosenThrowBallAssets[index]))
  );

  return {
    id,
    label,
    level,
    turnLocked: true,
    status: "waiting",
    hasStartedTurn: false,
    monsters,
    currentMonsterIndex: 0,
    captured: [],
    previewThrow: null,
    lastThrow: null,
    pendingThrow: null
  };
}

function createInitialState() {
  return {
    activeStudentId: "student-1",
    boardMessage: "학생이 태블릿에서 몬스터볼을 고르고 던지면 여기에 표시됩니다.",
    lastResolvedThrow: null,
    students: {
      "student-1": createStudent("student-1", "수호", "ga"),
      "student-2": createStudent("student-2", "의찬", "na"),
      "student-3": createStudent("student-3", "지후", "da")
    }
  };
}

let state = createInitialState();
const clients = new Set();

function getStudent(studentId) {
  return state.students[studentId];
}

function syncTurnLocks() {
  Object.values(state.students).forEach((student) => {
    if (student.id === state.activeStudentId) {
      if (student.captured.length >= 3) {
        student.turnLocked = true;
        student.status = "complete";
      } else if (!student.hasStartedTurn) {
        student.turnLocked = true;
        student.status = "intro";
      } else if (student.pendingThrow) {
        student.turnLocked = true;
        student.status = "awaitingTeacher";
      } else {
        student.turnLocked = false;
        student.status = "ready";
      }
      return;
    }

    student.turnLocked = true;
    student.status = student.captured.length >= 3 ? "complete" : "waiting";
  });
}

function getCurrentMonster(student) {
  return student.monsters[student.currentMonsterIndex] || null;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function broadcast() {
  syncTurnLocks();
  const payload = `data: ${JSON.stringify(state)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function updateBoardMessage(message) {
  state.boardMessage = message;
}

function handleStudentPreview(body, res) {
  const { studentId, value, imageData } = body;
  const student = getStudent(studentId);

  if (!student) {
    return sendJson(res, 404, { error: "Student not found" });
  }

  syncTurnLocks();

  if (student.id !== state.activeStudentId || student.turnLocked) {
    return sendJson(res, 409, { error: "Turn is locked" });
  }

  student.previewThrow = value || imageData
    ? {
        value: String(value || "").trim(),
        imageData: imageData || null
      }
    : null;
  broadcast();
  return sendJson(res, 200, { ok: true });
}

function handleStudentStart(body, res) {
  const { studentId } = body;
  const student = getStudent(studentId);

  if (!student) {
    return sendJson(res, 404, { error: "Student not found" });
  }

  if (student.id !== state.activeStudentId) {
    return sendJson(res, 409, { error: "Turn is locked" });
  }

  student.hasStartedTurn = true;
  student.status = "ready";
  updateBoardMessage(`${student.label} 차례를 시작합니다.`);
  broadcast();
  return sendJson(res, 200, { ok: true });
}

function handleStudentThrow(body, res) {
  const { studentId, value, ballAsset, imageData } = body;
  const student = getStudent(studentId);

  if (!student) {
    return sendJson(res, 404, { error: "Student not found" });
  }

  syncTurnLocks();

  if (student.id !== state.activeStudentId || student.turnLocked) {
    return sendJson(res, 409, { error: "Turn is locked" });
  }

  const monster = getCurrentMonster(student);
  const sanitizedValue = String(value || "").trim();
  if (!sanitizedValue || !monster) {
    return sendJson(res, 400, { error: "Throw value is required" });
  }

  student.pendingThrow = {
    value: sanitizedValue,
    ballAsset: ballAsset || monster.throwBallAsset,
    imageData: imageData || null,
    thrownAt: Date.now()
  };
  student.previewThrow = null;
  student.lastThrow = student.pendingThrow;
  state.lastResolvedThrow = null;
  student.status = "awaitingTeacher";
  updateBoardMessage(`${student.label}이(가) ${sanitizedValue} 몬스터볼을 던졌습니다.`);
  broadcast();

  return sendJson(res, 200, { ok: true });
}

function handleTeacherAction(body, res) {
  const { action, studentId, level } = body;

  if (action === "setActiveStudent") {
    if (!getStudent(studentId)) {
      return sendJson(res, 404, { error: "Student not found" });
    }
    state.activeStudentId = studentId;
    state.lastResolvedThrow = null;
    updateBoardMessage(`${state.students[studentId].label} 차례입니다.`);
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (action === "setLevel") {
    const student = getStudent(studentId);
    if (!student) {
      return sendJson(res, 404, { error: "Student not found" });
    }
    student.level = level;
    updateBoardMessage(`${student.label}의 수준을 변경했습니다.`);
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (action === "retryThrow") {
    const student = getStudent(studentId);
    if (!student) {
      return sendJson(res, 404, { error: "Student not found" });
    }
    state.lastResolvedThrow = {
      type: "retry",
      studentId,
      resolvedAt: Date.now(),
      value: student.pendingThrow?.value || student.lastThrow?.value || "",
      ballAsset: student.pendingThrow?.ballAsset || student.lastThrow?.ballAsset || ""
      ,
      imageData: student.pendingThrow?.imageData || student.lastThrow?.imageData || null
    };
    student.previewThrow = null;
    student.pendingThrow = null;
    student.status = "ready";
    updateBoardMessage(`${student.label}이(가) 다시 던질 준비를 합니다.`);
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (action === "markCorrect") {
    const student = getStudent(studentId);
    if (!student) {
      return sendJson(res, 404, { error: "Student not found" });
    }
    const monster = getCurrentMonster(student);
    if (!monster) {
      return sendJson(res, 400, { error: "No monster left" });
    }

    const resolvedThrow = {
      type: "success",
      studentId,
      resolvedAt: Date.now(),
      value: student.pendingThrow ? student.pendingThrow.value : student.lastThrow?.value || "",
      ballAsset: student.pendingThrow ? student.pendingThrow.ballAsset : student.lastThrow?.ballAsset || monster.throwBallAsset,
      monsterAsset: monster.monsterAsset,
      imageData: student.pendingThrow ? student.pendingThrow.imageData : student.lastThrow?.imageData || null
    };

    student.captured.push({
      ...monster,
      capturedAt: resolvedThrow.resolvedAt,
      thrownValue: resolvedThrow.value,
      ballAsset: resolvedThrow.ballAsset
    });
    student.currentMonsterIndex += 1;
    student.previewThrow = null;
    student.pendingThrow = null;
    student.lastThrow = null;
    state.lastResolvedThrow = resolvedThrow;

    if (student.currentMonsterIndex >= student.monsters.length) {
      student.status = "complete";
      updateBoardMessage(`${student.label}이(가) 몬스터 3마리를 모두 잡았습니다.`);
    } else {
      student.status = "ready";
      updateBoardMessage(`${student.label}이(가) 정답! 다음 몬스터로 넘어갑니다.`);
    }

    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (action === "resetStudent") {
    const current = getStudent(studentId);
    if (!current) {
      return sendJson(res, 404, { error: "Student not found" });
    }
    const replacement = createStudent(current.id, current.label, current.level);
    state.students[studentId] = replacement;
    state.lastResolvedThrow = null;
    updateBoardMessage(`${replacement.label}의 게임을 다시 시작했습니다.`);
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  if (action === "resetAll") {
    state = createInitialState();
    updateBoardMessage("새 게임을 시작했습니다.");
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 400, { error: "Unknown action" });
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".svg": "image/svg+xml"
    };

    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

syncTurnLocks();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);

    req.on("close", () => {
      clients.delete(res);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    syncTurnLocks();
    return sendJson(res, 200, state);
  }

  if (req.method === "POST" && url.pathname === "/api/student/throw") {
    try {
      const body = await parseBody(req);
      return handleStudentThrow(body, res);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/student/preview") {
    try {
      const body = await parseBody(req);
      return handleStudentPreview(body, res);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/student/start") {
    try {
      const body = await parseBody(req);
      return handleStudentStart(body, res);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/teacher/action") {
    try {
      const body = await parseBody(req);
      return handleTeacherAction(body, res);
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const safePath = path.normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  serveFile(filePath, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Number Monster server listening on http://${HOST}:${PORT}`);
});
