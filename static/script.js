document.addEventListener('DOMContentLoaded', function() {
    // --- Przejęcie kontroli nad przywracaniem przewijania ---
    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    // --- Inicjalizacja stałych i elementów DOM ---
    const fab = document.getElementById('fab-add');
    const modal = document.getElementById('add-modal');
    const closeModalBtn = document.getElementById('close-modal');
    const statuses = ['nowy', 'aktywny', 'kontakt', 'utracony', 'lojalny', 'nieaktywny'];
    const statusLabels = {
        nowy: 'Nowy', aktywny: 'Aktywny', kontakt: 'Kontakt', utracony: 'Utracony',
        lojalny: 'Wizyta', nieaktywny: 'Nieaktywny'
    };
    const filterForm = document.getElementById('filter-form');
    let searchTimeout;
    let calendar = null;

    // --- Obsługa okna dialogowego (modal) ---
    if (fab && modal) {
        fab.addEventListener('click', () => { modal.classList.remove('hidden'); });
    }
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => { modal.classList.add('hidden'); });
    }
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) { modal.classList.add('hidden'); }
        });
    }

    // --- Funkcje pomocnicze i renderujące ---
    function getStatusIconHTML(status) {
        switch (status) {
            case 'aktywny': return '<i class="fas fa-check-circle"></i>';
            case 'lojalny': return '<i class="fas fa-star"></i>';
            case 'kontakt': return '<i class="fas fa-phone-alt"></i>';
            case 'utracony': return '<i class="fas fa-ban"></i>';
            case 'nieaktywny': return '<i class="fas fa-moon"></i>';
            default: return '<i class="far fa-circle"></i>';
        }
    }

    function addEventListenersToRows(rows) {
        rows.forEach(row => {
            row.addEventListener('click', function(event) {
                if (event.target.tagName === 'A' || event.target.closest('a')) return;
                const contactId = this.dataset.contactId;
                let currentStatus = this.dataset.currentStatus;
                const currentIndex = statuses.indexOf(currentStatus);
                const nextIndex = (currentIndex + 1) % statuses.length;
                const newStatus = statuses[nextIndex];
                fetch(`/contact/${contactId}/update_status`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ status: newStatus }),
                })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        this.className = this.className.replace(/status-\w+/, `status-${newStatus}`);
                        this.dataset.currentStatus = newStatus;
                        const iconSpan = this.querySelector('.status-icon');
                        if (iconSpan) {
                            iconSpan.innerHTML = getStatusIconHTML(newStatus);
                            iconSpan.title = `Status: ${newStatus}`;
                        }
                    }
                });
            });
        });
    }

function renderTable(contacts) {
    const tableBody = document.querySelector('#table-view tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    // POPRAWKA: colspan musi wynosić 12, bo dodaliśmy kolumnę statusu
    if (contacts.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="12">Brak kontaktów pasujących do kryteriów.</td></tr>';
        return;
    }

    const today = new Date().toISOString().split('T')[0];

    contacts.forEach(contact => {
        const isOverdue = contact.reminder_date && contact.reminder_date < today;
        const hasReminder = !!contact.reminder_date;
        const row = document.createElement('tr');
        
        row.className = `status-${contact.status} ${hasReminder ? 'has-reminder' : ''} ${isOverdue ? 'reminder-overdue' : ''}`;
        row.dataset.contactId = contact.id;
        row.dataset.currentStatus = contact.status;

        const lastNoteDate = contact.last_note_date ? contact.last_note_date.split(' ')[0] : '';

        // KOLEJNOŚĆ: Status jest teraz pierwszy
        row.innerHTML = `
            <td class="col-status">
                <span class="status-icon" title="Status: ${contact.status}">${getStatusIconHTML(contact.status)}</span>
            </td>
            <td class="col-name">
                <a href="/contact/${contact.id}">${contact.name || ''}</a>
            </td>
            <td class="col-street">${contact.street || ''}</td>
            <td class="col-city">${contact.city || ''}</td>
            <td class="col-voivodeship">${contact.voivodeship || ''}</td>
            <td class="col-phone">${contact.phone || ''}</td>
            <td class="col-email">${contact.email || ''}</td>
            <td class="col-nip">${contact.nip || ''}</td>
            <td class="col-www"><a href="${contact.www || ''}" target="_blank" rel="noopener noreferrer">${contact.www || ''}</a></td>
            <td class="col-notes notes-cell" title="${contact.notes || ''}">${contact.notes || ''}</td>
            <td class="col-reminder_date">${contact.reminder_date || 'Brak'}</td>
            <td class="col-last_note last-note" title="${contact.last_note ? `${lastNoteDate}: ${contact.last_note}` : ''}">
                ${contact.last_note ? `<span class="note-date">${lastNoteDate}</span>${contact.last_note}` : 'Brak'}
            </td>
        `;
        tableBody.appendChild(row);
    });

    addEventListenersToRows(tableBody.querySelectorAll('tr[data-contact-id]'));
    addEventListenersToLinks(tableBody.querySelectorAll('td.col-name a'));
    updateColumnVisibility();
}

    function renderKanbanBoard(contacts) {
        const kanbanView = document.getElementById('kanban-view');
        if (!kanbanView) return;
        kanbanView.innerHTML = '';
        statuses.forEach(status => {
            const column = document.createElement('div');
            column.className = 'kanban-column';
            column.dataset.status = status;
            column.innerHTML = `<h3>${statusLabels[status]}</h3><div class="kanban-cards"></div>`;
            kanbanView.appendChild(column);
        });
        contacts.forEach(contact => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.dataset.contactId = contact.id;
            card.innerHTML = `
                <div class="kanban-card-title"><a href="/contact/${contact.id}">${contact.name}</a></div>
                <div class="kanban-card-meta">${contact.city || 'Brak miasta'}</div>
                ${contact.reminder_date ? `<div class="kanban-card-reminder"><i class="fas fa-bell"></i> ${contact.reminder_date}</div>` : ''}
            `;
            const targetColumn = kanbanView.querySelector(`.kanban-column[data-status="${contact.status}"] .kanban-cards`);
            if (targetColumn) targetColumn.appendChild(card);
        });
        const cardContainers = kanbanView.querySelectorAll('.kanban-cards');
        cardContainers.forEach(container => {
            new Sortable(container, {
                group: 'contacts', animation: 150, ghostClass: 'kanban-card-ghost',
                onEnd: function (evt) {
                    const contactId = evt.item.dataset.contactId;
                    const newStatus = evt.to.parentElement.dataset.status;
                    fetch(`/contact/${contactId}/update_status`, {
                        method: 'POST',
                        headers: { 
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify({ status: newStatus }),
                    });
                }
            });
        });
    }
    
function renderCalendar() {
    const calendarView = document.getElementById('calendar-view');
    if (!calendarView) return;
    if (calendar) {
        calendar.refetchEvents();
        return;
    }
    calendar = new FullCalendar.Calendar(calendarView, {
        locale: 'pl',
        initialView: 'dayGridMonth',
        // ### ZMIANA: Przywrócenie klasycznego układu z 3 sekcjami ###
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,dayGridWeek,listWeek'
        },
        events: '/api/reminders',
        displayEventTime: false,
        weekends: false
    });
    calendar.render();
}

    // --- Logika dynamicznego odświeżania i przełączania widoków ---
    const tableView = document.getElementById('table-view');
    const kanbanView = document.getElementById('kanban-view');
    const calendarView = document.getElementById('calendar-view');
    const tableBtn = document.getElementById('view-btn-table');
    const kanbanBtn = document.getElementById('view-btn-kanban');
    const calendarBtn = document.getElementById('view-btn-calendar');

    function switchView(view) {
        tableView.classList.add('hidden');
        kanbanView.classList.add('hidden');
        calendarView.classList.add('hidden');
        [tableBtn, kanbanBtn, calendarBtn].forEach(b => b.classList.remove('active'));
        localStorage.setItem('crm_view', view);
        if (view === 'kanban') {
            kanbanView.classList.remove('hidden');
            kanbanBtn.classList.add('active');
            fetchFilteredContacts();
        } else if (view === 'calendar') {
            calendarView.classList.remove('hidden');
            calendarBtn.classList.add('active');
            renderCalendar();
        } else {
            tableView.classList.remove('hidden');
            tableBtn.classList.add('active');
            fetchFilteredContacts();
        }
    }

    function updateView(contacts) {
        const currentView = localStorage.getItem('crm_view') || 'table';
        if (currentView === 'kanban') renderKanbanBoard(contacts);
        else renderTable(contacts);
    }

    function fetchFilteredContacts() {
        const formData = new FormData(filterForm);
        const currentSortBy = localStorage.getItem('crm_sort_by') || 'name';
        const currentSortOrder = localStorage.getItem('crm_sort_order') || 'asc';
        formData.append('sort_by', currentSortBy);
        formData.append('order', currentSortOrder);
        const params = new URLSearchParams(formData);
		const exportBtn = document.getElementById('export-btn');
        if(exportBtn) { exportBtn.href = `/export_csv?${params.toString()}`; }
        history.pushState(null, '', `?${params.toString()}`);
        fetch(`/filter?${params.toString()}`)
            .then(response => response.json())
            .then(data => { updateView(data); });
    }

    if (filterForm) {
        filterForm.addEventListener('submit', (e) => { e.preventDefault(); fetchFilteredContacts(); });
        const liveInputs = ['input[name="q"]', 'input[name="filter_city"]'];
        liveInputs.forEach(selector => {
            const input = filterForm.querySelector(selector);
            if (input) {
                input.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    searchTimeout = setTimeout(fetchFilteredContacts, 300);
                });
            }
        });
        const statusSelect = filterForm.querySelector('select[name="filter_status"]');
        if (statusSelect) { statusSelect.addEventListener('change', fetchFilteredContacts); }
    }
    
    // --- Obsługa sortowania ---
    const sortLinks = document.querySelectorAll('thead th a[data-sort]');
    function applySort(sortBy) {
        const oldSortBy = localStorage.getItem('crm_sort_by') || 'name';
        const oldSortOrder = localStorage.getItem('crm_sort_order') || 'asc';
        const newOrder = (sortBy === oldSortBy && oldSortOrder === 'asc') ? 'desc' : 'asc';
        localStorage.setItem('crm_sort_by', sortBy);
        localStorage.setItem('crm_sort_order', newOrder);
        updateSortIcons();
        fetchFilteredContacts();
    }
    function updateSortIcons() {
        const currentSortBy = localStorage.getItem('crm_sort_by') || 'name';
        const currentSortOrder = localStorage.getItem('crm_sort_order') || 'asc';
        sortLinks.forEach(link => {
            const icon = link.querySelector('i.fa-sort-up, i.fa-sort-down');
            if(icon) icon.remove();
            if (link.dataset.sort === currentSortBy) {
                const newIcon = document.createElement('i');
                newIcon.className = `fas fa-sort-${currentSortOrder === 'asc' ? 'up' : 'down'}`;
                link.appendChild(document.createTextNode(' '));
                link.appendChild(newIcon);
            }
        });
    }
    sortLinks.forEach(link => {
        link.addEventListener('click', (e) => { e.preventDefault(); applySort(link.dataset.sort); });
    });
    
    // --- Obsługa paneli filtrów i kolumn ---
    const toggleAdvancedBtn = document.getElementById('toggle-advanced-filters');
    const advancedFilters = document.getElementById('advanced-filters');
    const toggleColumnsBtn = document.getElementById('toggle-column-selector');
    const columnSelector = document.getElementById('column-selector');
    const currentUrlParams = new URLSearchParams(window.location.search);
    if (toggleAdvancedBtn) {
        toggleAdvancedBtn.addEventListener('click', () => { advancedFilters.classList.toggle('hidden'); });
        if (currentUrlParams.get('filter_city') || currentUrlParams.get('filter_status')) {
            advancedFilters.classList.remove('hidden');
        }
    }
    if (toggleColumnsBtn) { toggleColumnsBtn.addEventListener('click', () => { columnSelector.classList.toggle('hidden'); }); }

    // --- Obsługa widoczności kolumn ---
    const columnCheckboxes = document.querySelectorAll('#column-selector input[type="checkbox"]');
    const table = document.querySelector('.contacts-container table');
    function updateColumnVisibility() {
        const visibleColumns = {};
        columnCheckboxes.forEach(checkbox => { visibleColumns[checkbox.value] = checkbox.checked; });
        for (const colClass in visibleColumns) {
            if (table) {
                const cells = table.querySelectorAll(`.${colClass}`);
                cells.forEach(cell => { cell.style.display = visibleColumns[colClass] ? '' : 'none'; });
            }
        }
        localStorage.setItem('crm_visible_columns', JSON.stringify(visibleColumns));
    }
    const savedColumns = JSON.parse(localStorage.getItem('crm_visible_columns'));
    if (savedColumns) {
        columnCheckboxes.forEach(checkbox => {
            if (savedColumns[checkbox.value] !== undefined) { checkbox.checked = savedColumns[checkbox.value]; }
        });
    }
    columnCheckboxes.forEach(checkbox => { checkbox.addEventListener('change', updateColumnVisibility); });
    
    // --- Obsługa zapamiętywania pozycji przewijania ---
    function addEventListenersToLinks(links) {
        links.forEach(link => {
            link.addEventListener('click', function() { sessionStorage.setItem('scrollPosition', window.scrollY); });
        });
    }
    window.addEventListener('pageshow', function(event) {
        const savedScrollPosition = sessionStorage.getItem('scrollPosition');
        if (savedScrollPosition) {
            window.scrollTo(0, parseInt(savedScrollPosition, 10));
            sessionStorage.removeItem('scrollPosition');
        }
    });

    // --- Obsługa zmiany szerokości kolumn ---
    const tableToResize = document.querySelector('#table-view table');
    function loadColumnWidths() {
        const savedWidths = JSON.parse(localStorage.getItem('crm_column_widths'));
        if (savedWidths && tableToResize) {
            for (const colClass in savedWidths) {
                const header = tableToResize.querySelector(`th.${colClass}`);
                if (header) { header.style.width = savedWidths[colClass]; }
            }
        }
    }
    function saveColumnWidths() {
        if (!tableToResize) return;
        const headers = tableToResize.querySelectorAll('thead th');
        const widthsToSave = {};
        headers.forEach(header => {
            const colClass = header.classList[0];
            if (colClass) { widthsToSave[colClass] = header.style.width; }
        });
        localStorage.setItem('crm_column_widths', JSON.stringify(widthsToSave));
    }
    if (tableToResize) {
        const resizableHeaders = tableToResize.querySelectorAll('thead th');
        resizableHeaders.forEach(header => {
            const resizer = document.createElement('div');
            resizer.className = 'resizer';
            header.appendChild(resizer);
            resizer.addEventListener('mousedown', function(e) {
                e.preventDefault();
                let startX = e.pageX;
                let startWidth = header.offsetWidth;
                function onMouseMove(e) {
                    const newWidth = startWidth + (e.pageX - startX);
                    if (newWidth > 50) { header.style.width = newWidth + 'px'; }
                }
                function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    saveColumnWidths();
                }
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }
    
    // --- Inicjalizacja przy starcie ---
    const savedView = localStorage.getItem('crm_view') || 'table';
    if (tableBtn && kanbanBtn && calendarBtn) {
        tableBtn.addEventListener('click', () => switchView('table'));
        kanbanBtn.addEventListener('click', () => switchView('kanban'));
        calendarBtn.addEventListener('click', () => switchView('calendar'));
        switchView(savedView);
    } else {
        fetchFilteredContacts();
    }
    
    updateSortIcons();
    updateColumnVisibility();
    loadColumnWidths();
});