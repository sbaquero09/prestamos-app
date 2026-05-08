// =====================================================
// PRESTAMOS PRO — app.js (con Auth multiusuario)
// =====================================================

// ── CONFIG SUPABASE ────────────────────────────────
const SUPABASE_URL     = 'https://xxvzfajudcqdwehfhkjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4dnpmYWp1ZGNxZHdlaGZoa2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzAwMDgsImV4cCI6MjA5Mzc0NjAwOH0.CfTzLor2xiSdVGvwv9M6DGelXpUYsi_kyhfYs2n-n9w';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── STATE ──────────────────────────────────────────
let currentTab  = 'finanzas';
let currentUser = null;
let clients     = [];
let loans       = [];
let payments    = [];
let config      = { capital_inicial: 2000000 };

// ── FORMATEO PESOS COLOMBIANOS ──────────────────────
function formatCOP(value) {
  const num = Number(String(value).replace(/\./g, '').replace(',', '.')) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(num);
}
function parseCOP(str) {
  return Number(String(str).replace(/\./g,'').replace(',','').replace('$','').replace(/\s/g,'')) || 0;
}
function formatInput(input) {
  const raw = parseCOP(input.value);
  input.value = raw > 0 ? raw.toLocaleString('es-CO') : '';
}
function initMoneyInputs() {
  document.querySelectorAll('.money-input').forEach(input => {
    input.addEventListener('blur',  () => formatInput(input));
    input.addEventListener('focus', () => {
      const raw = parseCOP(input.value);
      input.value = raw > 0 ? raw : '';
    });
  });
}

// ── REDONDEO ────────────────────────────────────────
function redondear1000(valor) { return Math.ceil(valor / 1000) * 1000; }

// ── UTILIDADES ──────────────────────────────────────
function today()     { return new Date().toISOString().slice(0, 10); }
function norm(s)     { return String(s || '').toLowerCase(); }
function daysDiff(dateStr) {
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(today()  + 'T00:00:00');
  return Math.floor((a - b) / 86400000);
}

const STEPS          = { DIARIO: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30 };
const CUOTAS_POR_MES = { DIARIO: 30, SEMANAL: 4, QUINCENAL: 2, MENSUAL: 1 };

function dueDateForCuota(loan, cuotaNum) {
  const start = new Date(loan.fecha + 'T00:00:00');
  const step  = STEPS[loan.modalidad] || 7;
  start.setDate(start.getDate() + step * cuotaNum);
  return start.toISOString().slice(0, 10);
}
function nextDueDate(loan) {
  const paidCount = payments.filter(p => String(p.loan_id) === String(loan.id)).length;
  const next      = Math.min(paidCount + 1, Number(loan.cuotas));
  return dueDateForCuota(loan, next);
}
function allDueDates(loan) {
  return Array.from({ length: Number(loan.cuotas) }, (_, i) => ({
    num:    i + 1,
    fecha:  dueDateForCuota(loan, i + 1),
    pagada: i < payments.filter(p => String(p.loan_id) === String(loan.id)).length,
  }));
}
function calcMeses(cuotas, modalidad) {
  const cpm = CUOTAS_POR_MES[modalidad] || 1;
  return Math.ceil(cuotas / cpm);
}
function clientById(id)   { return clients.find(c => String(c.id) === String(id)); }
function clientName(id)   { return clientById(id)?.nombre || 'Sin cliente'; }
function loanExpected(l)  { return Number(l.cuota || 0) * Number(l.cuotas || 0); }
function loanPaid(loanId) {
  return payments
    .filter(p => String(p.loan_id) === String(loanId))
    .reduce((s, p) => s + Number(p.monto || 0), 0);
}
function loanBalance(l)   { return Math.max(0, loanExpected(l) - loanPaid(l.id)); }
function loansDueSoon() {
  return loans.filter(l => {
    if (loanBalance(l) <= 0) return false;
    const diff = daysDiff(nextDueDate(l));
    return diff >= 0 && diff <= 3;
  });
}

// ── TOAST ──────────────────────────────────────────
function showToast(msg, tipo = 'ok') {
  let t = document.getElementById('appToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'appToast';
    t.style.cssText = `
      position:fixed;bottom:110px;left:50%;transform:translateX(-50%);
      padding:12px 20px;border-radius:12px;font-size:14px;font-weight:700;
      z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;
      max-width:320px;text-align:center;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = tipo === 'ok' ? 'var(--ok)'  : tipo === 'warn' ? 'var(--warn)' : 'var(--danger)';
  t.style.color = '#fff';
  t.style.opacity = '1';
  clearTimeout(t._to);
  t._to = setTimeout(() => { t.style.opacity = '0'; }, 2800);
}

// ══════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════
function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appShell').style.display   = 'none';
}
function showAppShell(user) {
  currentUser = user;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display   = 'block';
  goTab('finanzas');
  initMoneyInputs();
  loadData();
}
function switchAuthTab(tab) {
  document.getElementById('formLogin').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('formRegister').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tabLogin').classList.toggle('active',    tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
  clearAuthErrors();
}
function clearAuthErrors() {
  ['loginError', 'regError'].forEach(id => {
    const el = document.getElementById(id);
    el.style.display = 'none';
    el.textContent   = '';
  });
}
function showAuthError(id, msg) {
  const el = document.getElementById(id);
  el.textContent   = msg;
  el.style.display = 'block';
}
function setAuthLoading(btnId, loading) {
  const btn    = document.getElementById(btnId);
  btn.disabled = loading;
  btn.textContent = loading ? 'Cargando…'
    : (btnId === 'loginBtn' ? 'Entrar' : 'Crear cuenta');
}

async function handleLogin(e) {
  e.preventDefault();
  clearAuthErrors();
  setAuthLoading('loginBtn', true);
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  setAuthLoading('loginBtn', false);
  if (error) { showAuthError('loginError', translateAuthError(error.message)); return; }
  showAppShell(data.user);
}

async function handleRegister(e) {
  e.preventDefault();
  clearAuthErrors();
  const pass1 = document.getElementById('regPassword').value;
  const pass2 = document.getElementById('regPassword2').value;
  if (pass1 !== pass2) { showAuthError('regError', 'Las contraseñas no coinciden.'); return; }
  setAuthLoading('regBtn', true);
  const email = document.getElementById('regEmail').value.trim();
  const { data, error } = await sb.auth.signUp({ email, password: pass1 });
  setAuthLoading('regBtn', false);
  if (error) { showAuthError('regError', translateAuthError(error.message)); return; }
  if (data.user && !data.session) {
    showAuthError('regError', '✅ Cuenta creada. Revisa tu correo para confirmar antes de iniciar sesión.');
    return;
  }
  showAppShell(data.user);
}

async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) { showAuthError('loginError', 'Escribe tu correo primero.'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) { showAuthError('loginError', translateAuthError(error.message)); return; }
  showAuthError('loginError', '✅ Te enviamos un enlace para restablecer tu contraseña.');
  document.getElementById('loginError').style.color = 'var(--ok)';
}

async function handleLogout() {
  await sb.auth.signOut();
  currentUser = null;
  clients = []; loans = []; payments = [];
  config = { capital_inicial: 2000000 };
  closeModal('profileModal');
  showAuthScreen();
}

function openProfile() {
  document.getElementById('profileEmail').textContent = currentUser?.email || '—';
  openModal('profileModal');
}

function translateAuthError(msg) {
  if (msg.includes('Invalid login credentials'))  return 'Correo o contraseña incorrectos.';
  if (msg.includes('Email not confirmed'))         return 'Debes confirmar tu correo antes de entrar.';
  if (msg.includes('User already registered'))     return 'Ya existe una cuenta con ese correo.';
  if (msg.includes('Password should be'))          return 'La contraseña debe tener al menos 6 caracteres.';
  if (msg.includes('rate limit'))                  return 'Demasiados intentos. Espera un momento.';
  return msg;
}

// ── NAVEGACIÓN ─────────────────────────────────────
function goTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + tab).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.getElementById('fab').style.display = tab === 'finanzas' ? 'none' : 'flex';
}
function primaryAction() {
  if (currentTab === 'prestamos') openLoanModal();
  else if (currentTab === 'pagos')    openPaymentModal();
  else if (currentTab === 'clientes') openClientModal();
}
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); })
);

// ── CARGA DE DATOS ─────────────────────────────────
async function loadData() {
  if (!currentUser) return;
  const uid = currentUser.id;

  const [
    { data: cfg, error: e1 },
    { data: c,   error: e2 },
    { data: l,   error: e3 },
    { data: p,   error: e4 },
  ] = await Promise.all([
    sb.from('app_config').select('*').eq('user_id', uid).limit(1),
    sb.from('clientes').select('*').eq('user_id', uid).order('nombre'),
    sb.from('prestamos').select('*').eq('user_id', uid).order('fecha', { ascending: false }),
    sb.from('pagos').select('*').eq('user_id', uid).order('fecha', { ascending: false }),
  ]);

  const errores = [e1, e2, e3, e4].filter(Boolean);
  if (errores.length) {
    console.error('Error cargando datos:', errores.map(e => e.message));
    showToast('Error al cargar datos. Revisa la conexión.', 'danger');
    return;
  }

  config   = { capital_inicial: Number(cfg?.[0]?.capital_inicial ?? 2000000) };
  clients  = c || [];
  loans    = l || [];
  payments = p || [];
  renderAll();
}

// ── RENDER ─────────────────────────────────────────
function renderAll() {
  renderHeader();
  renderStats();
  renderLoans();
  renderPayments();
  renderClients();
}

function renderHeader() {
  const totalPrestado = loans.reduce((s, l) => s + Number(l.importe || 0), 0);
  const totalPagado   = payments.reduce((s, p) => s + Number(p.monto || 0), 0);
  const capital       = config.capital_inicial - totalPrestado + totalPagado;
  document.getElementById('heroCapital').textContent = formatCOP(capital);
  document.getElementById('heroDue').textContent     = loansDueSoon().length;
}

function renderStats() {
  const cap        = Number(config.capital_inicial || 0);
  const prestado   = loans.reduce((s, l) => s + Number(l.importe || 0), 0);
  const esperado   = loans.reduce((s, l) => s + loanExpected(l), 0);
  const pagado     = payments.reduce((s, p) => s + Number(p.monto || 0), 0);
  const ganancias  = esperado - prestado;
  const pendiente  = esperado - pagado;
  const disponible = cap - prestado + pagado;

  document.getElementById('statsGrid').innerHTML = [
    ['Capital inicial',    cap,        'full'],
    ['Capital disponible', disponible, 'full'],
    ['Total prestado',     prestado,   ''],
    ['Total pagado',       pagado,     ''],
    ['Ganancias',          ganancias,  ''],
    ['Pendiente cobrar',   pendiente,  ''],
  ].map(([lbl, val, cls]) => `
    <div class="stat ${cls}">
      <div class="stat-label">${lbl}</div>
      <div class="stat-value">${formatCOP(val)}</div>
    </div>`).join('');

  const due = loansDueSoon();
  document.getElementById('dueAlert').innerHTML = due.length
    ? `<div class="alert-warn"><strong>Cobros próximos</strong><p>${due.length} préstamo(s) con cuota en los próximos 3 días.</p></div>`
    : '';
}

function renderLoans() {
  const q    = norm(document.getElementById('searchLoans').value);
  const list = loans.filter(l => norm(clientName(l.cliente_id)).includes(q));
  const wrap = document.getElementById('loanList');

  if (!list.length) {
    wrap.innerHTML = '<div class="empty">No hay préstamos.</div>';
    return;
  }

  wrap.innerHTML = list.map(l => {
    const next    = nextDueDate(l);
    const diff    = daysDiff(next);
    const balance = loanBalance(l);
    const paid    = loanPaid(l.id);
    const total   = loanExpected(l);
    const pct     = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;

    let statusChip = `<span class="chip ok">Al día</span>`;
    if (balance <= 0)   statusChip = `<span class="chip">Completado</span>`;
    else if (diff < 0)  statusChip = `<span class="chip danger">Vencido</span>`;
    else if (diff <= 3) statusChip = `<span class="chip warn">Vence ${next}</span>`;

    const modClass = l.modalidad?.toLowerCase() || 'semanal';

    return `
    <div class="list-item">
      <div class="list-top">
        <div style="flex:1;min-width:0">
          <div class="item-title">${clientName(l.cliente_id)}</div>
          <div class="item-meta">${l.fecha}</div>
          <div class="chips">
            <span class="chip ${modClass}">${l.modalidad}</span>
            ${statusChip}
            <span class="chip">${pct}% pagado</span>
          </div>
          <div class="item-amount">${formatCOP(l.importe)} · cuota ${formatCOP(l.cuota)} × ${l.cuotas}</div>
          <div style="font-size:13px;color:var(--muted);margin-top:4px">
            Saldo ${formatCOP(balance)} · Próx. cuota <strong>${next}</strong>
          </div>
        </div>
        <div class="item-actions">
          <button class="icon-btn" title="Ver cronograma" onclick="openSchedule(${l.id})">📅</button>
          <button class="icon-btn" title="Registrar pago"  onclick="openPaymentForLoan(${l.id})">💰</button>
          <button class="icon-btn" title="Editar"          onclick="editLoan(${JSON.stringify(l).replace(/"/g,'&quot;')})">✏️</button>
          <button class="icon-btn" title="Eliminar"        onclick="deleteLoan(${l.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderPayments() {
  const due  = loansDueSoon();
  document.getElementById('paymentsAlert').innerHTML = due.length
    ? `<div class="alert-info">${due.length} préstamo(s) con pago próximo a vencer.</div>`
    : '';

  const q    = norm(document.getElementById('searchPayments').value);
  const list = payments.filter(p => {
    const loan = loans.find(l => String(l.id) === String(p.loan_id));
    return !loan
      ? false
      : norm(clientName(loan.cliente_id)).includes(q) || norm(p.fecha).includes(q);
  });

  const wrap = document.getElementById('paymentList');
  if (!list.length) {
    wrap.innerHTML = '<div class="empty">No hay pagos registrados.</div>';
    return;
  }

  wrap.innerHTML = list.map(p => {
    const loan = loans.find(l => String(l.id) === String(p.loan_id));
    const name = loan ? clientName(loan.cliente_id) : 'Préstamo eliminado';
    return `
    <div class="list-item">
      <div class="list-top">
        <div>
          <div class="item-title">${name}</div>
          <div class="item-meta">${p.fecha}</div>
          <div class="chips"><span class="chip ok">✓ Pago registrado</span></div>
        </div>
        <div class="item-amount">${formatCOP(p.monto)}</div>
        <div class="item-actions">
          <button class="icon-btn" title="Eliminar" onclick="deletePayment(${p.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderClients() {
  const q    = norm(document.getElementById('searchClients').value);
  const list = clients.filter(c =>
    norm(c.nombre).includes(q) ||
    norm(c.identificacion).includes(q) ||
    norm(c.telefono).includes(q)
  );
  const wrap = document.getElementById('clientList');

  if (!list.length) {
    wrap.innerHTML = '<div class="empty">No hay clientes.</div>';
    return;
  }

  wrap.innerHTML = list.map(c => {
    const n = loans.filter(l => String(l.cliente_id) === String(c.id)).length;
    return `
    <div class="list-item">
      <div class="list-top">
        <div>
          <div class="item-title">${c.nombre}</div>
          <div class="item-meta">${c.identificacion || 'Sin cédula'} · ${c.telefono || 'Sin teléfono'}</div>
          <div class="chips"><span class="chip">${n} préstamo${n !== 1 ? 's' : ''}</span></div>
          ${c.email ? `<div style="font-size:13px;color:var(--muted);margin-top:6px">${c.email}</div>` : ''}
        </div>
        <div class="item-actions">
          <button class="icon-btn" onclick="editClient(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏️</button>
          <button class="icon-btn" onclick="deleteClient(${c.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── SETTINGS ────────────────────────────────────────
function openSettings() {
  const v = Number(config.capital_inicial || 0);
  document.getElementById('cfgCapital').value = v > 0 ? v.toLocaleString('es-CO') : '';
  openModal('settingsModal');
}

async function saveSettings() {
  const val = parseCOP(document.getElementById('cfgCapital').value);
  const uid = currentUser.id;

  const { data, error: selectErr } = await sb
    .from('app_config').select('id').eq('user_id', uid).limit(1);

  if (selectErr) { showToast('Error al guardar configuración.', 'danger'); return; }

  let err;
  if (data?.length) {
    ({ error: err } = await sb.from('app_config')
      .update({ capital_inicial: val }).eq('id', data[0].id));
  } else {
    ({ error: err } = await sb.from('app_config')
      .insert({ capital_inicial: val, user_id: uid }));
  }

  if (err) { showToast('Error al guardar: ' + err.message, 'danger'); return; }

  config.capital_inicial = val;
  closeModal('settingsModal');
  renderHeader();
  renderStats();
  showToast('Capital actualizado ✓');
}

// ══════════════════════════════════════════════════════
// PRÉSTAMOS
// ══════════════════════════════════════════════════════
function openLoanModal(loan) {
  document.getElementById('loanModalTitle').textContent = loan ? 'Editar préstamo' : 'Nuevo préstamo';
  document.getElementById('loanId').value    = loan?.id    || '';
  document.getElementById('loanFecha').value = loan?.fecha || today();

  const sel = document.getElementById('loanCliente');
  sel.innerHTML = '<option value="">Seleccionar cliente</option>' +
    clients.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  if (loan?.cliente_id) sel.value = loan.cliente_id;

  document.getElementById('loanImporte').value  = loan?.importe  ? Number(loan.importe).toLocaleString('es-CO') : '';
  document.getElementById('loanInteres').value  = loan?.interes  ?? '';
  document.getElementById('loanModalidad').value= loan?.modalidad || 'SEMANAL';
  document.getElementById('loanCuotas').value   = loan?.cuotas   || '';

  const toggle = document.getElementById('toggleManual');
  toggle.checked = false;
  const totalField = document.getElementById('loanImporteTotal');
  totalField.setAttribute('readonly', true);
  totalField.classList.add('readonly-field');

  calcLoan(loan);
  openModal('loanModal');
}

function editLoan(loan) { openLoanModal(loan); }

function onToggleManual() {
  const manual = document.getElementById('toggleManual').checked;
  const field  = document.getElementById('loanImporteTotal');
  if (manual) {
    field.removeAttribute('readonly');
    field.classList.remove('readonly-field');
    field.oninput = null; field.onblur = null; field.onfocus = null;
    const raw = parseCOP(field.value);
    field.value = raw > 0 ? raw : '';
    field.focus(); field.select();
  } else {
    field.setAttribute('readonly', true);
    field.classList.add('readonly-field');
    calcLoan();
  }
}

function calcLoan(loan) {
  const importe  = parseCOP(document.getElementById('loanImporte').value)  || loan?.importe  || 0;
  const interes  = Number(document.getElementById('loanInteres').value)     ?? loan?.interes  ?? 0;
  const cuotas   = Number(document.getElementById('loanCuotas').value)      || loan?.cuotas   || 0;
  const modalidad= document.getElementById('loanModalidad').value           || loan?.modalidad || 'SEMANAL';
  const modoManual = document.getElementById('toggleManual')?.checked;
  const meses    = cuotas > 0 ? calcMeses(cuotas, modalidad) : 0;

  let total;
  if (modoManual) {
    total = parseCOP(document.getElementById('loanImporteTotal').value) || 0;
  } else {
    total = importe + (importe * interes / 100 * meses);
    document.getElementById('loanImporteTotal').value = total > 0 ? total.toLocaleString('es-CO') : '';
  }

  const cuota = cuotas > 0 ? redondear1000(total / cuotas) : 0;
  document.getElementById('loanCuota').value = cuota > 0 ? cuota.toLocaleString('es-CO') : '';

  const desglose = document.getElementById('loanDesglose');
  if (desglose) {
    if (importe > 0 && cuotas > 0) {
      const interesTotal = importe * interes / 100 * meses;
      desglose.innerHTML = `
        <span>${meses} mes${meses !== 1 ? 'es' : ''} de interés · ${cuotas} cuotas · ${modalidad.toLowerCase()}</span>
        <span>Interés total <strong>${formatCOP(interesTotal)}</strong></span>`;
      desglose.style.display = 'flex';
    } else {
      desglose.style.display = 'none';
    }
  }
}

async function saveLoan(e) {
  e.preventDefault();
  const id        = document.getElementById('loanId').value;
  const importe   = parseCOP(document.getElementById('loanImporte').value);
  const interes   = Number(document.getElementById('loanInteres').value);
  const cuotas    = Number(document.getElementById('loanCuotas').value);
  const modalidad = document.getElementById('loanModalidad').value;
  const modoManual= document.getElementById('toggleManual')?.checked;
  const meses     = cuotas > 0 ? calcMeses(cuotas, modalidad) : 0;
  const importeTotal = modoManual
    ? parseCOP(document.getElementById('loanImporteTotal').value)
    : importe + (importe * interes / 100 * meses);
  const cuota     = cuotas > 0 ? redondear1000(importeTotal / cuotas) : 0;

  const payload = {
    fecha:         document.getElementById('loanFecha').value,
    cliente_id:    Number(document.getElementById('loanCliente').value),
    importe,
    interes,
    cuotas,
    importe_total: importeTotal,
    cuota,
    modalidad,
    user_id:       currentUser.id,   // ← OBLIGATORIO con RLS
  };

  const { error } = id
    ? await sb.from('prestamos').update(payload).eq('id', id)
    : await sb.from('prestamos').insert(payload);

  if (error) { showToast('Error al guardar préstamo: ' + error.message, 'danger'); return; }

  await loadData();
  closeModal('loanModal');
  showToast(id ? 'Préstamo actualizado ✓' : 'Préstamo creado ✓');
}

async function deleteLoan(id) {
  if (!confirm('¿Eliminar este préstamo y sus pagos?')) return;
  await sb.from('pagos').delete().eq('loan_id', id);
  const { error } = await sb.from('prestamos').delete().eq('id', id);
  if (error) { showToast('Error al eliminar.', 'danger'); return; }
  await loadData();
  showToast('Préstamo eliminado.', 'warn');
}

function openQuickClient() {
  document.getElementById('clientFromLoan').value = 1;
  openClientModal();
}
function openPaymentForLoan(loanId) { openPaymentModal(loanId); }

// ══════════════════════════════════════════════════════
// CLIENTES
// ══════════════════════════════════════════════════════
function openClientModal(client) {
  document.getElementById('clientModalTitle').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientId').value           = client?.id           || '';
  document.getElementById('clientNombre').value       = client?.nombre       || '';
  document.getElementById('clientIdentificacion').value= client?.identificacion || '';
  document.getElementById('clientTelefono').value     = client?.telefono     || '';
  document.getElementById('clientEmail').value        = client?.email        || '';
  document.getElementById('clientDireccion').value    = client?.direccion    || '';
  if (!client) document.getElementById('clientFromLoan').value = 0;
  openModal('clientModal');
}

function editClient(c) { openClientModal(c); }

async function saveClient(e) {
  e.preventDefault();
  const id       = document.getElementById('clientId').value;
  const fromLoan = document.getElementById('clientFromLoan').value === '1';

  const payload = {
    nombre:          document.getElementById('clientNombre').value.trim(),
    identificacion:  document.getElementById('clientIdentificacion').value.trim(),
    telefono:        document.getElementById('clientTelefono').value.trim(),
    email:           document.getElementById('clientEmail').value.trim(),
    direccion:       document.getElementById('clientDireccion').value.trim(),
    user_id:         currentUser.id,   // ← OBLIGATORIO con RLS
  };

  let newId = id;
  let err;
  if (id) {
    ({ error: err } = await sb.from('clientes').update(payload).eq('id', id));
    newId = id;
  } else {
    const { data, error } = await sb.from('clientes').insert(payload).select();
    err   = error;
    newId = data?.[0]?.id;
  }

  if (err) { showToast('Error al guardar cliente: ' + err.message, 'danger'); return; }

  await loadData();
  closeModal('clientModal');
  showToast(id ? 'Cliente actualizado ✓' : 'Cliente creado ✓');

  if (fromLoan && newId) {
    openLoanModal();
    setTimeout(() => {
      const sel = document.getElementById('loanCliente');
      sel.innerHTML = '<option value="">Seleccionar cliente</option>' +
        clients.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
      sel.value = String(newId);
    }, 100);
  }
}

async function deleteClient(id) {
  if (loans.some(l => String(l.cliente_id) === String(id))) {
    alert('No puedes eliminar un cliente con préstamos activos.');
    return;
  }
  if (!confirm('¿Eliminar este cliente?')) return;
  const { error } = await sb.from('clientes').delete().eq('id', id);
  if (error) { showToast('Error al eliminar.', 'danger'); return; }
  await loadData();
  showToast('Cliente eliminado.', 'warn');
}

// ══════════════════════════════════════════════════════
// PAGOS
// ══════════════════════════════════════════════════════
function openPaymentModal(preselectedLoanId) {
  document.getElementById('paymentId').value = '';
  const sel = document.getElementById('paymentLoanId');
  sel.innerHTML = loans.map(l =>
    `<option value="${l.id}">${clientName(l.cliente_id)} — ${formatCOP(l.cuota)} × ${l.cuotas}</option>`
  ).join('');
  if (preselectedLoanId) sel.value = String(preselectedLoanId);
  document.getElementById('paymentFecha').value = today();
  fillPaymentInfo();
  openModal('paymentModal');
}

function fillPaymentInfo() {
  const loanId = document.getElementById('paymentLoanId').value;
  const loan   = loans.find(l => String(l.id) === String(loanId));
  const box    = document.getElementById('loanInfoBox');
  if (!loan) { box.innerHTML = ''; return; }

  const balance   = loanBalance(loan);
  const paidCount = payments.filter(p => String(p.loan_id) === String(loan.id)).length;
  const nextDate  = nextDueDate(loan);
  const diffDays  = daysDiff(nextDate);
  const diffLabel = diffDays === 0 ? 'Hoy' : diffDays < 0 ? `Hace ${Math.abs(diffDays)} días` : `En ${diffDays} días`;
  const urgClass  = diffDays < 0 ? 'danger' : diffDays <= 3 ? 'warn' : 'ok';

  box.innerHTML = `
    <div class="loan-info-box">
      <div class="info-row"><div class="info-label">Cuota</div><div class="info-value">${formatCOP(loan.cuota)}</div></div>
      <div class="info-row"><div class="info-label">Pagadas</div><div class="info-value">${paidCount} / ${loan.cuotas}</div></div>
      <div class="info-row"><div class="info-label">Saldo</div><div class="info-value">${formatCOP(balance)}</div></div>
      <div class="info-row">
        <div class="info-label">Próximo venc.</div>
        <div class="info-value"><strong>${nextDate}</strong>
          <span class="chip ${urgClass}" style="font-size:11px;padding:2px 6px">${diffLabel}</span>
        </div>
      </div>
    </div>`;

  const monto = document.getElementById('paymentMonto');
  if (!monto.value) monto.value = Number(loan.cuota).toLocaleString('es-CO');
}

async function savePayment(e) {
  e.preventDefault();
  const id  = document.getElementById('paymentId').value;
  const payload = {
    loan_id: Number(document.getElementById('paymentLoanId').value),
    fecha:   document.getElementById('paymentFecha').value,
    monto:   parseCOP(document.getElementById('paymentMonto').value),
    user_id: currentUser.id,   // ← OBLIGATORIO con RLS
  };

  const { error } = id
    ? await sb.from('pagos').update(payload).eq('id', id)
    : await sb.from('pagos').insert(payload);

  if (error) { showToast('Error al guardar pago: ' + error.message, 'danger'); return; }

  await loadData();
  closeModal('paymentModal');
  showToast(id ? 'Pago actualizado ✓' : 'Pago registrado ✓');
}

async function deletePayment(id) {
  if (!confirm('¿Eliminar este pago?')) return;
  const { error } = await sb.from('pagos').delete().eq('id', id);
  if (error) { showToast('Error al eliminar.', 'danger'); return; }
  await loadData();
  showToast('Pago eliminado.', 'warn');
}

// ── CRONOGRAMA ──────────────────────────────────────
function openSchedule(loanId) {
  const loan   = loans.find(l => String(l.id) === String(loanId));
  if (!loan) return;
  const dates  = allDueDates(loan);
  const client = clientName(loan.cliente_id);

  const rows = dates.map(d => {
    const diff = daysDiff(d.fecha);
    let rowClass = '', badge = '';
    if (d.pagada)        { rowClass = 'sched-paid';  badge = `<span class="chip ok"  style="font-size:11px">Pagada</span>`; }
    else if (diff < 0)   { rowClass = 'sched-late';  badge = `<span class="chip danger" style="font-size:11px">Venció hace ${Math.abs(diff)}d</span>`; }
    else if (diff === 0) { rowClass = 'sched-today'; badge = `<span class="chip warn" style="font-size:11px">Hoy</span>`; }
    else if (diff <= 3)  { rowClass = 'sched-soon';  badge = `<span class="chip warn" style="font-size:11px">En ${diff}d</span>`; }
    return `<tr class="${rowClass}"><td>${d.num}</td><td>${d.fecha}</td><td>${formatCOP(loan.cuota)}</td><td>${badge}</td></tr>`;
  }).join('');

  document.getElementById('scheduleTitle').textContent = `Cronograma — ${client}`;
  document.getElementById('scheduleTable').innerHTML   = rows;
  openModal('scheduleModal');
}

// ── INIT ────────────────────────────────────────────
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) showAppShell(session.user);
  else               showAuthScreen();

  sb.auth.onAuthStateChange((event, session) => {
    if (!session) { currentUser = null; showAuthScreen(); }
  });
})();
