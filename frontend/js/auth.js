let authToken = localStorage.getItem('auth_token');
let authUsername = localStorage.getItem('auth_username');
let authUserId = localStorage.getItem('auth_user_id');
let authEmail = localStorage.getItem('auth_email');

function isLoggedIn() {
  return !!authToken;
}

function showAuth() {
  document.getElementById('auth-page').classList.add('active');
  document.getElementById('game-page').classList.remove('active');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  if (tab === 'login') {
    document.getElementById('auth-login-form').classList.add('active');
    document.getElementById('tab-login-btn').classList.add('active');
  } else {
    document.getElementById('auth-register-form').classList.add('active');
    document.getElementById('tab-register-btn').classList.add('active');
  }
  document.getElementById('auth-msg').textContent = '';
  document.getElementById('reg-msg').textContent = '';
}

function handleLogin() {
  handleEmailLogin();
}

async function handleRegister() {
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;
  const nickname = document.getElementById('reg-nickname').value.trim() || ('玩家' + Math.random().toString(36).slice(2, 6));
  const msgEl = document.getElementById('reg-msg');

  if (!email) {
    msgEl.textContent = '请输入账号';
    msgEl.className = 'auth-msg error';
    return;
  }
  if (!password || password.length < 3) {
    msgEl.textContent = '密码至少3位';
    msgEl.className = 'auth-msg error';
    return;
  }
  if (password !== password2) {
    msgEl.textContent = '两次密码不一致';
    msgEl.className = 'auth-msg error';
    return;
  }

  try {
    const data = await apiPost('/api/auth/login', { email, password, nickname });
    authToken = data.token;
    authUsername = data.username;
    authUserId = data.user_id;
    authEmail = data.email;
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_username', data.username);
    localStorage.setItem('auth_user_id', data.user_id);
    localStorage.setItem('auth_email', data.email);
    localStorage.setItem('saved_email', email);
    localStorage.setItem('saved_password', password);
    localStorage.removeItem('anon_player_id');

    document.getElementById('game-user-email').textContent = data.email;

    if (typeof window.showGamePage === 'function') {
      window.showGamePage();
    } else {
      document.getElementById('auth-page').classList.remove('active');
      document.getElementById('game-page').classList.add('active');
    }
  } catch (e) {
    msgEl.textContent = e.message;
    msgEl.className = 'auth-msg error';
  }
}

async function handleEmailLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msgEl = document.getElementById('auth-msg');

  if (!email) {
    msgEl.textContent = '请输入 QQ 邮箱';
    msgEl.className = 'auth-msg error';
    return;
  }
  if (!password || password.length < 3) {
    msgEl.textContent = '密码至少3位';
    msgEl.className = 'auth-msg error';
    return;
  }

  try {
    const data = await apiPost('/api/auth/login', { email, password });
    authToken = data.token;
    authUsername = data.username;
    authUserId = data.user_id;
    authEmail = data.email;
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_username', data.username);
    localStorage.setItem('auth_user_id', data.user_id);
    localStorage.setItem('auth_email', data.email);
    // 记住登录信息
    localStorage.setItem('saved_email', email);
    localStorage.setItem('saved_password', password);
    // 清除旧匿名ID
    localStorage.removeItem('anon_player_id');

    document.getElementById('game-user-email').textContent = data.email;

    // Call showGamePage from game.js
    if (typeof window.showGamePage === 'function') {
      window.showGamePage();
    } else {
      document.getElementById('auth-page').classList.remove('active');
      document.getElementById('game-page').classList.add('active');
    }
  } catch (e) {
    msgEl.textContent = e.message;
    msgEl.className = 'auth-msg error';
  }
}

function handleLogout() {
  if (ws) ws.close();
  if (leaderboardInterval) clearInterval(leaderboardInterval);
  if (window.tradesInterval) clearInterval(window.tradesInterval);
  if (window.equityInterval) clearInterval(window.equityInterval);
  if (window.ordersInterval) clearInterval(window.ordersInterval);
  document.getElementById('game-page').classList.remove('active');

  authToken = null;
  authUsername = null;
  authUserId = null;
  authEmail = null;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  localStorage.removeItem('auth_user_id');
  localStorage.removeItem('auth_email');

  gameState.playerId = null;
  gameState.stocks = [];
  gameState.holdings = [];
  gameState.leaderboard = [];
  gameState.orderBook = {};
  gameState.candleData = { '1t': {}, '4t': {}, '20t': {} };

  showAuth();
}
