(() => {
  const root = document.getElementById('marginTrackerRoot');
  const yearInput = document.getElementById('finance-year');
  if (!root) return;

  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });

  const currencyFine = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const percentFmt = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const quarterNames = ['Q1', 'Q2', 'Q3', 'Q4'];
  const categories = ['Labor', 'Marketing', 'Software', 'Contractors', 'Operations', 'Taxes', 'Misc'];
  const invoiceStatuses = ['Pending', 'Billed', 'Partially Paid', 'Paid', 'Overdue'];
  const pageSize = 8;
  let svgUid = 0;

  const state = {
    loading: true,
    error: null,
    year: getYearFromInput(),
    view: 'year',
    month: new Date().getMonth() + 1,
    quarter: Math.ceil((new Date().getMonth() + 1) / 3),
    sortKey: 'netProfit',
    sortDir: 'desc',
    page: 1,
    expandedId: null,
    filters: defaultFilters(),
    data: null,
    refreshCounter: 0,
    currentModel: null
  };

  function getYearFromInput() {
    const parsed = Number.parseInt(yearInput?.value, 10);
    return Number.isFinite(parsed) ? parsed : new Date().getFullYear();
  }

  function defaultFilters() {
    return {
      search: '',
      clientId: '',
      category: '',
      project: '',
      invoiceStatus: '',
      fromDate: '',
      toDate: '',
      minRevenue: '',
      maxRevenue: '',
      minMargin: '',
      maxMargin: '',
      expenseType: ''
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function toNumber(value) {
    if (typeof value === 'string') {
      const cleaned = value.replace(/[^0-9.-]/g, '');
      const num = Number(cleaned);
      return Number.isFinite(num) ? num : 0;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function toDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function formatMoney(value) {
    return currency.format(toNumber(value));
  }

  function formatMoneyFine(value) {
    return currencyFine.format(toNumber(value));
  }

  function formatDelta(value, kind = 'percent') {
    const num = toNumber(value);
    const sign = num > 0 ? '+' : '';
    if (kind === 'points') return `${sign}${percentFmt.format(num)} pts`;
    return `${sign}${percentFmt.format(num)}%`;
  }

  function formatDate(value) {
    const date = toDate(value);
    if (!date) return 'No date';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function periodLabel(year, view, month, quarter) {
    if (view === 'month') return `${monthNames[month - 1]} ${year}`;
    if (view === 'quarter') return `${quarterNames[quarter - 1]} ${year}`;
    return `${year}`;
  }

  function periodRange(year, view, month, quarter) {
    if (view === 'month') {
      const start = new Date(year, clamp(month - 1, 0, 11), 1);
      const end = new Date(year, clamp(month - 1, 0, 11) + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }

    if (view === 'quarter') {
      const quarterIndex = clamp(quarter - 1, 0, 3);
      const startMonth = quarterIndex * 3;
      const start = new Date(year, startMonth, 1);
      const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }

    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return { start, end };
  }

  function previousRange(year, view, month, quarter) {
    if (view === 'month') {
      let prevMonth = month - 1;
      let prevYear = year;
      if (prevMonth < 1) {
        prevMonth = 12;
        prevYear -= 1;
      }
      return periodRange(prevYear, 'month', prevMonth, quarter);
    }

    if (view === 'quarter') {
      let prevQuarter = quarter - 1;
      let prevYear = year;
      if (prevQuarter < 1) {
        prevQuarter = 4;
        prevYear -= 1;
      }
      return periodRange(prevYear, 'quarter', month, prevQuarter);
    }

    return periodRange(year - 1, 'year', month, quarter);
  }

  function samePeriodLastYear(year, view, month, quarter) {
    if (view === 'month') return periodRange(year - 1, 'month', month, quarter);
    if (view === 'quarter') return periodRange(year - 1, 'quarter', month, quarter);
    return periodRange(year - 1, 'year', month, quarter);
  }

  function bucketLabel(view, index) {
    if (view === 'month') return monthNames[index];
    if (view === 'quarter') return quarterNames[index];
    return `${index + 1}`;
  }

  function buildBuckets(view) {
    if (view === 'month') {
      const days = new Date(state.year, state.month, 0).getDate();
      return Array.from({ length: days }, (_, i) => createBucket(`${i + 1}`, i + 1));
    }
    if (view === 'quarter') {
      return Array.from({ length: 3 }, (_, i) => createBucket(monthNames[(state.quarter - 1) * 3 + i], i + 1));
    }
    return Array.from({ length: 12 }, (_, i) => createBucket(bucketLabel(view, i), i + 1));
  }

  function createBucket(label, order) {
    return {
      label,
      order,
      revenue: 0,
      operatingExpenses: 0,
      taxExpenses: 0,
      totalExpenses: 0,
      grossProfit: 0,
      netProfit: 0,
      marginPct: 0,
      paymentCount: 0,
      expenseCount: 0
    };
  }

  function normalizeClient(row) {
    return {
      id: Number(row.id),
      name: normalizeText(row.name),
      status: normalizeText(row.status || 'Active'),
      created_at: row.created_at || null,
      total_due: toNumber(row.total_due),
      amount_paid: toNumber(row.amount_paid),
      balance: toNumber(row.balance)
    };
  }

  function normalizePayment(row) {
    return {
      id: Number(row.id),
      client_id: row.client_id === null || row.client_id === undefined || row.client_id === '' ? null : Number(row.client_id),
      amount: toNumber(row.amount),
      payment_date: row.payment_date || null
    };
  }

  function normalizeExpense(row) {
    return {
      id: Number(row.id),
      client_id: row.client_id === null || row.client_id === undefined || row.client_id === '' ? null : Number(row.client_id),
      client_name: normalizeText(row.client_name),
      category: normalizeText(row.category || 'Misc'),
      project: normalizeText(row.project || ''),
      invoice_status: normalizeText(row.invoice_status || 'Pending'),
      amount: toNumber(row.amount),
      expense_type: normalizeText(row.expense_type || 'one-time'),
      recurring: Boolean(row.recurring === true || row.recurring === 'true' || row.recurring === 1 || row.recurring === '1'),
      expense_date: row.expense_date || null,
      notes: normalizeText(row.notes || ''),
      marginSnapshot: parseMarginSnapshot(row.notes),
      attachment_url: normalizeText(row.attachment_url || ''),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null
    };
  }

  function parseMarginSnapshot(notes) {
    // Margin snapshot data is stored inside notes so we can keep the database schema unchanged.
    if (!notes) return null;
    const raw = String(notes).trim();
    if (!raw.startsWith('{') || !raw.endsWith('}')) return null;
    try {
      const parsed = JSON.parse(raw);
      const jobTotal = toNumber(parsed.jobTotal ?? parsed.job_total);
      const moneyReceived = toNumber(parsed.moneyReceived ?? parsed.money_received);
      const jobCost = toNumber(parsed.jobCost ?? parsed.job_cost);
      const marginPct = toNumber(parsed.marginPct ?? parsed.margin_pct);
      if (!Number.isFinite(marginPct) && (!Number.isFinite(jobTotal) || jobTotal <= 0)) return null;
      return {
        kind: parsed.kind || 'quick-margin',
        jobTotal,
        moneyReceived,
        jobCost,
        marginPct: Number.isFinite(marginPct) ? marginPct : computeMarginPct(jobTotal, jobCost),
        noteText: normalizeText(parsed.noteText ?? parsed.note_text ?? '')
      };
    } catch {
      return null;
    }
  }

  function computeMarginPct(jobTotal, jobCost) {
    const total = toNumber(jobTotal);
    const cost = toNumber(jobCost);
    if (!Number.isFinite(total) || total === 0) return 0;
    return ((total - cost) / total) * 100;
  }

  function filterDateRange(value, start, end) {
    const date = toDate(value);
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  }

  function matchesSearch(haystack, term) {
    if (!term) return true;
    return haystack.toLowerCase().includes(term.toLowerCase());
  }

  function buildAnalysis(rawPayload) {
    const clients = (rawPayload?.clients || []).map(normalizeClient);
    const payments = (rawPayload?.payments || []).map(normalizePayment);
    const expenses = (rawPayload?.expenses || []).map(normalizeExpense);
    const nameById = new Map(clients.map((client) => [Number(client.id), client.name]));
    const idByName = new Map(clients.map((client) => [client.name.toLowerCase(), Number(client.id)]));

    const activeRange = periodRange(state.year, state.view, state.month, state.quarter);
    const comparisonRange = state.view === 'year'
      ? samePeriodLastYear(state.year, state.view, state.month, state.quarter)
      : previousRange(state.year, state.view, state.month, state.quarter);

    const activePayments = payments.filter((payment) => {
      const match = filterDateRange(payment.payment_date, activeRange.start, activeRange.end);
      return match;
    });

    const activeExpenses = expenses.map((expense) => {
      const resolvedClientId = expense.client_id || (expense.client_name ? idByName.get(expense.client_name.toLowerCase()) || null : null);
      return { ...expense, resolvedClientId };
    }).filter((expense) => filterDateRange(expense.expense_date, activeRange.start, activeRange.end));

    const previousPayments = payments.filter((payment) => filterDateRange(payment.payment_date, comparisonRange.start, comparisonRange.end));
    const previousExpenses = expenses.map((expense) => {
      const resolvedClientId = expense.client_id || (expense.client_name ? idByName.get(expense.client_name.toLowerCase()) || null : null);
      return { ...expense, resolvedClientId };
    }).filter((expense) => filterDateRange(expense.expense_date, comparisonRange.start, comparisonRange.end));

    const filterTerm = normalizeText(state.filters.search).toLowerCase();
    const filterCategory = normalizeText(state.filters.category);
    const filterProject = normalizeText(state.filters.project).toLowerCase();
    const filterInvoiceStatus = normalizeText(state.filters.invoiceStatus);
    const filterExpenseType = normalizeText(state.filters.expenseType).toLowerCase();
    const clientFilterId = state.filters.clientId ? Number(state.filters.clientId) : null;
    const fromDate = state.filters.fromDate ? toDate(state.filters.fromDate) : null;
    const toDateValue = state.filters.toDate ? toDate(state.filters.toDate) : null;
    const minRevenue = state.filters.minRevenue !== '' ? toNumber(state.filters.minRevenue) : null;
    const maxRevenue = state.filters.maxRevenue !== '' ? toNumber(state.filters.maxRevenue) : null;
    const minMargin = state.filters.minMargin !== '' ? toNumber(state.filters.minMargin) : null;
    const maxMargin = state.filters.maxMargin !== '' ? toNumber(state.filters.maxMargin) : null;

    const periodPayments = activePayments.filter((payment) => {
      const paymentClientName = nameById.get(Number(payment.client_id)) || '';
      if (clientFilterId && Number(payment.client_id) !== Number(clientFilterId)) return false;
      if (filterTerm && !matchesSearch([paymentClientName, formatMoney(payment.amount)].join(' '), filterTerm)) return false;
      if (fromDate || toDateValue) {
        const paymentDate = toDate(payment.payment_date);
        if (!paymentDate) return false;
        if (fromDate && paymentDate < fromDate) return false;
        if (toDateValue && paymentDate > toDateValue) return false;
      }
      return true;
    });

    const periodExpenses = activeExpenses.filter((expense) => {
      const expenseClientName = expense.resolvedClientId ? (nameById.get(Number(expense.resolvedClientId)) || '') : expense.client_name;
      if (clientFilterId && Number(expense.resolvedClientId) !== Number(clientFilterId)) return false;
      if (filterTerm && !matchesSearch([expenseClientName, expense.category, expense.project, expense.notes, expense.invoice_status, formatMoney(expense.amount)].join(' '), filterTerm)) return false;
      if (fromDate || toDateValue) {
        const expenseDate = toDate(expense.expense_date);
        if (!expenseDate) return false;
        if (fromDate && expenseDate < fromDate) return false;
        if (toDateValue && expenseDate > toDateValue) return false;
      }
      if (filterCategory && expense.category.toLowerCase() !== filterCategory.toLowerCase()) return false;
      if (filterProject && !expense.project.toLowerCase().includes(filterProject)) return false;
      if (filterInvoiceStatus && expense.invoice_status !== filterInvoiceStatus) return false;
      if (filterExpenseType && expense.expense_type.toLowerCase() !== filterExpenseType) return false;
      return true;
    });

    const buckets = buildBuckets(state.view);
    const previousBuckets = buildBuckets(state.view);

    const bucketForDate = (date) => {
      const d = toDate(date);
      if (!d) return null;
      if (state.view === 'month') return d.getDate() - 1;
      if (state.view === 'quarter') return d.getMonth() - ((state.quarter - 1) * 3);
      return d.getMonth();
    };

    for (const payment of periodPayments) {
      const index = bucketForDate(payment.payment_date);
      if (index === null || index === undefined || !buckets[index]) continue;
      buckets[index].revenue += payment.amount;
      buckets[index].paymentCount += 1;
    }

    for (const expense of periodExpenses) {
      const index = bucketForDate(expense.expense_date);
      if (index === null || index === undefined || !buckets[index]) continue;
      if (expense.category.toLowerCase() === 'taxes') {
        buckets[index].taxExpenses += expense.amount;
      } else {
        buckets[index].operatingExpenses += expense.amount;
      }
      buckets[index].totalExpenses += expense.amount;
      buckets[index].expenseCount += 1;
    }

    for (const bucket of buckets) {
      bucket.grossProfit = bucket.revenue - bucket.operatingExpenses;
      bucket.netProfit = bucket.revenue - bucket.totalExpenses;
      bucket.marginPct = bucket.revenue > 0 ? (bucket.netProfit / bucket.revenue) * 100 : 0;
    }

    const previousBucketForDate = (date) => {
      const d = toDate(date);
      if (!d) return null;
      if (state.view === 'month') {
        const prev = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
        return prev.getDate() - 1;
      }
      if (state.view === 'quarter') {
        return d.getMonth() - ((state.quarter - 1) * 3);
      }
      return d.getMonth();
    };

    for (const payment of previousPayments) {
      const index = previousBucketForDate(payment.payment_date);
      if (index === null || index === undefined || !previousBuckets[index]) continue;
      previousBuckets[index].revenue += payment.amount;
      previousBuckets[index].paymentCount += 1;
    }

    for (const expense of previousExpenses) {
      const index = previousBucketForDate(expense.expense_date);
      if (index === null || index === undefined || !previousBuckets[index]) continue;
      if (expense.category.toLowerCase() === 'taxes') {
        previousBuckets[index].taxExpenses += expense.amount;
      } else {
        previousBuckets[index].operatingExpenses += expense.amount;
      }
      previousBuckets[index].totalExpenses += expense.amount;
      previousBuckets[index].expenseCount += 1;
    }

    for (const bucket of previousBuckets) {
      bucket.grossProfit = bucket.revenue - bucket.operatingExpenses;
      bucket.netProfit = bucket.revenue - bucket.totalExpenses;
      bucket.marginPct = bucket.revenue > 0 ? (bucket.netProfit / bucket.revenue) * 100 : 0;
    }

    const clientIds = new Set();
    for (const payment of periodPayments) if (payment.client_id) clientIds.add(Number(payment.client_id));
    for (const expense of periodExpenses) if (expense.resolvedClientId) clientIds.add(Number(expense.resolvedClientId));

    const currentClientRows = [];
    const currentClientBreakdown = new Map();
    const currentClientExpenseRows = new Map();
    const currentClientPaymentRows = new Map();
    let sharedOperatingExpenses = 0;
    let sharedTaxExpenses = 0;

    for (const expense of periodExpenses) {
      const resolvedClientId = expense.resolvedClientId;
      if (resolvedClientId) {
        if (!currentClientExpenseRows.has(resolvedClientId)) currentClientExpenseRows.set(resolvedClientId, []);
        currentClientExpenseRows.get(resolvedClientId).push(expense);
      } else if (expense.category.toLowerCase() === 'taxes') {
        sharedTaxExpenses += expense.amount;
      } else {
        sharedOperatingExpenses += expense.amount;
      }
    }

    for (const payment of periodPayments) {
      if (!payment.client_id) continue;
      if (!currentClientPaymentRows.has(payment.client_id)) currentClientPaymentRows.set(payment.client_id, []);
      currentClientPaymentRows.get(payment.client_id).push(payment);
    }

    const totalRevenue = periodPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const totalOperatingExpenses = periodExpenses.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? 0 : expense.amount), 0);
    const totalTaxExpenses = periodExpenses.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? expense.amount : 0), 0);
    const totalExpenses = totalOperatingExpenses + totalTaxExpenses;
    const savedMarginValues = periodExpenses
      .map((expense) => expense.marginSnapshot?.marginPct)
      .filter((value) => Number.isFinite(value));
    const previousSavedMarginValues = previousExpenses
      .map((expense) => expense.marginSnapshot?.marginPct)
      .filter((value) => Number.isFinite(value));
    const savedJobTotals = periodExpenses
      .map((expense) => expense.marginSnapshot?.jobTotal)
      .filter((value) => Number.isFinite(value));
    const savedMoneyReceivedTotals = periodExpenses
      .map((expense) => expense.marginSnapshot?.moneyReceived)
      .filter((value) => Number.isFinite(value));
    const savedJobCostTotals = periodExpenses
      .map((expense) => expense.marginSnapshot?.jobCost)
      .filter((value) => Number.isFinite(value));
    const previousSavedJobTotals = previousExpenses
      .map((expense) => expense.marginSnapshot?.jobTotal)
      .filter((value) => Number.isFinite(value));
    const previousSavedMoneyReceivedTotals = previousExpenses
      .map((expense) => expense.marginSnapshot?.moneyReceived)
      .filter((value) => Number.isFinite(value));
    const previousSavedJobCostTotals = previousExpenses
      .map((expense) => expense.marginSnapshot?.jobCost)
      .filter((value) => Number.isFinite(value));
    const averageSavedMargin = savedMarginValues.length
      ? savedMarginValues.reduce((sum, value) => sum + value, 0) / savedMarginValues.length
      : 0;
    const previousAverageSavedMargin = previousSavedMarginValues.length
      ? previousSavedMarginValues.reduce((sum, value) => sum + value, 0) / previousSavedMarginValues.length
      : 0;
    const savedJobTotalTotal = savedJobTotals.reduce((sum, value) => sum + value, 0);
    const savedMoneyReceivedTotal = savedMoneyReceivedTotals.reduce((sum, value) => sum + value, 0);
    const savedJobCostTotal = savedJobCostTotals.reduce((sum, value) => sum + value, 0);
    const previousSavedJobTotalTotal = previousSavedJobTotals.reduce((sum, value) => sum + value, 0);
    const previousSavedMoneyReceivedTotal = previousSavedMoneyReceivedTotals.reduce((sum, value) => sum + value, 0);
    const previousSavedJobCostTotal = previousSavedJobCostTotals.reduce((sum, value) => sum + value, 0);

    const revenueAllocationBase = Math.max(totalRevenue, 0);

    for (const clientId of clientIds) {
      const client = clients.find((row) => Number(row.id) === Number(clientId)) || { id: clientId, name: `Client ${clientId}` };
      const paymentsForClient = currentClientPaymentRows.get(Number(clientId)) || [];
      const expensesForClient = currentClientExpenseRows.get(Number(clientId)) || [];
      const revenue = paymentsForClient.reduce((sum, payment) => sum + payment.amount, 0);
      const directOperatingExpense = expensesForClient.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? 0 : expense.amount), 0);
      const directTaxExpense = expensesForClient.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? expense.amount : 0), 0);
      const sharedOperatingAllocation = revenueAllocationBase > 0 ? sharedOperatingExpenses * (revenue / revenueAllocationBase) : 0;
      const sharedTaxAllocation = revenueAllocationBase > 0 ? sharedTaxExpenses * (revenue / revenueAllocationBase) : 0;
      const operatingExpenses = directOperatingExpense + sharedOperatingAllocation;
      const taxExpenses = directTaxExpense + sharedTaxAllocation;
      const grossProfit = revenue - operatingExpenses;
      const netProfit = revenue - operatingExpenses - taxExpenses;
      const marginPct = revenue > 0 ? (netProfit / revenue) * 100 : 0;
      const grossMarginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

      const previousClientPayments = previousPayments.filter((payment) => Number(payment.client_id) === Number(clientId));
      const previousClientExpenses = previousExpenses.filter((expense) => Number(expense.resolvedClientId) === Number(clientId));
      const previousRevenue = previousClientPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const previousOperatingExpense = previousClientExpenses.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? 0 : expense.amount), 0);
      const previousTaxExpense = previousClientExpenses.reduce((sum, expense) => sum + (expense.category.toLowerCase() === 'taxes' ? expense.amount : 0), 0);
      const previousNetProfit = previousRevenue - previousOperatingExpense - previousTaxExpense;
      const previousMarginPct = previousRevenue > 0 ? (previousNetProfit / previousRevenue) * 100 : 0;
      const monthlyChange = marginPct - previousMarginPct;

      const historyDates = [
        ...paymentsForClient.map((payment) => toDate(payment.payment_date)).filter(Boolean),
        ...expensesForClient.map((expense) => toDate(expense.expense_date)).filter(Boolean)
      ];
      const lastUpdated = historyDates.length
        ? new Date(Math.max(...historyDates.map((date) => date.getTime()))).toISOString()
        : client.created_at || null;

      const revenueShare = totalRevenue > 0 ? revenue / totalRevenue : 0;
      const expenseShare = totalExpenses > 0 ? (operatingExpenses + taxExpenses) / totalExpenses : 0;

      currentClientRows.push({
        id: Number(client.id),
        name: client.name,
        revenue,
        expenses: operatingExpenses + taxExpenses,
        grossProfit,
        netProfit,
        grossMarginPct,
        marginPct,
        monthlyChange,
        status: marginPct >= 35 ? 'Healthy' : marginPct >= 20 ? 'Watch' : 'Risk',
        lastUpdated,
        paymentCount: paymentsForClient.length,
        expenseCount: expensesForClient.length,
        expensesForClient,
        paymentsForClient,
        revenueShare,
        expenseShare,
        previousRevenue,
        previousNetProfit,
        previousMarginPct
      });
    }

    currentClientRows.sort((a, b) => {
      const sortKey = state.sortKey === 'client' ? 'name' : state.sortKey;
      const left = a[sortKey] ?? 0;
      const right = b[sortKey] ?? 0;
      if (typeof left === 'string' || typeof right === 'string') {
        const leftText = String(left).toLowerCase();
        const rightText = String(right).toLowerCase();
        return state.sortDir === 'asc'
          ? leftText.localeCompare(rightText)
          : rightText.localeCompare(leftText);
      }
      return state.sortDir === 'asc' ? left - right : right - left;
    });

    const filteredClients = currentClientRows.filter((row) => {
      if (clientFilterId && Number(row.id) !== Number(clientFilterId)) return false;
      if (filterTerm) {
        const haystack = [
          row.name,
          row.status,
          row.expensesForClient.map((item) => item.category).join(' '),
          row.expensesForClient.map((item) => item.project).join(' '),
          row.expensesForClient.map((item) => item.notes).join(' ')
        ].join(' ').toLowerCase();
        if (!haystack.includes(filterTerm)) return false;
      }
      if (minRevenue !== null && row.revenue < minRevenue) return false;
      if (maxRevenue !== null && row.revenue > maxRevenue) return false;
      if (minMargin !== null && row.marginPct < minMargin) return false;
      if (maxMargin !== null && row.marginPct > maxMargin) return false;
      return true;
    });

    const pageCount = Math.max(1, Math.ceil(filteredClients.length / pageSize));
    const currentPage = clamp(state.page, 1, pageCount);
    const visibleRows = filteredClients.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const latestBucket = buckets[buckets.length - 1] || createBucket('None', 0);
    const previousBucket = previousBuckets[previousBuckets.length - 1] || createBucket('None', 0);
    const currentSeriesTotal = buckets.reduce((sum, bucket) => sum + bucket.revenue, 0);
    const currentExpenseTotal = buckets.reduce((sum, bucket) => sum + bucket.totalExpenses, 0);
    const currentProfitTotal = currentSeriesTotal - currentExpenseTotal;
    const currentMarginPct = currentSeriesTotal > 0 ? (currentProfitTotal / currentSeriesTotal) * 100 : 0;
    const previousSeriesTotal = previousBuckets.reduce((sum, bucket) => sum + bucket.revenue, 0);
    const previousExpenseTotal = previousBuckets.reduce((sum, bucket) => sum + bucket.totalExpenses, 0);
    const previousProfitTotal = previousSeriesTotal - previousExpenseTotal;
    const previousMarginPctSeries = previousSeriesTotal > 0 ? (previousProfitTotal / previousSeriesTotal) * 100 : 0;

    const totalClientMargin = filteredClients.length
      ? filteredClients.reduce((sum, row) => sum + row.marginPct, 0) / filteredClients.length
      : 0;
    const previousClientMargin = currentClientRows.length
      ? currentClientRows.reduce((sum, row) => sum + row.previousMarginPct, 0) / currentClientRows.length
      : 0;

    const highestMarginClient = [...currentClientRows].sort((a, b) => b.marginPct - a.marginPct)[0] || null;
    const lowestMarginClient = [...currentClientRows].sort((a, b) => a.marginPct - b.marginPct)[0] || null;

    const topProfitClients = [...filteredClients]
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 6);

    const categoryTotals = {};
    for (const expense of periodExpenses) {
      const key = expense.category || 'Misc';
      categoryTotals[key] = (categoryTotals[key] || 0) + expense.amount;
    }

    const categoryItems = Object.entries(categoryTotals)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const projected = buildForecast(buckets, currentSeriesTotal, currentExpenseTotal, currentProfitTotal, currentMarginPct);
    const insights = buildInsights({
      totalRevenue: currentSeriesTotal,
      totalExpenses: currentExpenseTotal,
      currentMarginPct,
      averageSavedMargin,
      savedJobTotalTotal,
      savedMoneyReceivedTotal,
      savedJobCostTotal,
      totalClientMargin,
      filteredClients,
      topProfitClients,
      buckets,
      previousSeriesTotal,
      previousExpenseTotal,
      previousProfitTotal,
      previousMarginPctSeries,
      previousAverageSavedMargin,
      previousSavedJobTotalTotal,
      previousSavedMoneyReceivedTotal,
      previousSavedJobCostTotal,
      projected
    });
    const alerts = buildAlerts({
      currentMarginPct,
      totalRevenue: currentSeriesTotal,
      totalExpenses: currentExpenseTotal,
      filteredClients,
      topProfitClients,
      projected
    });

    const periodTitle = periodLabel(state.year, state.view, state.month, state.quarter);
    const viewSeries = buckets.map((bucket) => ({
      label: bucket.label,
      revenue: bucket.revenue,
      expenses: bucket.totalExpenses,
      grossProfit: bucket.grossProfit,
      netProfit: bucket.netProfit,
      marginPct: bucket.marginPct
    }));

    return {
      clients,
      payments,
      expenses,
      nameById,
      filteredClients,
      visibleRows,
      buckets,
      previousBuckets,
      categoryItems,
      periodTitle,
      currentSeriesTotal,
      currentExpenseTotal,
      currentProfitTotal,
      currentMarginPct,
      previousSeriesTotal,
      previousExpenseTotal,
      previousProfitTotal,
      previousMarginPctSeries,
      averageSavedMargin,
      previousAverageSavedMargin,
      savedJobTotalTotal,
      savedMoneyReceivedTotal,
      savedJobCostTotal,
      previousSavedJobTotalTotal,
      previousSavedMoneyReceivedTotal,
      previousSavedJobCostTotal,
      totalClientMargin,
      previousClientMargin,
      highestMarginClient,
      lowestMarginClient,
      topProfitClients,
      projected,
      insights,
      alerts,
      viewSeries,
      pageCount,
      currentPage,
      totalClients: filteredClients.length,
      comparisonRange
    };
  }

  function buildForecast(buckets, revenueTotal, expenseTotal, profitTotal, marginPct) {
    const activeBuckets = buckets.filter((bucket) => bucket.revenue > 0 || bucket.totalExpenses > 0);
    const series = activeBuckets.length > 0 ? activeBuckets : buckets;
    const revenueValues = series.map((bucket) => bucket.revenue);
    const expenseValues = series.map((bucket) => bucket.totalExpenses);
    const profitValues = series.map((bucket) => bucket.netProfit);

    const nextRevenue = projectNextValue(revenueValues);
    const nextExpenses = projectNextValue(expenseValues);
    const nextProfit = nextRevenue - nextExpenses;
    const nextMargin = nextRevenue > 0 ? (nextProfit / nextRevenue) * 100 : 0;

    return {
      nextRevenue,
      nextExpenses,
      nextProfit,
      nextMargin,
      monthlyRunRate: series.length ? revenueTotal / series.length : revenueTotal,
      profitSlope: trendSlope(profitValues),
      revenueSlope: trendSlope(revenueValues),
      marginSlope: trendSlope(series.map((bucket) => bucket.marginPct))
    };
  }

  function projectNextValue(values) {
    if (!values.length) return 0;
    const last = values[values.length - 1];
    const prior = values[values.length - 2] ?? last;
    const movingAvg = values.slice(-3).reduce((sum, value) => sum + value, 0) / Math.min(values.length, 3);
    const slope = last - prior;
    return Math.max(0, movingAvg + (slope * 0.65));
  }

  function trendSlope(values) {
    if (values.length < 2) return 0;
    const first = values[0];
    const last = values[values.length - 1];
    return last - first;
  }

  function buildInsights(context) {
    const { totalRevenue, totalExpenses, currentMarginPct, averageSavedMargin, totalClientMargin, filteredClients, topProfitClients, previousSeriesTotal, previousExpenseTotal, previousProfitTotal, previousMarginPctSeries, previousAverageSavedMargin, projected } = context;
    const profitConcentration = topProfitClients.length && totalRevenue > 0
      ? (topProfitClients.reduce((sum, row) => sum + row.netProfit, 0) / Math.max(context.filteredClients.reduce((sum, row) => sum + row.netProfit, 0), 1)) * 100
      : 0;

    const insights = [];

    if (filteredClients.length) {
      insights.push({
        tone: 'good',
        title: 'Profit concentration',
        text: `Top clients generate ${formatDelta(profitConcentration, 'percent')} of the profit pool.`,
        detail: `Filtered client set: ${filteredClients.length}`
      });
    }

    if (previousExpenseTotal > 0) {
      const expenseChange = ((totalExpenses - previousExpenseTotal) / previousExpenseTotal) * 100;
      insights.push({
        tone: expenseChange > 0 ? 'watch' : 'good',
        title: 'Expense trend',
        text: `Expenses ${expenseChange > 0 ? 'increased' : 'decreased'} ${formatDelta(Math.abs(expenseChange))} versus the comparison period.`,
        detail: `Current: ${formatMoney(totalExpenses)}`
      });
    }

    insights.push({
      tone: currentMarginPct < 20 ? 'critical' : 'good',
      title: 'Margin health',
      text: `Net margin is ${formatDelta(currentMarginPct, 'percent')} with an average saved margin of ${formatDelta(averageSavedMargin, 'percent')}.`,
      detail: `Revenue ${formatMoney(totalRevenue)}`
    });

    insights.push({
      tone: 'good',
      title: 'Projection',
      text: `Projected profit next period is ${formatMoney(projected.nextProfit)} at ${formatDelta(projected.nextMargin, 'percent')} margin.`,
      detail: `Run-rate ${formatMoney(projected.monthlyRunRate)}`
    });

    if (previousProfitTotal !== 0) {
      const profitChange = ((context.filteredClients.reduce((sum, row) => sum + row.netProfit, 0) - previousProfitTotal) / Math.abs(previousProfitTotal)) * 100;
      insights.push({
        tone: profitChange >= 0 ? 'good' : 'critical',
        title: 'Profit delta',
        text: `Profit ${profitChange >= 0 ? 'improved' : 'declined'} ${formatDelta(Math.abs(profitChange))} against the comparison period.`,
        detail: `Margin trend ${formatDelta(currentMarginPct - previousMarginPctSeries, 'points')} | Saved margin ${formatDelta(averageSavedMargin - previousAverageSavedMargin, 'points')}`
      });
    }

    return insights.slice(0, 4);
  }

  function buildAlerts(context) {
    const alerts = [];
    const { currentMarginPct, totalRevenue, totalExpenses, filteredClients, projected } = context;

    if (currentMarginPct < 15) {
      alerts.push({
        tone: 'critical',
        title: 'Low margin alert',
        text: `Net margin is ${formatDelta(currentMarginPct, 'percent')}. Review costs before the next cycle.`,
      });
    }

    if (totalExpenses > totalRevenue && totalRevenue > 0) {
      alerts.push({
        tone: 'critical',
        title: 'Overspend warning',
        text: 'Expenses are outpacing revenue in the active period.'
      });
    }

    const lowMarginClients = filteredClients.filter((row) => row.marginPct < 20).slice(0, 3);
    if (lowMarginClients.length) {
      alerts.push({
        tone: 'watch',
        title: 'At-risk clients',
        text: `${lowMarginClients.map((row) => row.name).join(', ')} are trending below a 20% margin.`
      });
    }

    if (projected.nextProfit > 0) {
      alerts.push({
        tone: 'good',
        title: 'Forecast upside',
        text: `Projected next-period profit is ${formatMoney(projected.nextProfit)}.`
      });
    }

    if (!alerts.length) {
      alerts.push({
        tone: 'good',
        title: 'Stable period',
        text: 'No major margin anomalies detected in the current selection.'
      });
    }

    return alerts.slice(0, 4);
  }

  function loadSkeleton() {
    root.innerHTML = `
      <div class="mt-shell" aria-busy="true">
        <div class="mt-toolbar">
          <div class="mt-toolbar-copy">
            <div class="mt-title">Margin Tracker</div>
            <p class="mt-subtitle">Loading live analytics, charts, and client profitability insights...</p>
          </div>
          <div class="mt-chip-row">
            <span class="mt-chip"><strong>Loading</strong> dashboard</span>
          </div>
        </div>
        <div class="mt-skeleton-grid">
          ${Array.from({ length: 4 }, () => '<div class="mt-skeleton"></div>').join('')}
        </div>
      </div>
    `;
  }

  function renderError(message) {
    root.innerHTML = `
      <div class="mt-shell">
        <div class="mt-panel">
          <div class="mt-panel-body">
            <div class="mt-empty">
              <div>
                <div style="font-weight:800; color: var(--text-main); margin-bottom:8px;">Margin tracker unavailable</div>
                <div>${escapeHtml(message || 'Unable to load margin analytics right now.')}</div>
                <div style="margin-top:14px;">
                  <button class="mt-action-btn" data-action="retry">Retry</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function render() {
    if (state.loading) {
      loadSkeleton();
      return;
    }

    if (state.error) {
      renderError(state.error);
      return;
    }

    const model = buildAnalysis(state.data);
    if (!model) {
      renderError('The margin data could not be analyzed.');
      return;
    }
    state.currentModel = model;
    state.page = model.currentPage;

    const periodText = periodLabel(state.year, state.view, state.month, state.quarter);
    const monthSelect = state.view === 'month' ? `
      <select data-control="month" aria-label="Select month">
        ${monthNames.map((label, idx) => `<option value="${idx + 1}" ${idx + 1 === state.month ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    ` : '';
    const quarterSelect = state.view === 'quarter' ? `
      <select data-control="quarter" aria-label="Select quarter">
        ${quarterNames.map((label, idx) => `<option value="${idx + 1}" ${idx + 1 === state.quarter ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    ` : '';

    root.innerHTML = `
      <div class="mt-shell">
        <div class="mt-toolbar">
          <div class="mt-toolbar-copy">
            <div class="mt-title">Margin Tracker</div>
            <p class="mt-subtitle">Selected period: <strong>${escapeHtml(periodText)}</strong>. Enter the four fields first, then review charts only if you want extra context.</p>
          </div>
          <div class="mt-toolbar-actions">
            <div class="mt-view-toggle" role="tablist" aria-label="Margin view">
              <button class="mt-view-btn" data-action="set-view" data-view="month" aria-pressed="${state.view === 'month'}">Month</button>
              <button class="mt-view-btn" data-action="set-view" data-view="quarter" aria-pressed="${state.view === 'quarter'}">Quarter</button>
              <button class="mt-view-btn" data-action="set-view" data-view="year" aria-pressed="${state.view === 'year'}">Year</button>
            </div>
            <span class="mt-chip"><strong>Year</strong> ${escapeHtml(String(state.year))}</span>
            ${monthSelect}
            ${quarterSelect}
            <button class="mt-action-btn secondary" data-action="reset-filters">Reset filters</button>
            <button class="mt-action-btn" data-action="export-csv">Export CSV</button>
          </div>
        </div>

        ${renderExpenseForm(model)}
        ${renderKpiGrid(model)}
        ${renderChartGrid(model)}
        <details class="mt-panel" style="padding:0; overflow:hidden;">
          <summary style="list-style:none; cursor:pointer; padding:18px 18px 0; font-weight:800; color: var(--text-main);">Advanced Filters</summary>
          <div style="padding:0 0 18px;">
            ${renderFilterPanel(model)}
          </div>
        </details>
        ${renderSmartPanels(model)}
        ${renderClientTable(model)}
      </div>
    `;

    animateCounters();
  }

  function renderFilterPanel(model) {
    const clientOptions = ['<option value="">All clients</option>']
      .concat((state.data?.clients || []).map((client) => `<option value="${escapeHtml(client.id)}" ${String(state.filters.clientId) === String(client.id) ? 'selected' : ''}>${escapeHtml(client.name)}</option>`))
      .join('');

    const categoryOptions = ['<option value="">All categories</option>']
      .concat(categories.map((category) => `<option value="${escapeHtml(category)}" ${state.filters.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`))
      .join('');

    const statusOptions = ['<option value="">All invoice statuses</option>']
      .concat(invoiceStatuses.map((status) => `<option value="${escapeHtml(status)}" ${state.filters.invoiceStatus === status ? 'selected' : ''}>${escapeHtml(status)}</option>`))
      .join('');

    const expenseTypeOptions = [
      '<option value="">All types</option>',
      `<option value="one-time" ${state.filters.expenseType === 'one-time' ? 'selected' : ''}>One-time</option>`,
      `<option value="recurring" ${state.filters.expenseType === 'recurring' ? 'selected' : ''}>Recurring</option>`
    ].join('');

    return `
      <div class="mt-panel">
        <div class="mt-panel-header">
          <div>
            <h4 class="mt-panel-title">Advanced Filters</h4>
            <p class="mt-panel-copy">Optional tools for narrowing the data after the quick margin entry.</p>
          </div>
          <div class="mt-chip-row">
            <span class="mt-chip"><strong>${escapeHtml(String(model.totalClients))}</strong> clients</span>
            <span class="mt-chip"><strong>${escapeHtml(String(model.categoryItems.length))}</strong> categories</span>
            <span class="mt-chip"><strong>${escapeHtml(String(model.projected.nextMargin.toFixed(1)))}</strong>% projected margin</span>
          </div>
        </div>
        <div class="mt-panel-body">
          <div class="mt-form-grid">
            <div class="mt-field">
              <label>Search</label>
              <input data-filter="search" type="search" value="${escapeHtml(state.filters.search)}" placeholder="Client, project, category, notes">
            </div>
            <div class="mt-field">
              <label>Client</label>
              <select data-filter="clientId">${clientOptions}</select>
            </div>
            <div class="mt-field">
              <label>Category</label>
              <select data-filter="category">${categoryOptions}</select>
            </div>
            <div class="mt-field">
              <label>Invoice Status</label>
              <select data-filter="invoiceStatus">${statusOptions}</select>
            </div>
            <div class="mt-field">
              <label>Project</label>
              <input data-filter="project" type="text" value="${escapeHtml(state.filters.project)}" placeholder="Project name">
            </div>
            <div class="mt-field">
              <label>Expense Type</label>
              <select data-filter="expenseType">${expenseTypeOptions}</select>
            </div>
            <div class="mt-field">
              <label>Date From</label>
              <input data-filter="fromDate" type="date" value="${escapeHtml(state.filters.fromDate)}">
            </div>
            <div class="mt-field">
              <label>Date To</label>
              <input data-filter="toDate" type="date" value="${escapeHtml(state.filters.toDate)}">
            </div>
            <div class="mt-field">
              <label>Revenue Min</label>
              <input data-filter="minRevenue" inputmode="decimal" type="text" value="${escapeHtml(state.filters.minRevenue)}" placeholder="$0">
            </div>
            <div class="mt-field">
              <label>Revenue Max</label>
              <input data-filter="maxRevenue" inputmode="decimal" type="text" value="${escapeHtml(state.filters.maxRevenue)}" placeholder="$0">
            </div>
            <div class="mt-field">
              <label>Margin Min %</label>
              <input data-filter="minMargin" inputmode="decimal" type="text" value="${escapeHtml(state.filters.minMargin)}" placeholder="0%">
            </div>
            <div class="mt-field">
              <label>Margin Max %</label>
              <input data-filter="maxMargin" inputmode="decimal" type="text" value="${escapeHtml(state.filters.maxMargin)}" placeholder="100%">
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderKpiGrid(model) {
    const cards = [
      metricCard('Job Total', model.savedJobTotalTotal, model.previousSavedJobTotalTotal, 'revenue', 'Total of saved job totals'),
      metricCard('Money Received', model.savedMoneyReceivedTotal, model.previousSavedMoneyReceivedTotal, 'profit', 'Total money received on saved jobs'),
      metricCard('Job Cost', model.savedJobCostTotal, model.previousSavedJobCostTotal, 'expenses', 'Total job costs entered'),
      metricCard('Average Margin', model.averageSavedMargin, model.previousAverageSavedMargin, 'margin', 'Average of saved margin percentages', true)
    ];

    return `
      <div class="mt-panel">
        <div class="mt-panel-header">
          <div>
            <h4 class="mt-panel-title">Top KPI snapshot</h4>
            <p class="mt-panel-copy">Animated finance cards with directional context, sparklines, and premium hover feedback.</p>
          </div>
        </div>
        <div class="mt-panel-body">
          <div class="mt-kpi-grid">${cards.join('')}</div>
          <div class="mt-chip-row" style="margin-top:14px;">
            <span class="mt-chip"><strong>${escapeHtml(model.highestMarginClient?.name || 'N/A')}</strong> highest margin</span>
            <span class="mt-chip"><strong>${escapeHtml(model.lowestMarginClient?.name || 'N/A')}</strong> lowest margin</span>
            <span class="mt-chip"><strong>${escapeHtml(String(model.expenses?.filter((entry) => entry.marginSnapshot).length || 0))}</strong> saved entries</span>
          </div>
        </div>
      </div>
    `;
  }

  function metricCard(label, value, previousValue, tone, caption, isPercent = false, subtitle = '') {
    const delta = previousValue ? ((value - previousValue) / Math.max(Math.abs(previousValue), 1)) * 100 : 0;
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const spark = sparklineSVG(seriesForSparkline(tone));
    const valueText = isPercent ? `${percentFmt.format(value)}%` : formatMoney(value);
    const deltaText = previousValue ? formatDelta(Math.abs(delta)) : 'No comparison';
    const arrow = direction === 'up' ? '+' : direction === 'down' ? '-' : '*';
    return `
      <article class="mt-kpi-card">
        <div class="mt-kpi-top">
          <div>
            <div class="mt-kpi-label">${escapeHtml(label)}</div>
            <div class="mt-kpi-value" data-count="${escapeHtml(String(value))}" data-format="${isPercent ? 'percent' : 'currency'}">${escapeHtml(valueText)}</div>
            <div class="mt-kpi-meta">
              <span class="mt-trend ${direction}">${arrow} ${escapeHtml(deltaText)}</span>
            </div>
          </div>
          <div class="mt-chip">${escapeHtml(subtitle || caption)}</div>
        </div>
        ${spark}
        <div class="mt-kpi-meta">${escapeHtml(caption)}</div>
      </article>
    `;
  }

  function seriesForSparkline(tone) {
    const buckets = state.currentModel?.viewSeries || [];
    if (!buckets.length) return [0, 0, 0, 0];
    if (tone === 'expenses') return buckets.map((bucket) => bucket.expenses);
    if (tone === 'profit') return buckets.map((bucket) => bucket.netProfit);
    if (tone === 'margin') return buckets.map((bucket) => bucket.marginPct);
    return buckets.map((bucket) => bucket.revenue);
  }

  function sparklineSVG(values) {
    const normalized = normalizeSeries(values, 120, 36);
    const points = normalized.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
    const fillPath = `${points} L 120 36 L 0 36 Z`;
    const gradientId = `sparkGrad-${svgUid += 1}`;
    return `
      <svg class="mt-sparkline" viewBox="0 0 120 36" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#72edc7" stop-opacity="0.65"/>
            <stop offset="100%" stop-color="#72edc7" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <path d="${fillPath}" fill="url(#${gradientId})"></path>
        <path d="${points}" fill="none" stroke="#72edc7" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
    `;
  }

  function normalizeSeries(values, width, height) {
    const cleaned = values.map((value) => toNumber(value));
    const max = Math.max(...cleaned, 1);
    const min = Math.min(...cleaned, 0);
    const spread = max - min || 1;
    return cleaned.map((value, index) => ({
      x: cleaned.length === 1 ? width / 2 : (index / (cleaned.length - 1)) * width,
      y: height - ((value - min) / spread) * (height - 6) - 3
    }));
  }

  function renderChartGrid(model) {
    return `
      <div class="mt-grid">
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Visual Insights: Revenue vs Expenses</h4>
              <p class="mt-panel-copy">Secondary analytics for reviewing trends after the quick entry is saved.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-chart">${lineChart(model.viewSeries, 'revenue', 'expenses', ['#72edc7', '#7ab7d6'])}</div>
            <div class="mt-legend">
              <span class="mt-legend-item"><span class="mt-dot" style="background:#72edc7"></span>Revenue</span>
              <span class="mt-legend-item"><span class="mt-dot" style="background:#7ab7d6"></span>Expenses</span>
            </div>
          </div>
        </div>
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Margin Trends</h4>
              <p class="mt-panel-copy">A supporting view of margin movement through the selected period.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-chart">${lineChart(model.viewSeries, 'marginPct', null, ['#f7c55f'])}</div>
            <div class="mt-chip-row">
              <span class="mt-chip"><strong>${escapeHtml(periodLabel(state.year, state.view, state.month, state.quarter))}</strong> active</span>
              <span class="mt-chip"><strong>${escapeHtml(percentFmt.format(model.currentMarginPct))}%</strong> margin</span>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-grid-2">
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Client Profitability Rankings</h4>
              <p class="mt-panel-copy">Helpful context, not part of the primary input flow.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-chart">${barRankingChart(model.topProfitClients)}</div>
          </div>
        </div>
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Expense Breakdown</h4>
              <p class="mt-panel-copy">A compact category breakdown for reference.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-chart">${donutChart(model.categoryItems)}</div>
            <div class="mt-legend">
              ${model.categoryItems.slice(0, 5).map((item, idx) => `
                <span class="mt-legend-item"><span class="mt-dot" style="background:${chartPalette[idx % chartPalette.length]}"></span>${escapeHtml(item.label)} ${escapeHtml(formatMoney(item.value))}</span>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="mt-grid-3">
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Forecast Projections</h4>
              <p class="mt-panel-copy">Optional forward-looking context from the same dataset.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            ${forecastPanel(model.projected)}
          </div>
        </div>
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Profitability Heatmap</h4>
              <p class="mt-panel-copy">A secondary visual layer for spotting patterns quickly.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-chart">${heatmapChart(model.filteredClients)}</div>
          </div>
        </div>
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Smart Insights</h4>
              <p class="mt-panel-copy">Simple narrative highlights pulled from the live data.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-list">
              ${model.insights.map((insight) => `
                <div class="mt-alert-card ${insight.tone}">
                  <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(insight.title)}</div>
                  <div>${escapeHtml(insight.text)}</div>
                  <small style="display:block; margin-top:6px; color: var(--text-muted);">${escapeHtml(insight.detail)}</small>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="mt-panel">
        <div class="mt-panel-header">
          <div>
            <h4 class="mt-panel-title">Smart Alerts</h4>
            <p class="mt-panel-copy">Lightweight warnings that stay out of the way unless something needs attention.</p>
          </div>
        </div>
        <div class="mt-panel-body">
          <div class="mt-alert-grid">
            ${model.alerts.map((alert) => `
              <div class="mt-alert-card ${alert.tone}">
                <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(alert.title)}</div>
                <div>${escapeHtml(alert.text)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  const chartPalette = ['#72edc7', '#7ab7d6', '#f7c55f', '#f08eb0', '#9f8cff', '#ff9c9c', '#6fe0ff'];

  function lineChart(series, keyA, keyB, colors) {
    const valuesA = series.map((item) => toNumber(item[keyA]));
    const valuesB = keyB ? series.map((item) => toNumber(item[keyB])) : [];
    const labels = series.map((item) => item.label);
    const pointsA = buildPath(valuesA, 700, 220, labels);
    const pointsB = keyB ? buildPath(valuesB, 700, 220, labels) : null;
    const max = Math.max(...valuesA, ...valuesB, 1);
    const areaAId = `areaA-${svgUid += 1}`;
    const areaBId = `areaB-${svgUid += 1}`;
    return `
      <svg viewBox="0 0 700 220" preserveAspectRatio="none" aria-label="Trend chart">
        <defs>
          <linearGradient id="${areaAId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${colors[0]}" stop-opacity="0.45"></stop>
            <stop offset="100%" stop-color="${colors[0]}" stop-opacity="0.03"></stop>
          </linearGradient>
          ${keyB ? `
            <linearGradient id="${areaBId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${colors[1]}" stop-opacity="0.35"></stop>
              <stop offset="100%" stop-color="${colors[1]}" stop-opacity="0.03"></stop>
            </linearGradient>
          ` : ''}
        </defs>
        <rect x="0" y="0" width="700" height="220" rx="20" fill="rgba(255,255,255,0.02)"></rect>
        ${gridLines(max)}
        ${pointsA.area ? `<path d="${pointsA.area}" fill="url(#${areaAId})"></path>` : ''}
        ${pointsA.line ? `<path d="${pointsA.line}" fill="none" stroke="${colors[0]}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
        ${pointsA.circles}
        ${keyB && pointsB ? `<path d="${pointsB.area}" fill="url(#${areaBId})"></path>` : ''}
        ${keyB && pointsB ? `<path d="${pointsB.line}" fill="none" stroke="${colors[1]}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
        ${keyB && pointsB ? pointsB.circles : ''}
      </svg>
    `;
  }

  function buildPath(values, width, height, labels = []) {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const spread = max - min || 1;
    const stepX = values.length > 1 ? width / (values.length - 1) : width / 2;
    const points = values.map((value, idx) => ({
      x: idx * stepX,
      y: height - 26 - ((value - min) / spread) * (height - 56)
    }));
    const line = points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
    const area = `${line} L ${width} ${height - 18} L 0 ${height - 18} Z`;
    const circles = points.map((point, idx) => `
      <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4.5" fill="#ffffff" stroke="#72edc7" stroke-width="2">
        <title>${escapeHtml(`${labels[idx] || `Point ${idx + 1}`}: ${formatMoney(values[idx])}`)}</title>
      </circle>
    `).join('');
    return { line, area, circles };
  }

  function gridLines(max) {
    return [0.2, 0.4, 0.6, 0.8].map((step) => {
      const y = 220 - 24 - (220 - 56) * step;
      return `<line x1="18" x2="682" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.05)" stroke-width="1"></line>`;
    }).join('');
  }

  function barRankingChart(rows) {
    const top = rows.slice(0, 6);
    if (!top.length) {
      return `<div class="mt-empty">No profitability data is available for the active filters.</div>`;
    }
    const max = Math.max(...top.map((row) => Math.max(row.netProfit, 1)));
    return `
      <div class="mt-list" style="max-height:none;">
        ${top.map((row, idx) => {
          const width = (row.netProfit / max) * 100;
          return `
            <div class="mt-list-item" style="flex-direction:column;">
              <div style="display:flex; justify-content:space-between; gap:10px; width:100%; margin-bottom:8px;">
                <div>
                  <strong>${escapeHtml(row.name)}</strong>
                  <small>${escapeHtml(formatDelta(row.marginPct, 'percent'))} margin | ${escapeHtml(formatMoney(row.revenue))} revenue</small>
                </div>
                <div style="text-align:right;">
                  <strong>${escapeHtml(formatMoney(row.netProfit))}</strong>
                  <small>Net profit</small>
                </div>
              </div>
              <div style="width:100%; height:12px; border-radius:999px; background:rgba(255,255,255,0.06); overflow:hidden;">
                <div style="width:${width}%; height:100%; border-radius:999px; background:linear-gradient(135deg, ${chartPalette[idx % chartPalette.length]}, rgba(114,237,199,0.9));"></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function donutChart(items) {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    if (!total) {
      return `<div class="mt-empty">No expense data in this selection yet.</div>`;
    }
    let cumulative = 0;
    const segments = items.slice(0, 7).map((item, idx) => {
      const start = cumulative / total * 360;
      cumulative += item.value;
      const end = cumulative / total * 360;
      const color = chartPalette[idx % chartPalette.length];
      return `${color} ${start}deg ${end}deg`;
    }).join(', ');
    return `
      <div style="display:grid; place-items:center; min-height:220px;">
        <div style="width:190px; height:190px; border-radius:50%; background:conic-gradient(${segments}); position:relative; box-shadow: inset 0 0 0 24px rgba(8,16,24,0.98);">
          <div style="position:absolute; inset:50% auto auto 50%; transform:translate(-50%, -50%); text-align:center;">
            <div style="font-size:0.74rem; letter-spacing:0.1em; text-transform:uppercase; color: var(--text-muted); font-weight:700;">Expenses</div>
            <div style="font-size:1.35rem; font-weight:800; color: var(--text-main);">${escapeHtml(formatMoney(total))}</div>
          </div>
        </div>
      </div>
    `;
  }

  function forecastPanel(projected) {
    return `
      <div class="mt-grid-2">
        ${forecastItem('Next revenue', projected.nextRevenue, '#72edc7')}
        ${forecastItem('Next expenses', projected.nextExpenses, '#7ab7d6')}
        ${forecastItem('Next profit', projected.nextProfit, '#f7c55f')}
        ${forecastItem('Next margin', projected.nextMargin, '#9f8cff', true)}
      </div>
      <div class="mt-chip-row" style="margin-top:14px;">
        <span class="mt-chip"><strong>${escapeHtml(formatDelta(projected.revenueSlope / Math.max(projected.nextRevenue, 1) * 100))}</strong> revenue slope</span>
        <span class="mt-chip"><strong>${escapeHtml(formatDelta(projected.marginSlope, 'points'))}</strong> margin slope</span>
      </div>
    `;
  }

  function forecastItem(label, value, color, percent = false) {
    return `
      <div class="mt-alert-card">
        <div style="font-size:0.72rem; letter-spacing:0.1em; text-transform:uppercase; color: var(--text-muted); font-weight:800;">${escapeHtml(label)}</div>
        <div style="font-size:1.35rem; font-weight:800; margin-top:8px; color:${color};">${escapeHtml(percent ? `${percentFmt.format(value)}%` : formatMoney(value))}</div>
      </div>
    `;
  }

  function heatmapChart(rows) {
    const topClients = [...rows].sort((a, b) => b.netProfit - a.netProfit).slice(0, 6);
    const monthSeries = buildMonthlyHeatmap(rows);
    if (!topClients.length) {
      return `<div class="mt-empty">No client rows available to build the heatmap.</div>`;
    }
    return `
      <div style="overflow:auto;">
        <div style="min-width:540px;">
          <div style="display:grid; grid-template-columns: 140px repeat(12, minmax(0, 1fr)); gap:8px; align-items:center;">
            <div></div>
            ${monthNames.map((label) => `<div style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.08em; color: var(--text-muted); text-align:center;">${label}</div>`).join('')}
            ${topClients.map((client) => {
              const row = monthSeries[client.id] || [];
              return `
                <div style="font-weight:800; color: var(--text-main); font-size:0.9rem;">${escapeHtml(client.name)}</div>
                ${row.map((value) => {
                  const intensity = clamp(Math.abs(value) / Math.max(client.netProfit || 1, 1), 0, 1);
                  const background = value >= 0
                    ? `rgba(110, 244, 182, ${0.1 + intensity * 0.55})`
                    : `rgba(255, 126, 140, ${0.1 + intensity * 0.55})`;
                  return `<div title="${escapeHtml(`${client.name}: ${formatMoney(value)}`)}" style="height:30px; border-radius:10px; background:${background}; border:1px solid rgba(255,255,255,0.04);"></div>`;
                }).join('')}
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function buildMonthlyHeatmap(rows) {
    const map = {};
    for (const row of rows) {
      map[row.id] = Array.from({ length: 12 }, () => 0);
      for (const payment of row.paymentsForClient) {
        const date = toDate(payment.payment_date);
        if (!date) continue;
        map[row.id][date.getMonth()] += payment.amount;
      }
      for (const expense of row.expensesForClient) {
        const date = toDate(expense.expense_date);
        if (!date) continue;
        map[row.id][date.getMonth()] -= expense.amount;
      }
    }
    return map;
  }

  function renderSmartPanels(model) {
    return `
      <div class="mt-grid-2">
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Margin Insights</h4>
              <p class="mt-panel-copy">Auto-generated recommendations based on the visible data.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-alert-grid">
              ${model.insights.map((insight) => `
                <div class="mt-alert-card ${insight.tone}">
                  <div style="font-weight:800; margin-bottom:6px;">${escapeHtml(insight.title)}</div>
                  <div>${escapeHtml(insight.text)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Alerts Feed</h4>
              <p class="mt-panel-copy">The system flags low-margin or over-budget behavior immediately.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-list">
              ${model.alerts.map((alert) => `
                <div class="mt-list-item">
                  <div>
                    <strong>${escapeHtml(alert.title)}</strong>
                    <small>${escapeHtml(alert.text)}</small>
                  </div>
                  <span class="mt-status ${alert.tone === 'critical' ? 'risk' : alert.tone === 'watch' ? 'watch' : 'healthy'}">${escapeHtml(alert.tone)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderClientTable(model) {
    if (!model.filteredClients.length) {
      return `
        <div class="mt-panel">
          <div class="mt-panel-header">
            <div>
              <h4 class="mt-panel-title">Client Margin Table</h4>
              <p class="mt-panel-copy">No clients match the current filters.</p>
            </div>
          </div>
          <div class="mt-panel-body">
            <div class="mt-empty">Adjust the filters to surface client profitability rows.</div>
          </div>
        </div>
      `;
    }

    const headerCells = [
      ['client', 'Client Name'],
      ['revenue', 'Revenue'],
      ['expenses', 'Expenses'],
      ['grossProfit', 'Gross Profit'],
      ['netProfit', 'Net Profit'],
      ['marginPct', 'Margin %'],
      ['monthlyChange', 'Monthly Change'],
      ['status', 'Status'],
      ['lastUpdated', 'Last Updated']
    ];

    const rows = model.visibleRows.map((row) => {
      const expanded = state.expandedId === row.id;
      return `
        <tr>
          <td><button class="mt-row-toggle" data-action="toggle-row" data-id="${escapeHtml(String(row.id))}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(row.name)}">${expanded ? '−' : '+'}</button></td>
          <td><strong>${escapeHtml(row.name)}</strong></td>
          <td>${escapeHtml(formatMoney(row.revenue))}</td>
          <td>${escapeHtml(formatMoney(row.expenses))}</td>
          <td>${escapeHtml(formatMoney(row.grossProfit))}</td>
          <td>${escapeHtml(formatMoney(row.netProfit))}</td>
          <td><span class="mt-status ${row.marginPct >= 35 ? 'healthy' : row.marginPct >= 20 ? 'watch' : 'risk'}">${escapeHtml(percentFmt.format(row.marginPct))}%</span></td>
          <td>${escapeHtml(formatDelta(row.monthlyChange, 'points'))}</td>
          <td><span class="mt-status ${row.status === 'Healthy' ? 'healthy' : row.status === 'Watch' ? 'watch' : 'risk'}">${escapeHtml(row.status)}</span></td>
          <td>${escapeHtml(formatDate(row.lastUpdated))}</td>
        </tr>
        ${expanded ? renderExpandedRow(row) : ''}
      `;
    }).join('');

    const pages = Array.from({ length: model.pageCount }, (_, idx) => idx + 1);

    return `
      <div class="mt-panel">
        <div class="mt-panel-header">
          <div>
            <h4 class="mt-panel-title">Client Margin Table</h4>
            <p class="mt-panel-copy">Searchable, sortable, expandable client-level profitability with pagination and row-level trend notes.</p>
          </div>
          <div class="mt-chip-row">
            <span class="mt-chip"><strong>${escapeHtml(String(model.pageCount))}</strong> pages</span>
            <span class="mt-chip"><strong>${escapeHtml(String(model.totalClients))}</strong> visible rows</span>
          </div>
        </div>
        <div class="mt-panel-body">
          <div class="mt-table-wrap">
            <table class="mt-table">
              <thead>
                <tr>
                  <th aria-label="Expand"></th>
                  ${headerCells.map(([key, label]) => `<th data-action="sort" data-key="${escapeHtml(key)}">${escapeHtml(label)} ${state.sortKey === key ? (state.sortDir === 'asc' ? '^' : 'v') : ''}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
          <div class="mt-chip-row" style="margin-top:14px;">
            <button class="mt-action-btn secondary" data-action="page-prev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
            ${pages.slice(0, 7).map((page) => `<button class="mt-view-btn" data-action="set-page" data-page="${page}" aria-pressed="${state.page === page}">${page}</button>`).join('')}
            <button class="mt-action-btn secondary" data-action="page-next" ${state.page >= model.pageCount ? 'disabled' : ''}>Next</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderExpandedRow(row) {
    const miniSeries = buildMiniSeries(row);
    const invoiceHistory = row.paymentsForClient.slice(0, 6).map((payment) => `
      <div class="mt-list-item">
        <div>
          <strong>Payment</strong>
          <small>${escapeHtml(formatDate(payment.payment_date))}</small>
        </div>
        <div>${escapeHtml(formatMoney(payment.amount))}</div>
      </div>
    `).join('');
    const expenseHistory = row.expensesForClient.slice(0, 6).map((expense) => `
      <div class="mt-list-item">
        <div>
          <strong>${escapeHtml(expense.category)}</strong>
          <small>${escapeHtml(formatExpenseSummary(expense))}</small>
        </div>
        <div>${escapeHtml(formatMoney(expense.amount))}</div>
      </div>
    `).join('');

    return `
      <tr class="mt-expand-row">
        <td colspan="10">
          <div class="mt-expand-panel">
            <div class="mt-mini-chart">
              <div style="font-weight:800; margin-bottom:10px;">Mini trend</div>
              ${miniSeries}
            </div>
            <div>
              <div style="font-weight:800; margin-bottom:10px;">Invoice history</div>
              <div class="mt-list">${invoiceHistory || '<div class="mt-empty">No payment history.</div>'}</div>
            </div>
            <div>
              <div style="font-weight:800; margin-bottom:10px;">Expense breakdown</div>
              <div class="mt-list">${expenseHistory || '<div class="mt-empty">No expense history.</div>'}</div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function buildMiniSeries(row) {
    const months = Array.from({ length: 12 }, (_, index) => ({
      label: monthNames[index],
      revenue: 0,
      expenses: 0
    }));
    for (const payment of row.paymentsForClient) {
      const date = toDate(payment.payment_date);
      if (date) months[date.getMonth()].revenue += payment.amount;
    }
    for (const expense of row.expensesForClient) {
      const date = toDate(expense.expense_date);
      if (date) months[date.getMonth()].expenses += expense.amount;
    }
    return lineChart(months.map((item) => ({
      label: item.label,
      revenue: item.revenue,
      expenses: item.expenses,
      marginPct: item.revenue > 0 ? ((item.revenue - item.expenses) / item.revenue) * 100 : 0
    })), 'revenue', 'expenses', ['#72edc7', '#7ab7d6']);
  }

  function formatExpenseSummary(expense) {
    const snapshot = expense.marginSnapshot;
    if (snapshot) {
      return `Job ${formatMoney(snapshot.jobTotal)} | Received ${formatMoney(snapshot.moneyReceived)} | Cost ${formatMoney(snapshot.jobCost)} | Margin ${percentFmt.format(snapshot.marginPct)}%`;
    }
    return expense.project || expense.notes || expense.invoice_status || 'Saved entry';
  }

  function renderExpenseForm(model) {
    return `
      <div class="mt-panel">
        <div class="mt-panel-header">
          <div>
            <h4 class="mt-panel-title">Quick Margin Entry</h4>
            <p class="mt-panel-copy">Enter four values, save once, and move on. Everything else stays optional.</p>
          </div>
          <div class="mt-chip-row">
            <span class="mt-chip"><strong>${escapeHtml(String(model.averageSavedMargin.toFixed(1)))}</strong>% average margin</span>
            <span class="mt-chip"><strong>${escapeHtml(String(model.expenses.filter((entry) => entry.marginSnapshot).length))}</strong> saved margins</span>
          </div>
        </div>
        <div class="mt-panel-body">
          <form data-form="expense" class="mt-form-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr));">
            <div class="mt-field">
              <label>Job Total</label>
              <input name="jobTotal" data-margin-field="jobTotal" type="text" inputmode="decimal" placeholder="10000">
            </div>
            <div class="mt-field">
              <label>Money Received</label>
              <input name="moneyReceived" data-margin-field="moneyReceived" type="text" inputmode="decimal" placeholder="10000">
            </div>
            <div class="mt-field">
              <label>Job Cost</label>
              <input name="jobCost" data-margin-field="jobCost" type="text" inputmode="decimal" placeholder="7000">
            </div>
            <div class="mt-field">
              <label>Margin %</label>
              <input name="marginPct" data-margin-field="marginPct" type="text" readonly placeholder="30.0%" aria-label="Calculated margin percentage">
            </div>
            <div class="mt-field" style="grid-column: 1 / -1; display:flex; align-items:flex-end;">
              <button type="submit" class="mt-action-btn" style="width:100%;">Save margin</button>
            </div>
            <details class="full-span" style="grid-column: 1 / -1; margin-top: 4px;">
              <summary style="cursor:pointer; color: var(--text-muted); font-weight:700;">Optional details</summary>
              <div class="mt-form-grid" style="grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 12px;">
                <div class="mt-field">
                  <label>Client Name</label>
                  <input name="clientName" type="text" placeholder="Optional">
                </div>
                <div class="mt-field">
                  <label>Project</label>
                  <input name="project" type="text" placeholder="Optional">
                </div>
                <div class="mt-field">
                  <label>Category</label>
                  <select name="category">
                    <option value="Misc">Misc</option>
                    <option value="Labor">Labor</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Software">Software</option>
                    <option value="Contractors">Contractors</option>
                    <option value="Operations">Operations</option>
                    <option value="Taxes">Taxes</option>
                  </select>
                </div>
                <div class="mt-field">
                  <label>Notes</label>
                  <input name="notes" type="text" placeholder="Optional note">
                </div>
              </div>
            </details>
          </form>
        </div>
      </div>
    `;
  }

  function updateQuickMarginPreview(form) {
    if (!form) return;
    const marginInput = form.querySelector('[name="marginPct"]');
    const jobTotal = toNumber(form.querySelector('[name="jobTotal"]')?.value);
    const jobCost = toNumber(form.querySelector('[name="jobCost"]')?.value);
    if (!marginInput) return;
    // Keep the calculator forgiving: invalid, empty, or zero totals show a blank state instead of NaN.
    const computed = computeMarginPct(jobTotal, jobCost);
    marginInput.value = Number.isFinite(computed) && jobTotal !== 0 ? `${percentFmt.format(computed)}%` : '';
  }

  function animateCounters() {
    root.querySelectorAll('[data-count]').forEach((el) => {
      const target = toNumber(el.getAttribute('data-count'));
      const format = el.getAttribute('data-format');
      const start = 0;
      const startTime = performance.now();
      const duration = 650;
      const step = (now) => {
        const progress = clamp((now - startTime) / duration, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = start + ((target - start) * eased);
        el.textContent = format === 'percent' ? `${percentFmt.format(value)}%` : formatMoney(value);
        if (progress < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function handleInteraction(event) {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl && root.contains(actionEl)) {
      const action = actionEl.dataset.action;
      if (action === 'set-view') {
        state.view = actionEl.dataset.view;
        state.page = 1;
        if (state.view === 'month') state.month = clamp(state.month, 1, 12);
        if (state.view === 'quarter') state.quarter = clamp(state.quarter, 1, 4);
        render();
        return;
      }
      if (action === 'reset-filters') {
        state.filters = defaultFilters();
        state.page = 1;
        state.expandedId = null;
        render();
        return;
      }
      if (action === 'export-csv') {
        exportCSV();
        return;
      }
      if (action === 'toggle-row') {
        const id = Number(actionEl.dataset.id);
        state.expandedId = state.expandedId === id ? null : id;
        render();
        return;
      }
      if (action === 'sort') {
        const key = actionEl.dataset.key;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = key === 'lastUpdated' ? 'desc' : 'desc';
        }
        render();
        return;
      }
      if (action === 'set-page') {
        state.page = Number(actionEl.dataset.page) || 1;
        render();
        return;
      }
      if (action === 'page-prev') {
        state.page = Math.max(1, state.page - 1);
        render();
        return;
      }
      if (action === 'page-next') {
        const model = buildAnalysis(state.data);
        state.page = Math.min(model.pageCount, state.page + 1);
        render();
        return;
      }
      if (action === 'retry') {
        refreshDashboard();
        return;
      }
    }

    const filter = event.target.closest('[data-filter]');
    if (filter && root.contains(filter)) {
      const key = filter.dataset.filter;
      state.filters[key] = filter.value;
      state.page = 1;
      render();
      return;
    }

    const control = event.target.closest('[data-control]');
    if (control && root.contains(control)) {
      if (control.dataset.control === 'month') {
        state.month = clamp(Number(control.value) || 1, 1, 12);
        state.page = 1;
        render();
      }
      if (control.dataset.control === 'quarter') {
        state.quarter = clamp(Number(control.value) || 1, 1, 4);
        state.page = 1;
        render();
      }
    }

    const marginField = event.target.closest('[data-margin-field]');
    if (marginField && root.contains(marginField)) {
      updateQuickMarginPreview(event.target.closest('[data-form="expense"]'));
      return;
    }

    const form = event.target.closest('[data-form="expense"]');
    if (form && event.type === 'submit') {
      event.preventDefault();
      saveExpense(form);
    }
  }

  function exportCSV() {
    const model = buildAnalysis(state.data);
    const header = ['Client Name', 'Revenue', 'Expenses', 'Gross Profit', 'Net Profit', 'Margin %', 'Monthly Change', 'Status', 'Last Updated'];
    const rows = [header.join(',')].concat(model.filteredClients.map((row) => [
      row.name,
      row.revenue.toFixed(2),
      row.expenses.toFixed(2),
      row.grossProfit.toFixed(2),
      row.netProfit.toFixed(2),
      row.marginPct.toFixed(2),
      row.monthlyChange.toFixed(2),
      row.status,
      row.lastUpdated || ''
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `margin-tracker-${state.year}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function saveExpense(form) {
    const jobTotal = toNumber(form.jobTotal?.value);
    const moneyReceived = toNumber(form.moneyReceived?.value);
    const jobCost = toNumber(form.jobCost?.value);
    const marginPct = computeMarginPct(jobTotal, jobCost);
    const noteText = normalizeText(form.notes?.value || '');

    const payload = {
      clientName: form.clientName?.value || '',
      category: form.category?.value || 'Misc',
      project: form.project?.value || '',
      invoiceStatus: 'Paid',
      amount: String(Math.max(0, jobCost) || 0),
      expenseType: 'one-time',
      recurring: false,
      expenseDate: new Date().toISOString().slice(0, 10),
      attachmentUrl: '',
      notes: JSON.stringify({
        kind: 'quick-margin',
        jobTotal,
        moneyReceived,
        jobCost,
        marginPct,
        noteText
      })
    };

    try {
      const res = await fetch('/api/finance/margin/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save expense');
      form.reset();
      updateQuickMarginPreview(form);
      await refreshDashboard();
      document.dispatchEvent(new Event('financeUpdated'));
    } catch (err) {
      console.error(err);
      alert('Unable to save expense entry right now.');
    }
  }

  async function refreshDashboard() {
    state.loading = true;
    state.error = null;
    render();

    const currentRequest = ++state.refreshCounter;
    const year = getYearFromInput();
    state.year = year;

    try {
      const res = await fetch(`/api/finance/margin/dashboard?year=${encodeURIComponent(year)}`);
      if (!res.ok) throw new Error('Failed to fetch margin dashboard');
      const data = await res.json();
      if (currentRequest !== state.refreshCounter) return;
      state.data = data;
      state.loading = false;
      state.error = null;
      render();
    } catch (err) {
      console.error('Margin tracker load failed:', err);
      if (currentRequest !== state.refreshCounter) return;
      state.loading = false;
      state.error = err?.message || 'Unable to load margin tracker';
      render();
    }
  }

  document.addEventListener('financeUpdated', () => {
    refreshDashboard();
  });

  yearInput?.addEventListener('change', () => {
    state.year = getYearFromInput();
    state.page = 1;
    refreshDashboard();
  });

  root.addEventListener('click', handleInteraction);
  root.addEventListener('change', handleInteraction);
  root.addEventListener('input', handleInteraction);
  root.addEventListener('submit', handleInteraction);

  refreshDashboard();
})();
