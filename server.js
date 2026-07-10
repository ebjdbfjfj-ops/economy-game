/**
 * ============================================================
 *  마을 경제 게임 - 멀티플레이 서버 (server.js)
 * ============================================================
 *  - Node.js + Express + Socket.IO
 *  - 방 생성/참가, 대기실, 역할 랜덤 배정, 라운드 진행,
 *    상점/은행/정부/기자 시스템, 실시간 로그, 개인채팅, 송금 등을
 *    전부 서버에서 계산/관리합니다.
 *  - 클라이언트는 오직 "화면 표시(UI)"만 담당하고,
 *    돈 계산 / 세금 계산 / 승리 판정 / 라운드 종료는
 *    전부 이 파일에서 처리합니다.
 * ============================================================
 */

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling'] // 다양한 네트워크 환경 접속 지원
});

const PORT = process.env.PORT || 3000;

// 정적 파일(프론트엔드) 서빙 - /public 폴더 안의 index.html, style.css, client.js
app.use(express.static(path.join(__dirname, "public")));

/* ============================================================
 *  게임 상수 정의 (기존 HTML의 로직을 그대로 서버로 이식)
 * ============================================================
 */

// 5개의 고정 역할 (게임 시작 시 중복 없이 랜덤 배정)
const ROLE_NAMES = ["학생", "상점 주인", "기자", "은행원", "정부"];

const ROLE_INFO = {
  "학생": {
    icon: "🎒",
    abilities: ["저축/투자", "대출", "물건 거래(사기/팔기)", "개인챗"],
    goal: "돈을 가장 많이 모으기 (180만원 달성시 우승)",
  },
  "상점 주인": {
    icon: "🏪",
    abilities: ["물건 가격 변동", "저축/투자", "대출", "개인챗"],
    goal: "수요 파악을 통한 최대 이윤 남기기 (물품 30개 판매시 우승)",
  },
  "기자": {
    icon: "📰",
    abilities: ["기사 작성(라운드당 1회)", "정보 거래", "물건 거래", "저축/투자", "대출"],
    goal: "기사를 써서 신뢰도 80점 달성하기 (좋아요당 +3점)",
  },
  "은행원": {
    icon: "💼",
    abilities: ["예금/대출 금리 설정", "물건 거래(사기/팔기)", "주식 투자", "개인챗"],
    goal: "2등 자산의 3배 이상 돈 모으기",
  },
  "정부": {
    icon: "🏛",
    abilities: ["세금 조정", "규제/긴급정책 발표", "대국민 담화(전체 메시지)", "개인챗"],
    goal: "경제 상황 통제 및 파악 (1명이라도 파산시키면 우승)",
  },
};

// 상점에서 취급하는 물품 목록 (원본 HTML의 allItemsList 그대로)
const ALL_ITEMS_LIST = [
  { name: "생필품 꾸러미", basePrice: 10 },
  { name: "사치품(가방/시계)", basePrice: 15 },
  { name: "비상식량(빵)", basePrice: 12 },
  { name: "최신 스마트 기기", basePrice: 20 },
  { name: "공기청정기", basePrice: 18 },
  { name: "생수", basePrice: 5 },
  { name: "마스크", basePrice: 3 },
  { name: "우산", basePrice: 7 },
  { name: "고급 운동화", basePrice: 10 },
  { name: "전공 서적", basePrice: 8 },
];

// 매 라운드 등장하는 경제 상황 카드 (원본 HTML의 allSituations 그대로)
const ALL_SITUATIONS = [
  {
    desc: "중앙은행이 강력한 긴축 통화정책을 발표했습니다. 시중 유동성을 흡수하기 위해 기준금리를 20%로 전격 인상했습니다.",
    summary: "강력한 긴축 통화정책 (기준금리 20% 인상)",
    hints: [
      "화폐의 시간가치가 급상승하여 잉여 자본이 예금 시장으로 흡수되고 있습니다.",
      "차입 자본에 의존하는 한계기업들의 연쇄 부도 리스크가 커지며, 주식 시장의 리스크 프리미엄이 폭등 중입니다.",
    ],
    interestRate: 0.20,
    stockTendency: -0.3,
    itemName: "생필품 꾸러미",
    penalty: 20,
  },
  {
    desc: "정부의 확장적 재정정책으로 인해 대규모 보조금이 시장에 직접 살포되었습니다. M2 통화량이 급격히 팽창하고 있습니다.",
    summary: "확장적 재정정책 (시중 유동성 급증)",
    hints: [
      "명목화폐의 가치 하락(인플레이션 조짐)으로 인해 실물 자산 및 사치재에 대한 헤지(Hedge) 수요가 급증하고 있습니다.",
      "유동성 장세가 펼쳐지며 위험자산(주식)에 대한 투자 심리가 단기적으로 과열 양상을 보일 확률이 높습니다.",
    ],
    interestRate: 0.03,
    stockTendency: 0.4,
    itemName: "사치품(가방/시계)",
    penalty: 15,
  },
  {
    desc: "주요 작물 수출국들의 심각한 기후 이변으로 작황이 크게 감소하여 거시적인 부정적 공급 충격(Supply Shock)이 발생했습니다.",
    summary: "부정적 공급 충격 (스태그플레이션 우려)",
    hints: [
      "원자재 수입 의존도가 높은 필수 식료품의 한계생산비용이 급증하여 해당 재화의 공급 곡선이 좌측으로 이동하고 있습니다.",
      "필수재 특성상 수요의 가격탄력성이 비탄력적이므로, 원가 상승분이 소비자 가격에 그대로 전가될 가능성이 농후합니다.",
    ],
    interestRate: 0.05,
    stockTendency: 0.1,
    itemName: "비상식량(빵)",
    penalty: 25,
  },
  {
    desc: "범용 인공지능(AGI)의 상용화로 인해 글로벌 투자 자본이 특정 IT 섹터로 심각하게 쏠리는 현상(Crowding-out)이 발생했습니다.",
    summary: "파괴적 혁신 기술 상용화 (섹터 쏠림 및 변동성 심화)",
    hints: [
      "해당 혁신 산업 관련 밸류체인의 전방 수요가 폭발적으로 증가하며 과도한 펀더멘털 프리미엄이 형성되었습니다.",
      "투기적 수요가 가세하여 금융 시장의 하이 리스크-하이 리턴 경향이 뚜렷해졌으며, 극심한 변동폭 장세에 대비해야 합니다.",
    ],
    interestRate: 0.04,
    stockTendency: 0.6,
    itemName: "최신 스마트 기기",
    penalty: 10,
  },
  {
    desc: "정부가 외부불경제(Negative Externality)를 내부화하기 위해 시장에 징벌적 성격의 피구세(Pigouvian Tax)인 탄소배출세를 도입했습니다.",
    summary: "외부효과 내부화 (징벌적 탄소세 도입)",
    hints: [
      "공해 유발 산업의 사적 한계비용(PMC)이 사회적 한계비용(SMC) 수준으로 강제 상승하며 전반적인 생산의 위축이 불가피합니다.",
      "친환경 대체재 성격을 띠는 품목에 대한 대체효과(Substitution Effect)가 발생하여 수요 곡선이 급격히 우측으로 이동할 것입니다.",
    ],
    interestRate: 0.07,
    stockTendency: -0.2,
    itemName: "공기청정기",
    penalty: 30,
  },
];

const MAX_PLAYERS = 5;
const STARTING_MONEY = 100;
const STARTING_CREDIBILITY = 50;

/* ============================================================
 *  전역 상태: 방(rooms) 저장소
 * ============================================================
 *  rooms[roomCode] = { ... 방 하나의 전체 상태 ... }
 */
const rooms = {};

/* ============================================================
 *  유틸리티 함수
 * ============================================================
 */

// 배열 셔플 (Fisher-Yates)
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 중복되지 않는 6자리 방번호 생성
function generateRoomCode() {
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms[code]);
  return code;
}

// 방 코드로 방 가져오기 (없으면 null)
function getRoom(roomCode) {
  return rooms[roomCode] || null;
}

// 소켓 id로 현재 속한 방과 플레이어를 함께 찾기
function findRoomAndPlayerBySocket(socketId) {
  for (const roomCode in rooms) {
    const room = rooms[roomCode];
    if (room.players[socketId]) {
      return { room, player: room.players[socketId] };
    }
  }
  return { room: null, player: null };
}

// 특정 역할을 맡은 플레이어 찾기
function findPlayerByRole(room, roleName) {
  return Object.values(room.players).find((p) => p.role === roleName) || null;
}

// 방의 실시간 로그를 모든 참가자에게 전송 (원본의 addLog() 대체)
function broadcastLog(room, roleName, message, color = null) {
  io.to(room.roomCode).emit("logUpdate", {
    roleName,
    message,
    color,
    timestamp: Date.now(),
  });
}

// 개별 플레이어에게 자신의 상세 상태(돈, 인벤토리 등) 전송
function sendPrivateStatus(socketId, room, player) {
  io.to(socketId).emit("moneyUpdate", {
    money: player.money,
    credibility: player.credibility,
    savedMoney: player.savedMoney,
    loanedMoney: player.loanedMoney,
    investedMoney: player.investedMoney,
    inventory: player.inventory,
    role: player.role,
    alive: player.alive,
  });
}

// 방에 있는 모든 플레이어에게 각자의 개인 상태 전송
function broadcastAllPrivateStatus(room) {
  Object.entries(room.players).forEach(([socketId, player]) => {
    sendPrivateStatus(socketId, room, player);
  });
}

// 방의 공용 정보(대기실/공용 경제 지표 등)를 모두에게 전송
function broadcastRoomState(room) {
  const publicPlayers = Object.values(room.players).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    role: p.role,
    roleIcon: p.role ? ROLE_INFO[p.role].icon : null,
    ready: p.ready,
    readyForNextRound: p.readyForNextRound,
    alive: p.alive,
    isHost: p.id === room.host,
  }));

  io.to(room.roomCode).emit("roomUpdate", {
    roomCode: room.roomCode,
    host: room.host,
    gameStarted: room.gameStarted,
    round: room.round, // 0-based
    totalRounds: room.roundQueue.length,
    currentSituation: room.currentSituation,
    currentTax: room.currentTaxRate,
    interestRate: room.interestRate,
    loanRate: room.loanRate,
    bannedItem: room.bannedItem,
    maxLoanLimit: room.maxLoanLimit === Infinity ? null : room.maxLoanLimit,
    currentShopPrices: room.currentShopPrices,
    totalItemsSold: room.totalItemsSold,
    hasGovExecutedPolicy: room.hasGovExecutedPolicy,
    players: publicPlayers,
    maxPlayers: MAX_PLAYERS,
    itemsList: ALL_ITEMS_LIST,
  });
}

// 특정 소켓에게만 에러 메시지 전송
function sendError(socketId, message) {
  io.to(socketId).emit("errorMessage", { message });
}

/* ============================================================
 *  방 / 라운드 준비 로직
 * ============================================================
 */

// 새 라운드 세팅
function setupRound(room) {
  const situation = room.roundQueue[room.round];
  room.currentSituation = situation;
  room.interestRate = situation.interestRate;
  room.loanRate = situation.interestRate + 0.05;
  room.stockTendency = situation.stockTendency;
  room.governmentTaxesThisRound = 0;

  room.currentShopPrices = {};
  ALL_ITEMS_LIST.forEach((item) => {
    room.currentShopPrices[item.name] = item.basePrice;
  });

  const essential = situation.itemName;
  const essentialBase = ALL_ITEMS_LIST.find((i) => i.name === essential).basePrice;
  const newEssentialPrice = Math.floor(essentialBase * (1 + Math.random() * 0.6));
  room.currentShopPrices[essential] = newEssentialPrice;
  broadcastLog(room, "상점 주인", `'${essential}'의 가격을 ${newEssentialPrice}만원으로 변경했다.`);

  if (Math.random() > 0.5) {
    const randomItem = ALL_ITEMS_LIST[Math.floor(Math.random() * ALL_ITEMS_LIST.length)];
    if (randomItem.name !== essential) {
      const newRandPrice = Math.floor(randomItem.basePrice * 1.5);
      room.currentShopPrices[randomItem.name] = newRandPrice;
      broadcastLog(room, "상점 주인", `'${randomItem.name}'의 가격을 ${newRandPrice}만원으로 변경했다.`);
    }
  }

  Object.values(room.players).forEach((p) => {
    p.essentialItemBought = false;
    p.hasWrittenArticleThisRound = false;
    p.readyForNextRound = false;
  });

  room.pendingArticle = null;
  room.articleVotes = {};
}

// 방 생성
function createRoom(socket, nickname) {
  const roomCode = generateRoomCode();
  const room = {
    roomCode,
    host: socket.id,
    round: 0,
    roundQueue: shuffle(ALL_SITUATIONS),
    currentSituation: null,
    currentTaxRate: 0.10,
    interestRate: 0.05,
    loanRate: 0.10,
    stockTendency: 0,
    bannedItem: null,
    maxLoanLimit: Infinity,
    currentShopPrices: {},
    governmentTaxesThisRound: 0,
    totalItemsSold: 0,
    gameStarted: false,
    hasGovExecutedPolicy: false,
    pendingArticle: null,
    articleVotes: {},
    players: {},
  };
  rooms[roomCode] = room;
  addPlayerToRoom(room, socket, nickname);
  return room;
}

// 방에 플레이어 추가
function addPlayerToRoom(room, socket, nickname) {
  room.players[socket.id] = {
    id: socket.id,
    nickname: nickname && nickname.trim() ? nickname.trim().slice(0, 12) : "익명",
    role: null,
    money: STARTING_MONEY,
    credibility: STARTING_CREDIBILITY,
    savedMoney: 0,
    loanedMoney: 0,
    investedMoney: 0,
    inventory: {},
    alive: true,
    ready: false,
    readyForNextRound: false,
    hasWrittenArticleThisRound: false,
    essentialItemBought: false,
  };
  socket.join(room.roomCode);
}

/* ============================================================
 *  라운드 종료 정산 로직
 * ============================================================
 */
function settleRound(room) {
  const situation = room.currentSituation;
  const results = {}; 

  Object.values(room.players).forEach((p) => {
    results[p.id] = { messages: [] };
  });

  const banker = findPlayerByRole(room, "은행원");
  let bankerNetIncome = 0; 

  Object.values(room.players).forEach((p) => {
    if (p.savedMoney > 0) {
      const interestEarned = Math.floor(p.savedMoney * room.interestRate);
      p.money += p.savedMoney + interestEarned;
      results[p.id].messages.push(`[저축 만기] 원금 ${p.savedMoney}만 + 이자 ${interestEarned}만 입금!`);
      if (banker && banker.id !== p.id) bankerNetIncome -= interestEarned;
      p.savedMoney = 0;
    }
    if (p.loanedMoney > 0) {
      const loanInterest = Math.floor(p.loanedMoney * room.loanRate);
      p.money -= p.loanedMoney + loanInterest;
      results[p.id].messages.push(`[대출 상환] 원금 ${p.loanedMoney}만 + 이자 ${loanInterest}만 차감!`);
      if (banker && banker.id !== p.id) bankerNetIncome += loanInterest;
      p.loanedMoney = 0;
    }
    if (p.investedMoney > 0) {
      const volatility = Math.random() * 0.6 - 0.3;
      const finalStockRate = room.stockTendency + volatility;
      const profit = Math.floor(p.investedMoney * finalStockRate);
      p.money += p.investedMoney + profit;
      const sign = profit >= 0 ? "+" : "";
      results[p.id].messages.push(`[주식 결산] 수익금 ${sign}${profit}만 반영!`);
      p.investedMoney = 0;
    }
  });

  if (banker) {
    banker.money += bankerNetIncome;
    const sign = bankerNetIncome >= 0 ? "+" : "";
    results[banker.id].messages.push(`[은행 영업 통합 결산] 예대마진 순수익: ${sign}${bankerNetIncome}만원`);
  }

  const shopOwner = findPlayerByRole(room, "상점 주인");
  Object.values(room.players).forEach((p) => {
    if (p.role === "상점 주인" || p.role === "정부") return; 
    const hasEssential = p.essentialItemBought || (p.inventory[situation.itemName] > 0);
    if (!hasEssential) {
      p.money -= situation.penalty;
      results[p.id].messages.push(`[필수재 부족 현상] 경제 활동 차질로 인한 기회비용 패널티 -${situation.penalty}만원!`);
    } else {
      results[p.id].messages.push(`이번 라운드 필요 재화를 무사히 수급했습니다.`);
    }
    if (p.inventory[situation.itemName] > 0) {
      p.inventory[situation.itemName] -= 1;
    }
  });

  const government = findPlayerByRole(room, "정부");
  if (government && room.governmentTaxesThisRound > 0) {
    government.money += room.governmentTaxesThisRound;
    results[government.id].messages.push(
      `[국세청 결산] 이번 라운드 거수된 국세 총액 +${room.governmentTaxesThisRound}만원`
    );
  }
  room.governmentTaxesThisRound = 0;

  let articleReveal = null;
  if (room.pendingArticle) {
    const author = room.players[room.pendingArticle.authorId];
    if (author) {
      let likes = 0;
      let dislikes = 0;
      const reactions = [];
      Object.values(room.players).forEach((p) => {
        if (p.id === author.id) return;
        const vote = room.articleVotes[p.id];
        if (vote === "like") {
          likes++;
          reactions.push({ nickname: p.nickname, role: p.role, vote: "like" });
        } else if (vote === "dislike") {
          dislikes++;
          reactions.push({ nickname: p.nickname, role: p.role, vote: "dislike" });
        }
      });
      const votePoints = likes * 3;
      author.credibility += votePoints;
      articleReveal = {
        text: room.pendingArticle.text,
        authorNickname: author.nickname,
        likes,
        dislikes,
        reactions,
        votePoints,
        newCredibility: author.credibility,
      };
      results[author.id].messages.push(
        `[기사 반응] 공감 ${likes}개로 신뢰도가 총 ${votePoints} 상승했습니다! (현재 신뢰도: ${author.credibility}/80)`
      );
    }
  }

  return { results, articleReveal, shopOwner };
}

// 최종 승리 조건 판정
function checkWinConditions(room) {
  const summary = [];
  const moneyList = Object.values(room.players).map((p) => p.money);
  const sortedMoney = [...moneyList].sort((a, b) => b - a);

  Object.values(room.players).forEach((p) => {
    let achieved = false;
    let detail = "";

    if (p.role === "학생") {
      achieved = p.money >= 180;
      detail = `현재 자본: ${p.money}만 / 목표치: 180만`;
    } else if (p.role === "상점 주인") {
      achieved = room.totalItemsSold >= 30;
      detail = `총 누적 판매량: ${room.totalItemsSold}개 / 목표치: 30개`;
    } else if (p.role === "기자") {
      achieved = p.credibility >= 80;
      detail = `최종 신뢰도: ${p.credibility}/80`;
    } else if (p.role === "은행원") {
      const secondPlaceMoney =
        sortedMoney[0] === p.money ? sortedMoney[1] ?? 0 : sortedMoney[0];
      achieved = p.money >= secondPlaceMoney * 3;
      detail = `내 자본: ${p.money}만 / 2위 자본: ${secondPlaceMoney}만`;
    } else if (p.role === "정부") {
      achieved = moneyList.some((m) => m <= 0);
      detail = achieved ? "시장에서 파산자가 발생했습니다." : "파산자가 발생하지 않았습니다.";
    }

    summary.push({
      id: p.id,
      nickname: p.nickname,
      role: p.role,
      money: p.money,
      credibility: p.credibility,
      achieved,
      detail,
    });
  });

  return summary;
}

/* ============================================================
 *  Socket.IO 이벤트 처리
 * ============================================================
 */
io.on("connection", (socket) => {
  socket.on("createRoom", ({ nickname }) => {
    const room = createRoom(socket, nickname);
    socket.emit("roomCreated", { roomCode: room.roomCode });
    broadcastRoomState(room);
  });

  socket.on("joinRoom", ({ roomCode, nickname }) => {
    const room = getRoom(roomCode);
    if (!room) return sendError(socket.id, "존재하지 않는 방입니다.");
    if (room.gameStarted) return sendError(socket.id, "이미 게임이 시작된 방입니다.");
    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      return sendError(socket.id, "방 인원이 가득 찼습니다. (최대 5명)");
    }
    addPlayerToRoom(room, socket, nickname);
    socket.emit("roomJoined", { roomCode: room.roomCode });
    broadcastRoomState(room);
  });

  socket.on("toggleReady", () => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player) return;
    player.ready = !player.ready;
    broadcastRoomState(room);
  });

  socket.on("startGame", () => {
    const room = Object.values(rooms).find((r) => r.host === socket.id);
    if (!room) return sendError(socket.id, "방장만 게임을 시작할 수 있습니다.");
    if (room.gameStarted) return;

    const playerList = Object.values(room.players);
    if (playerList.length < 1) return sendError(socket.id, "참가자가 없습니다.");
    if (!playerList.every((p) => p.ready)) {
      return sendError(socket.id, "모든 플레이어가 준비를 완료해야 시작할 수 있습니다.");
    }

    const shuffledRoles = shuffle(ROLE_NAMES).slice(0, playerList.length);
    playerList.forEach((p, idx) => {
      p.role = shuffledRoles[idx];
    });

    room.gameStarted = true;
    room.round = 0;
    setupRound(room);

    playerList.forEach((p) => {
      io.to(p.id).emit("gameStarted", {
        role: p.role,
        roleInfo: ROLE_INFO[p.role],
        money: p.money,
        credibility: p.credibility,
        round: room.round,
        totalRounds: room.roundQueue.length,
        situation: room.currentSituation,
      });
      sendPrivateStatus(p.id, room, p);
    });
    broadcastRoomState(room);
    broadcastLog(room, "시스템", "게임이 시작되었습니다! 각자의 역할을 확인하세요.");
  });

  socket.on("buyItem", ({ itemName }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (itemName === room.bannedItem) return sendError(socket.id, "정부 규제로 거래가 금지된 물품입니다.");

    const price = room.currentShopPrices[itemName];
    if (price === undefined) return sendError(socket.id, "존재하지 않는 물품입니다.");

    const isShopOwner = player.role === "상점 주인";
    const tax = isShopOwner ? 0 : Math.max(1, Math.floor(price * room.currentTaxRate));
    const totalCost = price + tax;

    if (player.money < totalCost) {
      return sendError(socket.id, `잔액이 부족합니다. (가격 ${price} + 세금 ${tax} = ${totalCost}만 필요)`);
    }

    player.money -= totalCost;
    room.governmentTaxesThisRound += tax;
    player.inventory[itemName] = (player.inventory[itemName] || 0) + 1;
    if (itemName === room.currentSituation.itemName) player.essentialItemBought = true;

    const shopOwner = findPlayerByRole(room, "상점 주인");
    if (shopOwner && shopOwner.id !== player.id) {
      shopOwner.money += price;
      room.totalItemsSold += 1;
    }

    const taxMsg = tax > 0 ? `(세금 ${tax}만 포함)` : "";
    broadcastLog(room, player.role, `상점에서 '${itemName}'을(를) ${totalCost}만원에 구매했다. ${taxMsg}`);
    sendPrivateStatus(player.id, room, player);
    if (shopOwner) sendPrivateStatus(shopOwner.id, room, shopOwner);
    broadcastRoomState(room);
  });

  socket.on("sellItem", ({ itemName }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (itemName === room.bannedItem) return sendError(socket.id, "정부 규제로 거래가 금지된 물품입니다.");
    if (!player.inventory[itemName] || player.inventory[itemName] <= 0) {
      return sendError(socket.id, "판매할 물건이 없습니다.");
    }

    const sellPrice = room.currentShopPrices[itemName];
    const tax = Math.max(1, Math.floor(sellPrice * room.currentTaxRate));
    const net = sellPrice - tax;

    player.inventory[itemName] -= 1;
    player.money += net;
    room.governmentTaxesThisRound += tax;

    const shopOwner = findPlayerByRole(room, "상점 주인");
    if (shopOwner && shopOwner.id !== player.id) {
      shopOwner.money -= net;
    }

    broadcastLog(room, player.role, `'${itemName}'을(를) 상점에 팔아 ${net}만원을 받았다. (세금 ${tax}만 납부)`);
    sendPrivateStatus(player.id, room, player);
    if (shopOwner) sendPrivateStatus(shopOwner.id, room, shopOwner);
    broadcastRoomState(room);
  });

  socket.on("changePrice", ({ itemName, price }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "상점 주인") return sendError(socket.id, "상점 주인만 가격을 변경할 수 있습니다.");
    if (itemName === room.bannedItem) return sendError(socket.id, "정부 규제로 거래가 금지된 물품입니다.");

    const newPrice = parseInt(price, 10);
    if (isNaN(newPrice) || newPrice <= 0) return sendError(socket.id, "올바른 가격을 입력하세요.");

    const baseData = ALL_ITEMS_LIST.find((i) => i.name === itemName);
    if (!baseData) return sendError(socket.id, "존재하지 않는 물품입니다.");

    if (
      itemName === room.currentSituation.itemName &&
      room.activeRegulation === "price_limit"
    ) {
      const limitPrice = Math.floor(baseData.basePrice * 1.2);
      if (newPrice > limitPrice) {
        return sendError(socket.id, `정부 규제로 인해 가격은 원가의 120%(${limitPrice}만)를 초과할 수 없습니다.`);
      }
    }

    room.currentShopPrices[itemName] = newPrice;
    broadcastLog(room, "상점 주인", `'${itemName}'의 가격을 ${newPrice}만원으로 변경했다.`);
    broadcastRoomState(room);
  });

  socket.on("saveMoney", ({ amount }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    const val = parseInt(amount, 10);
    if (isNaN(val) || val <= 0 || val > player.money) return sendError(socket.id, "금액을 확인해주세요.");
    player.money -= val;
    player.savedMoney += val;
    broadcastLog(room, player.role, `은행에 ${val}만원을 저축했다.`);
    sendPrivateStatus(player.id, room, player);
  });

  socket.on("takeLoan", ({ amount }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    const val = parseInt(amount, 10);
    if (isNaN(val) || val <= 0) return sendError(socket.id, "금액을 확인해주세요.");
    if (val > room.maxLoanLimit) {
      return sendError(socket.id, `정부 규제로 대출 한도가 ${room.maxLoanLimit}만원으로 제한되었습니다.`);
    }
    player.money += val;
    player.loanedMoney += val;
    broadcastLog(room, player.role, `은행에서 ${val}만원을 대출했다.`);
    sendPrivateStatus(player.id, room, player);
  });

  socket.on("investMoney", ({ amount }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    const val = parseInt(amount, 10);
    if (isNaN(val) || val <= 0 || val > player.money) return sendError(socket.id, "금액을 확인해주세요.");
    player.money -= val;
    player.investedMoney += val;
    broadcastLog(room, player.role, `주식에 ${val}만원을 투자했다.`);
    sendPrivateStatus(player.id, room, player);
  });

  socket.on("setDepositRate", ({ rate }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "은행원") return sendError(socket.id, "은행원만 금리를 설정할 수 있습니다.");
    const val = parseFloat(rate);
    if (isNaN(val) || val < 0) return sendError(socket.id, "올바른 금리를 입력하세요.");
    room.interestRate = val / 100;
    broadcastLog(room, "은행원", `예금 금리를 ${val}%로 설정했다.`);
    broadcastRoomState(room);
  });

  socket.on("setLoanRate", ({ rate }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "은행원") return sendError(socket.id, "은행원만 금리를 설정할 수 있습니다.");
    const val = parseFloat(rate);
    if (isNaN(val) || val < 0) return sendError(socket.id, "올바른 금리를 입력하세요.");
    room.loanRate = val / 100;
    broadcastLog(room, "은행원", `대출 금리를 ${val}%로 설정했다.`);
    broadcastRoomState(room);
  });

  socket.on("setTaxRate", ({ rate }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "정부") return sendError(socket.id, "정부만 세율을 조정할 수 있습니다.");
    if (room.hasGovExecutedPolicy) {
      return sendError(socket.id, "정부는 대국민 담화를 제외하고 단 하나의 정책만 시행할 수 있습니다.");
    }
    const val = parseFloat(rate);
    if (isNaN(val) || val < 0) return sendError(socket.id, "올바른 세율을 입력하세요.");
    room.currentTaxRate = val / 100;
    room.hasGovExecutedPolicy = true;
    broadcastLog(room, "정부", `기본 세율을 ${val}%로 조정했습니다.`, "#ff3333");
    broadcastRoomState(room);
  });

  socket.on("applyRegulation", ({ type }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "정부") return sendError(socket.id, "정부만 규제를 발표할 수 있습니다.");
    if (room.hasGovExecutedPolicy) {
      return sendError(socket.id, "정부는 대국민 담화를 제외하고 단 하나의 정책만 시행할 수 있습니다.");
    }

    let msg = "";
    room.bannedItem = null;
    room.maxLoanLimit = Infinity;
    room.activeRegulation = type;

    if (type === "price_limit") {
      msg = "물가 상승 억제를 위해 인기 상품의 가격 인상 폭이 제한됩니다.";
    } else if (type === "ban_random_item") {
      const randomItemObj = ALL_ITEMS_LIST[Math.floor(Math.random() * ALL_ITEMS_LIST.length)];
      room.bannedItem = randomItemObj.name;
      msg = `시장 과열 방지를 위해 '${room.bannedItem}'의 거래가 전면 금지됩니다!`;
    } else if (type === "loan_limit") {
      room.maxLoanLimit = 30;
      msg = "디레버리징을 위해 가계 대출 한도가 30만원으로 제한됩니다.";
    } else if (type === "lift_all") {
      msg = "경제 자유도 제고를 위해 모든 시장 규제가 전면 해제되었습니다.";
    } else {
      return sendError(socket.id, "알 수 없는 규제 유형입니다.");
    }

    room.hasGovExecutedPolicy = true;
    broadcastLog(room, "정부", `[규제 발표] ${msg}`, "#ff3333");
    broadcastRoomState(room);
  });

  socket.on("applyEmergencyPolicy", ({ type }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "정부") return sendError(socket.id, "정부만 긴급 정책을 시행할 수 있습니다.");
    if (room.hasGovExecutedPolicy) {
      return sendError(socket.id, "정부는 대국민 담화를 제외하고 단 하나의 정책만 시행할 수 있습니다.");
    }

    let msg = "";
    if (type === "coupon") {
      const cost = 40;
      if (player.money < cost) return sendError(socket.id, `국고가 부족합니다. (${cost}만원 필요)`);
      player.money -= cost;
      Object.values(room.players).forEach((p) => {
        if (p.role !== "정부") p.money += 10;
      });
      msg = "소비 승수효과 창출을 위해 전 국민에게 10만원의 특별 재난지원금을 살포했습니다.";
    } else if (type === "price_fix") {
      for (const item in room.currentShopPrices) {
        const base = ALL_ITEMS_LIST.find((i) => i.name === item).basePrice;
        room.currentShopPrices[item] = base;
      }
      msg = "물가 폭등을 막기 위해 모든 상점의 재화 가격이 원가로 강제 통제되었습니다.";
    } else if (type === "tax_hike") {
      room.currentTaxRate = 0.3;
      msg = "부의 재분배 및 투기 억제를 위해 한시적으로 세율을 30%로 대폭 상향합니다.";
    } else {
      return sendError(socket.id, "알 수 없는 정책 유형입니다.");
    }

    room.hasGovExecutedPolicy = true;
    broadcastLog(room, "정부", `[긴급 정책] ${msg}`, "#ff3333");
    broadcastAllPrivateStatus(room);
    broadcastRoomState(room);
  });

  socket.on("broadcast", ({ message }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "정부") return sendError(socket.id, "정부만 대국민 담화를 발표할 수 있습니다.");
    if (!message || message.trim().length < 5) return sendError(socket.id, "담화문 내용이 너무 짧습니다.");
    broadcastLog(room, "정부", `[대국민 담화] "${message.trim()}"`, "#ff3333");
  });

  socket.on("publishArticle", ({ text }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "기자") return sendError(socket.id, "기자만 기사를 작성할 수 있습니다.");
    if (player.hasWrittenArticleThisRound) return sendError(socket.id, "기사는 한 라운드에 1번만 작성할 수 있습니다.");
    if (!text || text.trim().length < 5) return sendError(socket.id, "기사 내용이 너무 짧습니다.");

    player.hasWrittenArticleThisRound = true;
    room.pendingArticle = { text: text.trim(), authorId: player.id };
    room.articleVotes = {};
    broadcastLog(room, "기자", "새로운 경제 기사를 탈고했다.");
    io.to(room.roomCode).emit("articleUpdate", {
      published: true,
      text: room.pendingArticle.text,
      authorId: player.id,
      authorNickname: player.nickname,
    });
  });

  socket.on("buyInfo", ({ level }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (player.role !== "기자") return sendError(socket.id, "기자만 정보를 구매할 수 있습니다.");

    const costMap = { 1: 10, 2: 20, 3: 30 };
    const cost = costMap[level];
    if (!cost) return sendError(socket.id, "잘못된 정보 등급입니다.");

    const tax = Math.max(1, Math.floor(cost * room.currentTaxRate));
    const totalCost = cost + tax;
    if (player.money < totalCost) {
      return sendError(socket.id, `잔액이 부족합니다. (정보비용 ${cost} + 세금 ${tax} = ${totalCost}만 필요)`);
    }

    player.money -= totalCost;
    room.governmentTaxesThisRound += tax;

    const nextIndex = Math.min(room.round + 1, room.roundQueue.length - 1);
    const hints = room.roundQueue[nextIndex].hints;
    let info;
    if (level === 1) info = "다음 라운드 거시경제 지표가 요동치고 있습니다.";
    else if (level === 2) info = hints[0];
    else info = hints[0] + "\n" + hints[1];

    io.to(socket.id).emit("infoPurchased", { level, info });
    broadcastLog(room, "기자", "정보원에게 고급 분석 정보를 구매했다.");
    sendPrivateStatus(player.id, room, player);
  });

  socket.on("voteArticle", ({ vote }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    if (!room.pendingArticle) return sendError(socket.id, "현재 투표할 기사가 없습니다.");
    if (room.pendingArticle.authorId === player.id) return sendError(socket.id, "본인 기사에는 투표할 수 없습니다.");
    if (vote !== "like" && vote !== "dislike") return sendError(socket.id, "잘못된 투표입니다.");

    room.articleVotes[player.id] = vote;
    broadcastLog(room, player.role, `기사에 [${vote === "like" ? "공감" : "비공감"}] 투표를 했다.`);
  });

  function handleChat({ targetId, message }) {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    const target = room.players[targetId];
    if (!target) return sendError(socket.id, "상대방을 찾을 수 없습니다.");
    if (!message || !message.trim()) return;

    const payload = {
      fromId: player.id,
      fromNickname: player.nickname,
      fromRole: player.role,
      toId: target.id,
      message: message.trim(),
      timestamp: Date.now(),
    };
    io.to(player.id).emit("privateChat", payload);
    io.to(target.id).emit("privateChat", payload);
  }
  socket.on("chatMessage", handleChat);
  socket.on("privateChat", handleChat);

  socket.on("transferMoney", ({ targetId, amount }) => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;
    const target = room.players[targetId];
    if (!target) return sendError(socket.id, "상대방을 찾을 수 없습니다.");
    const val = parseInt(amount, 10);
    if (isNaN(val) || val <= 0 || val > player.money) return sendError(socket.id, "금액을 확인해주세요.");

    player.money -= val;
    target.money += val;

    broadcastLog(room, player.role, `'${target.nickname}'에게 ${val}만원을 송금했다.`);
    sendPrivateStatus(player.id, room, player);
    sendPrivateStatus(target.id, room, target);

    const payload = {
      fromId: player.id,
      fromNickname: player.nickname,
      toId: target.id,
      amount: val,
      timestamp: Date.now(),
    };
    io.to(player.id).emit("moneyTransferred", payload);
    io.to(target.id).emit("moneyTransferred", payload);
  });

  socket.on("nextRound", () => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player || !room.gameStarted) return;

    player.readyForNextRound = true;
    broadcastLog(room, player.role, "턴을 종료했다. (다음 라운드 대기중)");
    broadcastRoomState(room);

    const everyoneReady = Object.values(room.players).every((p) => p.readyForNextRound);
    if (!everyoneReady) return;

    const { results, articleReveal } = settleRound(room);

    Object.entries(results).forEach(([socketId, result]) => {
      io.to(socketId).emit("roundResult", {
        round: room.round + 1,
        messages: result.messages,
        money: room.players[socketId].money,
      });
    });

    if (articleReveal) {
      io.to(room.roomCode).emit("articleUpdate", { published: false, reveal: articleReveal });
    }

    broadcastAllPrivateStatus(room);

    room.round += 1;

    if (room.round >= room.roundQueue.length) {
      const summary = checkWinConditions(room);
      room.gameStarted = false;
      io.to(room.roomCode).emit("gameOver", { summary });
      broadcastLog(room, "시스템", "게임이 종료되었습니다! 최종 결과를 확인하세요.");
      return;
    }

    room.activeRegulation = null;
    room.hasGovExecutedPolicy = false;
    setupRound(room);

    Object.values(room.players).forEach((p) => {
      io.to(p.id).emit("roundStarted", {
        round: room.round,
        totalRounds: room.roundQueue.length,
        situation: room.currentSituation,
      });
    });
    broadcastRoomState(room);
  });

  socket.on("disconnect", () => {
    const { room, player } = findRoomAndPlayerBySocket(socket.id);
    if (!room || !player) return;

    delete room.players[socket.id];
    broadcastLog(room, "시스템", `'${player.nickname}'님이 퇴장했습니다.`);

    if (Object.keys(room.players).length === 0) {
      delete rooms[room.roomCode];
      return;
    }

    if (room.host === socket.id) {
      room.host = Object.keys(room.players)[0];
      broadcastLog(room, "시스템", "방장이 위임되었습니다.");
    }

    broadcastRoomState(room);
  });
});

/* ============================================================
 *  서버 실행
 * ============================================================
 */
server.listen(PORT, () => {
  console.log(`마을 경제 게임 서버가 http://localhost:${PORT} 에서 실행중입니다.`);
});