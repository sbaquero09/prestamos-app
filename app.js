// =====================================================
// PRESTAMOS PRO — app.js
// =====================================================

// ── CONFIG SUPABASE ─────────────────────────────────
const SUPABASE_URL = 'https://xxvzfajudcqdwehfhkjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4dnpmYWp1ZGNxZHdlaGZoa2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxNzAwMDgsImV4cCI6MjA5Mzc0NjAwOH0.CfTzLor2xiSdVGvwv9M6DGelXpUYsi_kyhfYs2n-n9w';
const useSupabase = SUPABASE_URL !== 'TU_SUPABASE_URL';
const sb = useSupabase ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ── STATE ────────────────────────────────────────────
let currentTab = 'finanzas';
let clients    = [];
let loans      = [];
let payments   = [];
let config     = { capital_inicial: 2000000 };

// ── FORMATEO PESOS COLOMBIANOS ────────────────────────
function formatCOP(value) {
  const num = Number(String(value).replace(/\./g, '').replace(',', '.')) || 0;
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(num);
}

function parseCOP(str) {
  return Number(String(str).replace(/\./g, '').replace(',', '').replace('$', '').replace(/\s/g, '')) || 0;
}

// Formatea mientras el usuario escribe: 1000000 → 1.000.000
function formatInput(input) {
  const raw = parseCOP(input.value);
  if (raw > 0) input.value = raw.toLocaleString('es-CO');
  else input.value = '';
}

// Aplica formateo a todos los campos money-input al cargar
function initMoneyInputs() {
  document.querySelectorAll('.money-input').forEach(input => {
    input.addEventListener('blur',  () => formatInput(input));
    input.addEventListener('focus', () => {
      const raw = parseCOP(input.value);
      input.value = raw > 0 ? raw : '';
    });
  });
}



// ── REDONDEO AL MÚLTIPLO DE 5.000 HACIA ARRIBA ───────
// Ejemplos:
//   257.142 → 260.000
//   251.582 → 255.000
//   240.000 → 240.000  (exacto, no cambia)
function redondear5000(valor) {
  return Math.ceil(valor / 5000) * 5000;
}

// ── UTILIDADES ───────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10); }
function norm(s) { return String(s || '').toLowerCase(); }

function daysDiff(dateStr) {
  const a = new Date(dateStr + 'T00:00:00');
  const b = new Date(today() + 'T00:00:00');
  return Math.floor((a - b) / 86400000);
}

// Días entre cuotas según modalidad
const STEPS = { DIARIO: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30 };

// Fecha de vencimiento de la cuota N (base 1)
// Cuota 1 → fecha + 1 step, cuota 2 → fecha + 2 steps, etc.
function dueDateForCuota(loan, cuotaNum) {
  const start = new Date(loan.fecha + 'T00:00:00');
  const step  = STEPS[loan.modalidad] || 7;
  start.setDate(start.getDate() + step * cuotaNum);
  return start.toISOString().slice(0, 10);
}

// Próxima cuota pendiente de pago
function nextDueDate(loan) {
  const paidCount = payments.filter(p => String(p.loan_id) === String(loan.id)).length;
  const next = Math.min(paidCount + 1, Number(loan.cuotas));
  return dueDateForCuota(loan, next);
}

// Todas las fechas de cuotas del préstamo (para cronograma)
function allDueDates(loan) {
  return Array.from({ length: Number(loan.cuotas) }, (_, i) => ({
    num:    i + 1,
    fecha:  dueDateForCuota(loan, i + 1),
    pagada: i < payments.filter(p => String(p.loan_id) === String(loan.id)).length,
  }));
}

function clientById(id)   { return clients.find(c => String(c.id) === String(id)); }
function clientName(id)   { return clientById(id)?.nombre || 'Sin cliente'; }
function loanExpected(l)  { return Number(l.cuota || 0) * Number(l.cuotas || 0); }
function loanPaid(loanId) { return payments.filter(p => String(p.loan_id) === String(loanId)).reduce((s, p) => s + Number(p.monto || 0), 0); }
function loanBalance(l)   { return Math.max(0, loanExpected(l) - loanPaid(l.id)); }

function loansDueSoon() {
  return loans.filter(l => {
    if (loanBalance(l) <= 0) return false;
    const diff = daysDiff(nextDueDate(l));
    return diff >= 0 && diff <= 3;
  });
}

// ── NAVEGACIÓN ───────────────────────────────────────
function goTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + tab).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('fab').style.display = tab === 'finanzas' ? 'none' : 'flex';
}

function primaryAction() {
  if (currentTab === 'prestamos') openLoanModal();
  else if (currentTab === 'pagos')     openPaymentModal();
  else if (currentTab === 'clientes')  openClientModal();
}

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// cerrar modal tocando fondo
document.querySelectorAll('.modal').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); })
);

// ── CARGA DE DATOS ───────────────────────────────────
async function loadData() {
  if (!sb) {
    config   = { capital_inicial: Number(localStorage.getItem('capital_inicial') || 2000000) };
    clients  = [
      { id:1, nombre:'José Fernando Mecánico', identificacion:'12345678', telefono:'3001112233', email:'', direccion:'Cali' },
      { id:2, nombre:'David Mecánico',          identificacion:'87654321', telefono:'3109998877', email:'', direccion:'Cali' },
      { id:3, nombre:'Natalia Lozano Rebolledo', identificacion:'11223344', telefono:'3152223344', email:'', direccion:'Cali' },
    ];
    loans = [
      { id:11, fecha:'2026-05-01', cliente_id:1, importe:2000000, interes:20, modalidad:'SEMANAL',   cuotas:10, importe_total:2400000, cuota:240000 },
      { id:12, fecha:'2026-05-03', cliente_id:2, importe:800000,  interes:15, modalidad:'QUINCENAL', cuotas:4,  importe_total:920000,  cuota:230000 },
      { id:13, fecha:'2026-05-05', cliente_id:3, importe:1200000, interes:18, modalidad:'DIARIO',    cuotas:12, importe_total:1416000, cuota:118000 },
    ];
    payments = [
      { id:1, loan_id:11, fecha:'2026-05-08', monto:240000 },
      { id:2, loan_id:11, fecha:'2026-05-15', monto:240000 },
      { id:3, loan_id:12, fecha:'2026-05-18', monto:230000 },
    ];
    renderAll();
    return;
  }

  const [{ data: cfg }, { data: c }, { data: l }, { data: p }] = await Promise.all([
    sb.from('app_config').select('*').limit(1),
    sb.from('clientes').select('*').order('nombre'),
    sb.from('prestamos').select('*').order('fecha', { ascending: false }),
    sb.from('pagos').select('*').order('fecha', { ascending: false }),
  ]);

  config   = { capital_inicial: Number(cfg?.[0]?.capital_inicial || 2000000) };
  clients  = c || [];
  loans    = l || [];
  payments = p || [];
  renderAll();
}

// ── RENDER ───────────────────────────────────────────
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
    ? `<div class="alert-warn"><strong>⚠ Cobros próximos</strong><p>${due.length} préstamo(s) con cuota en los próximos 3 días.</p></div>`
    : '';
}

function renderLoans() {
  const q = norm(document.getElementById('searchLoans').value);
  const list = loans.filter(l => norm(clientName(l.cliente_id)).includes(q));
  const wrap = document.getElementById('loanList');
  if (!list.length) { wrap.innerHTML = '<div class="empty">No hay préstamos.</div>'; return; }

  wrap.innerHTML = list.map(l => {
    const next    = nextDueDate(l);
    const diff    = daysDiff(next);
    const balance = loanBalance(l);
    const paid    = loanPaid(l.id);
    const total   = loanExpected(l);
    const pct     = total > 0 ? Math.min(100, Math.round(paid / total * 100)) : 0;
    let statusChip = `<span class="chip ok">Al día</span>`;
    if (balance <= 0) statusChip = `<span class="chip">Completado</span>`;
    else if (diff < 0) statusChip = `<span class="chip danger">Vencido</span>`;
    else if (diff <= 3) statusChip = `<span class="chip warn">Vence ${next}</span>`;
    const modClass = l.modalidad?.toLowerCase() || 'semanal';
    return `<div class="list-item">
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
          <div style="font-size:13px;color:var(--muted);margin-top:4px">Saldo: ${formatCOP(balance)} · Próx. cuota: <strong>${next}</strong></div>
        </div>
        <div class="item-actions">
          <button class="icon-btn" title="Ver cronograma" onclick="openSchedule(${l.id})">📋</button>
          <button class="icon-btn" title="Registrar pago" onclick="openPaymentForLoan(${l.id})">💳</button>
          <button class="icon-btn" title="Editar" onclick='editLoan(${JSON.stringify(l)})'>✏️</button>
          <button class="icon-btn" title="Eliminar" onclick="deleteLoan(${l.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderPayments() {
  const due = loansDueSoon();
  document.getElementById('paymentsAlert').innerHTML = due.length
    ? `<div class="alert-info">📅 ${due.length} préstamo(s) con pago próximo a vencer. Registra el pago aquí.</div>`
    : '';

  const q    = norm(document.getElementById('searchPayments').value);
  const list = payments.filter(p => {
    const loan = loans.find(l => String(l.id) === String(p.loan_id));
    return !loan || norm(clientName(loan.cliente_id)).includes(q) || norm(p.fecha).includes(q);
  });
  const wrap = document.getElementById('paymentList');
  if (!list.length) { wrap.innerHTML = '<div class="empty">No hay pagos registrados.</div>'; return; }

  wrap.innerHTML = list.map(p => {
    const loan = loans.find(l => String(l.id) === String(p.loan_id));
    const name = loan ? clientName(loan.cliente_id) : 'Préstamo eliminado';
    return `<div class="list-item">
      <div class="list-top">
        <div>
          <div class="item-title">${name}</div>
          <div class="item-meta">${p.fecha}</div>
          <div class="chips"><span class="chip ok">✓ Pago registrado</span></div>
          <div class="item-amount">${formatCOP(p.monto)}</div>
        </div>
        <div class="item-actions">
          <button class="icon-btn" title="Eliminar" onclick="deletePayment(${p.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderClients() {
  const q    = norm(document.getElementById('searchClients').value);
  const list = clients.filter(c => norm(c.nombre).includes(q) || norm(c.identificacion).includes(q) || norm(c.telefono).includes(q));
  const wrap = document.getElementById('clientList');
  if (!list.length) { wrap.innerHTML = '<div class="empty">No hay clientes.</div>'; return; }

  wrap.innerHTML = list.map(c => {
    const n = loans.filter(l => String(l.cliente_id) === String(c.id)).length;
    return `<div class="list-item">
      <div class="list-top">
        <div>
          <div class="item-title">${c.nombre}</div>
          <div class="item-meta">${c.identificacion || 'Sin cédula'} · ${c.telefono || 'Sin teléfono'}</div>
          <div class="chips"><span class="chip">${n} préstamo${n !== 1 ? 's' : ''}</span></div>
          ${c.email ? `<div style="font-size:13px;color:var(--muted);margin-top:6px">${c.email}</div>` : ''}
        </div>
        <div class="item-actions">
          <button class="icon-btn" onclick='editClient(${JSON.stringify(c)})'>✏️</button>
          <button class="icon-btn" onclick="deleteClient(${c.id})">🗑️</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── SETTINGS ─────────────────────────────────────────
function openSettings() {
  const v = Number(config.capital_inicial || 0);
  document.getElementById('cfgCapital').value = v > 0 ? v.toLocaleString('es-CO') : '';
  openModal('settingsModal');
}

async function saveSettings() {
  const val = parseCOP(document.getElementById('cfgCapital').value);
  config.capital_inicial = val;
  localStorage.setItem('capital_inicial', val);
  if (sb) {
    const { data } = await sb.from('app_config').select('id').limit(1);
    if (data?.length) await sb.from('app_config').update({ capital_inicial: val }).eq('id', data[0].id);
    else await sb.from('app_config').insert({ capital_inicial: val });
  }
  closeModal('settingsModal');
  renderHeader();
  renderStats();
}

// ── PRÉSTAMOS ────────────────────────────────────────
function openLoanModal(loan) {
  document.getElementById('loanModalTitle').textContent = loan ? 'Editar préstamo' : 'Nuevo préstamo';
  document.getElementById('loanId').value = loan?.id || '';
  document.getElementById('loanFecha').value = loan?.fecha || today();

  const sel = document.getElementById('loanCliente');
  sel.innerHTML = '<option value="">Seleccionar cliente…</option>' +
    clients.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
  if (loan?.cliente_id) sel.value = loan.cliente_id;

  document.getElementById('loanImporte').value   = loan?.importe ? Number(loan.importe).toLocaleString('es-CO') : '';
  document.getElementById('loanInteres').value   = loan?.interes ?? '';
  document.getElementById('loanModalidad').value = loan?.modalidad || 'SEMANAL';
  document.getElementById('loanCuotas').value    = loan?.cuotas || '';
  calcLoan(loan);
  openModal('loanModal');
}

function editLoan(loan) { openLoanModal(loan); }

// ── CUOTAS POR MES SEGÚN MODALIDAD ───────────────────
// DIARIO: ~30 cuotas = 1 mes
// SEMANAL: ~4 cuotas = 1 mes
// QUINCENAL: 2 cuotas = 1 mes
// MENSUAL: 1 cuota = 1 mes
const CUOTAS_POR_MES = { DIARIO: 30, SEMANAL: 4, QUINCENAL: 2, MENSUAL: 1 };

// Calcula cuántos períodos de interés (meses) corresponden a N cuotas
// según la modalidad. Ej: QUINCENAL 7 cuotas → ceil(7/2) = 4 meses
function calcMeses(cuotas, modalidad) {
  const cpm = CUOTAS_POR_MES[modalidad] || 1;
  return Math.ceil(cuotas / cpm);
}

function calcLoan(loan) {
  const importe   = parseCOP(document.getElementById('loanImporte').value) || loan?.importe || 0;
  const interes   = Number(document.getElementById('loanInteres').value ?? loan?.interes ?? 0);
  const cuotas    = Number(document.getElementById('loanCuotas').value || loan?.cuotas || 0);
  const modalidad = document.getElementById('loanModalidad').value || loan?.modalidad || 'SEMANAL';

  // Interés mensual simple: se aplica una vez por mes completo
  const meses = cuotas > 0 ? calcMeses(cuotas, modalidad) : 0;
  const total  = importe + importe * (interes / 100) * meses;
  const cuota  = cuotas > 0 ? redondear5000(total / cuotas) : 0;

  document.getElementById('loanImporteTotal').value = total > 0 ? total.toLocaleString('es-CO') : '';
  document.getElementById('loanCuota').value        = cuota > 0 ? cuota.toLocaleString('es-CO') : '';

  // Mostrar desglose al usuario
  const desglose = document.getElementById('loanDesglose');
  if (desglose && importe > 0 && cuotas > 0) {
    const interesTotal = importe * (interes / 100) * meses;
    desglose.innerHTML = `<span>📅 ${meses} mes${meses !== 1 ? 'es' : ''} de interés (${cuotas} cuotas ${modalidad.toLowerCase()})</span>
      <span>Interés total: <strong>${formatCOP(interesTotal)}</strong></span>`;
    desglose.style.display = 'flex';
  } else if (desglose) {
    desglose.style.display = 'none';
  }
}

async function saveLoan(e) {
  e.preventDefault();
  const id = document.getElementById('loanId').value;
  const importe      = parseCOP(document.getElementById('loanImporte').value);
  const interes      = Number(document.getElementById('loanInteres').value);
  const cuotas       = Number(document.getElementById('loanCuotas').value);
  const modalidad    = document.getElementById('loanModalidad').value;
  const meses        = cuotas > 0 ? calcMeses(cuotas, modalidad) : 0;
  const importeTotal = importe + importe * (interes / 100) * meses;
  const cuota        = cuotas > 0 ? redondear5000(importeTotal / cuotas) : 0;

  const payload = {
    fecha:         document.getElementById('loanFecha').value,
    cliente_id:    Number(document.getElementById('loanCliente').value),
    importe, interes, cuotas, importe_total: importeTotal, cuota,
    modalidad,
  };

  if (sb) {
    if (id) await sb.from('prestamos').update(payload).eq('id', id);
    else    await sb.from('prestamos').insert(payload);
    await loadData();
  } else {
    if (id) loans = loans.map(l => String(l.id) === id ? { ...l, ...payload } : l);
    else    loans.unshift({ ...payload, id: Date.now() });
    renderAll();
  }
  closeModal('loanModal');
}

async function deleteLoan(id) {
  if (!confirm('¿Eliminar este préstamo y sus pagos?')) return;
  if (sb) {
    await sb.from('pagos').delete().eq('loan_id', id);
    await sb.from('prestamos').delete().eq('id', id);
    await loadData();
  } else {
    loans    = loans.filter(l => l.id !== id);
    payments = payments.filter(p => p.loan_id !== id);
    renderAll();
  }
}

// Crear cliente rápido desde modal de préstamo
function openQuickClient() {
  document.getElementById('clientFromLoan').value = '1';
  openClientModal();
}

// Abrir pago preseleccionando préstamo
function openPaymentForLoan(loanId) {
  openPaymentModal(loanId);
}

// ── CLIENTES ─────────────────────────────────────────
function openClientModal(client) {
  document.getElementById('clientModalTitle').textContent = client ? 'Editar cliente' : 'Nuevo cliente';
  document.getElementById('clientId').value           = client?.id || '';
  document.getElementById('clientNombre').value        = client?.nombre || '';
  document.getElementById('clientIdentificacion').value = client?.identificacion || '';
  document.getElementById('clientTelefono').value      = client?.telefono || '';
  document.getElementById('clientEmail').value         = client?.email || '';
  document.getElementById('clientDireccion').value     = client?.direccion || '';
  if (!client) document.getElementById('clientFromLoan').value = '0';
  openModal('clientModal');
}
function editClient(c) { openClientModal(c); }

async function saveClient(e) {
  e.preventDefault();
  const id      = document.getElementById('clientId').value;
  const fromLoan = document.getElementById('clientFromLoan').value === '1';
  const payload = {
    nombre:         document.getElementById('clientNombre').value,
    identificacion: document.getElementById('clientIdentificacion').value,
    telefono:       document.getElementById('clientTelefono').value,
    email:          document.getElementById('clientEmail').value,
    direccion:      document.getElementById('clientDireccion').value,
  };

  let newId = id;

  if (sb) {
    if (id) { await sb.from('clientes').update(payload).eq('id', id); }
    else {
      const { data } = await sb.from('clientes').insert(payload).select();
      newId = data?.[0]?.id;
    }
    await loadData();
  } else {
    if (id) {
      clients = clients.map(c => String(c.id) === id ? { ...c, ...payload } : c);
      newId = id;
    } else {
      newId = Date.now();
      clients.unshift({ ...payload, id: newId });
    }
    renderAll();
  }

  closeModal('clientModal');

  // Si se creó desde préstamo, re-abrir el modal de préstamo con el cliente seleccionado
  if (fromLoan && newId) {
    openLoanModal();
    setTimeout(() => {
      const sel = document.getElementById('loanCliente');
      sel.innerHTML = '<option value="">Seleccionar cliente…</option>' +
        clients.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
      sel.value = String(newId);
    }, 100);
  }
}

async function deleteClient(id) {
  if (loans.some(l => String(l.cliente_id) === String(id))) {
    alert('No puedes eliminar un cliente con préstamos activos.'); return;
  }
  if (!confirm('¿Eliminar este cliente?')) return;
  if (sb) { await sb.from('clientes').delete().eq('id', id); await loadData(); }
  else { clients = clients.filter(c => c.id !== id); renderAll(); }
}

// ── PAGOS ────────────────────────────────────────────
function openPaymentModal(preselectedLoanId) {
  document.getElementById('paymentId').value = '';
  const sel = document.getElementById('paymentLoanId');
  sel.innerHTML = loans.map(l => `<option value="${l.id}">${clientName(l.cliente_id)} · ${formatCOP(l.cuota)}×${l.cuotas}</option>`).join('');
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
  const nextDate = nextDueDate(loan);
  const diffDays = daysDiff(nextDate);
  const diffLabel = diffDays === 0 ? '⚠ Hoy' : diffDays < 0 ? `⚠ Hace ${Math.abs(diffDays)} día(s)` : `En ${diffDays} día(s)`;
  const urgClass  = diffDays <= 0 ? 'danger' : diffDays <= 3 ? 'warn' : 'ok';
  box.innerHTML = `<div class="loan-info-box">
    <div class="info-row"><div class="info-label">Cuota</div><div class="info-value">${formatCOP(loan.cuota)}</div></div>
    <div class="info-row"><div class="info-label">Pagadas</div><div class="info-value">${paidCount} / ${loan.cuotas}</div></div>
    <div class="info-row"><div class="info-label">Saldo</div><div class="info-value">${formatCOP(balance)}</div></div>
    <div class="info-row">
      <div class="info-label">Próximo venc.</div>
      <div class="info-value"><strong>${nextDate}</strong> <span class="chip ${urgClass}" style="font-size:11px;padding:2px 6px">${diffLabel}</span></div>
    </div>
  </div>`;
  // Pre-llenar el monto con la cuota
  const monto = document.getElementById('paymentMonto');
  if (!monto.value) monto.value = Number(loan.cuota).toLocaleString('es-CO');
}

async function savePayment(e) {
  e.preventDefault();
  const id      = document.getElementById('paymentId').value;
  const payload = {
    loan_id: Number(document.getElementById('paymentLoanId').value),
    fecha:   document.getElementById('paymentFecha').value,
    monto:   parseCOP(document.getElementById('paymentMonto').value),
  };
  if (sb) {
    if (id) await sb.from('pagos').update(payload).eq('id', id);
    else    await sb.from('pagos').insert(payload);
    await loadData();
  } else {
    payments.unshift({ ...payload, id: Date.now() });
    renderAll();
  }
  closeModal('paymentModal');
}

async function deletePayment(id) {
  if (!confirm('¿Eliminar este pago?')) return;
  if (sb) { await sb.from('pagos').delete().eq('id', id); await loadData(); }
  else { payments = payments.filter(p => p.id !== id); renderAll(); }
}

// ── CRONOGRAMA DE CUOTAS ─────────────────────────────
function openSchedule(loanId) {
  const loan = loans.find(l => String(l.id) === String(loanId));
  if (!loan) return;
  const dates   = allDueDates(loan);
  const client  = clientName(loan.cliente_id);
  const rows    = dates.map(d => {
    const diff  = daysDiff(d.fecha);
    let rowClass = '';
    let badge   = '';
    if (d.pagada) { rowClass = 'sched-paid'; badge = '<span class="chip ok" style="font-size:11px">✓ Pagada</span>'; }
    else if (diff < 0)  { rowClass = 'sched-late'; badge = `<span class="chip danger" style="font-size:11px">Venció hace ${Math.abs(diff)}d</span>`; }
    else if (diff === 0){ rowClass = 'sched-today'; badge = '<span class="chip warn" style="font-size:11px">⚠ Hoy</span>'; }
    else if (diff <= 3) { rowClass = 'sched-soon'; badge = `<span class="chip warn" style="font-size:11px">En ${diff}d</span>`; }
    return `<tr class="${rowClass}">
      <td>${d.num}</td>
      <td>${d.fecha}</td>
      <td>${formatCOP(loan.cuota)}</td>
      <td>${badge}</td>
    </tr>`;
  }).join('');

  document.getElementById('scheduleTitle').textContent = `Cronograma — ${client}`;
  document.getElementById('scheduleTable').innerHTML = rows;
  openModal('scheduleModal');
}

// ── INIT ─────────────────────────────────────────────
goTab('finanzas');
initMoneyInputs();
loadData();
