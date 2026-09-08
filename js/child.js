function renderTransactions(transactions) {
  const list = document.getElementById('txList');
  list.innerHTML = '';
  if (transactions.length === 0) {
    list.innerHTML = '<li class="empty-state">Ingen bevægelser endnu</li>';
    return;
  }
  transactions.forEach((tx) => {
    const li = document.createElement('li');
    const isPositive = tx.amount >= 0;
    li.innerHTML = `
      <div class="tx-info">
        <div class="tx-note">
          <span class="tag ${tx.account_type}">${accountLabel(tx.account_type)}</span>
          ${tx.note ? tx.note : ''}
        </div>
        <div class="tx-meta">${formatDate(tx.created_at)}</div>
      </div>
      <div class="tx-amount ${isPositive ? 'positive' : 'negative'}">
        ${isPositive ? '+' : ''}${formatKr(tx.amount)}
      </div>
    `;
    list.appendChild(li);
  });
}

async function loadChild() {
  const txList = document.getElementById('txList');
  if (!requireSupabaseConfigured(txList)) return;

  const { data: child, error: childError } = await supabaseClient
    .from('children')
    .select('slug, name')
    .eq('slug', CHILD_SLUG)
    .single();

  if (childError || !child) {
    document.getElementById('childName').textContent = 'Kunne ikke finde siden';
    return;
  }

  document.getElementById('childName').textContent = `Hej ${child.name}!`;
  document.title = `Lommepenge – ${child.name}`;

  // Hentes uden grænse, så saldoen bliver korrekt selv når der er mere
  // end de 15 bevægelser, vi viser i listen herunder.
  const { data: transactions, error: txError } = await supabaseClient
    .from('transactions')
    .select('account_type, amount, note, created_at')
    .eq('child_slug', CHILD_SLUG)
    .order('created_at', { ascending: false });

  if (txError) {
    txList.innerHTML = '<li class="empty-state">Kunne ikke hente bevægelser</li>';
    return;
  }

  const balances = { lommepenge: 0, toejpenge: 0 };
  transactions.forEach((tx) => {
    balances[tx.account_type] += tx.amount;
  });

  document.getElementById('lommepengeBalance').textContent = formatKr(balances.lommepenge);
  document.getElementById('toejpengeBalance').textContent = formatKr(balances.toejpenge);
  renderTransactions(transactions.slice(0, 15));
}

loadChild();
