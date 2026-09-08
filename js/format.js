function formatKr(amount) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('da-DK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${sign}${formatted} kr`;
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' kl. ' + d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
}

function accountLabel(type) {
  return type === 'lommepenge' ? 'Lommepenge' : 'Tøjpenge';
}
