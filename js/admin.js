const loginSection = document.getElementById('loginSection');
const adminSection = document.getElementById('adminSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutButton = document.getElementById('logoutButton');
const txForm = document.getElementById('txForm');
const txError = document.getElementById('txError');
const childSelect = document.getElementById('childSelect');
const childrenOverview = document.getElementById('childrenOverview');

function showLogin() {
  loginSection.hidden = false;
  adminSection.hidden = true;
}

function showAdmin() {
  loginSection.hidden = true;
  adminSection.hidden = false;
  loadOverview();
}

async function init() {
  if (!requireSupabaseConfigured(loginSection)) {
    loginSection.hidden = false;
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  if (data.session) {
    showAdmin();
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session) {
      showAdmin();
    } else {
      showLogin();
    }
  });
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    loginError.textContent = 'Forkert email eller adgangskode';
  } else {
    loginForm.reset();
  }
});

logoutButton.addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
});

async function loadOverview() {
  const { data: children, error: childrenError } = await supabaseClient
    .from('children')
    .select('slug, name');

  if (childrenError) {
    childrenOverview.innerHTML = '<p class="empty-state">Kunne ikke hente børn</p>';
    return;
  }

  const { data: transactions, error: txListError } = await supabaseClient
    .from('transactions')
    .select('id, child_slug, account_type, amount, note, created_at')
    .order('created_at', { ascending: false });

  if (txListError) {
    childrenOverview.innerHTML = '<p class="empty-state">Kunne ikke hente bevægelser</p>';
    return;
  }

  childSelect.innerHTML = children
    .map((c) => `<option value="${c.slug}">${c.name}</option>`)
    .join('');

  childrenOverview.innerHTML = '';
  children.forEach((child) => {
    const childTx = transactions.filter((tx) => tx.child_slug === child.slug);
    const balances = { lommepenge: 0, toejpenge: 0 };
    childTx.forEach((tx) => {
      balances[tx.account_type] += tx.amount;
    });

    const section = document.createElement('div');
    section.className = 'card';
    section.innerHTML = `
      <div class="child-admin-header">
        <h2>${child.name}</h2>
      </div>
      <div class="balance-cards">
        <div class="balance-card lommepenge">
          <p class="label">Lommepenge</p>
          <p class="amount">${formatKr(balances.lommepenge)}</p>
        </div>
        <div class="balance-card toejpenge">
          <p class="label">Tøjpenge</p>
          <p class="amount">${formatKr(balances.toejpenge)}</p>
        </div>
      </div>
      <p class="section-title">Alle bevægelser</p>
      <ul class="tx-list">
        ${
          childTx.length === 0
            ? '<li class="empty-state">Ingen bevægelser endnu</li>'
            : childTx
                .map(
                  (tx) => `
              <li>
                <div class="tx-info">
                  <div class="tx-note">
                    <span class="tag ${tx.account_type}">${accountLabel(tx.account_type)}</span>
                    ${tx.note ? tx.note : ''}
                  </div>
                  <div class="tx-meta">${formatDate(tx.created_at)}</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <div class="tx-amount ${tx.amount >= 0 ? 'positive' : 'negative'}">
                    ${tx.amount >= 0 ? '+' : ''}${formatKr(tx.amount)}
                  </div>
                  <button type="button" class="secondary" data-delete-id="${tx.id}">Slet</button>
                </div>
              </li>
            `
                )
                .join('')
        }
      </ul>
    `;
    childrenOverview.appendChild(section);
  });

  childrenOverview.querySelectorAll('[data-delete-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Slet denne bevægelse?')) return;
      const { error } = await supabaseClient
        .from('transactions')
        .delete()
        .eq('id', btn.dataset.deleteId);
      if (!error) loadOverview();
    });
  });
}

txForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  txError.textContent = '';
  const formData = new FormData(txForm);
  const direction = formData.get('direction');
  const rawAmount = Number(formData.get('amount'));
  const amount = direction === 'out' ? -Math.abs(rawAmount) : Math.abs(rawAmount);

  const { error } = await supabaseClient.from('transactions').insert({
    child_slug: formData.get('childSlug'),
    account_type: formData.get('accountType'),
    amount,
    note: formData.get('note'),
  });

  if (!error) {
    txForm.reset();
    loadOverview();
  } else {
    txError.textContent = 'Kunne ikke tilføje bevægelsen';
  }
});

init();
