document.addEventListener('DOMContentLoaded', function() {
    // --- Dark Mode ---
    const darkModeBtn = document.getElementById('toggle-dark-mode');
    if (localStorage.getItem('crm_dark_theme') === 'enabled') {
        document.body.classList.add('dark-theme');
    }
    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');
            if (document.body.classList.contains('dark-theme')) {
                localStorage.setItem('crm_dark_theme', 'enabled');
            } else {
                localStorage.setItem('crm_dark_theme', 'disabled');
            }
        });
    }

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

    // --- Refresh Stats Function ---
    function refreshStats() {
        fetch('/api/stats')
            .then(res => res.json())
            .then(stats => {
                const map = {
                    total_count: '.stat-card:nth-child(1) .stat-value',
                    reminders_today: '.stat-card:nth-child(2) .stat-value',
                    reminders_overdue: '.stat-card:nth-child(3) .stat-value',
                    status_nowy: '.stat-card:nth-child(4) .stat-value',
                    status_aktywny: '.stat-card:nth-child(5) .stat-value',
                    status_kontakt: '.stat-card:nth-child(6) .stat-value',
                    status_lojalny: '.stat-card:nth-child(7) .stat-value',
                    status_utracony: '.stat-card:nth-child(8) .stat-value',
                    status_nieaktywny: '.stat-card:nth-child(9) .stat-value'
                };
                for (const key in map) {
                    const el = document.querySelector(map[key]);
                    if (el && stats[key] !== undefined) {
                        el.innerText = stats[key];
                    }
                }
            }).catch(err => console.error(err));
    }

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

    // --- Moduł Uzupełniania Brakujących Danych (Wizard) ---
    const wizardModal = document.getElementById('missing-data-modal');
    const closeWizardBtn = document.getElementById('close-missing-data-modal');
    const openWizardBtn = document.getElementById('btn-missing-data-wizard');
    const wizardForm = document.getElementById('wizard-form');
    const wizardSkipBtn = document.getElementById('wizard-skip-btn');

    let incompleteContacts = [];
    let currentWizardIndex = 0;

    if (closeWizardBtn && wizardModal) {
        closeWizardBtn.addEventListener('click', () => wizardModal.classList.add('hidden'));
        wizardModal.addEventListener('click', (e) => {
            if (e.target === wizardModal) wizardModal.classList.add('hidden');
        });
    }

    function loadWizardContact() {
        if (!incompleteContacts || currentWizardIndex >= incompleteContacts.length) {
            wizardModal.classList.add('hidden');
            showToast('Wszystkie zaległe kontakty zostały zweryfikowane!', 'success');
            fetchFilteredContacts();
            refreshStats();
            return;
        }

        const contact = incompleteContacts[currentWizardIndex];
        document.getElementById('wizard-contact-id').value = contact.id;
        document.getElementById('wizard-contact-title').innerText = `${contact.name} (Klient ${currentWizardIndex + 1} z ${incompleteContacts.length})`;
        document.getElementById('wizard-progress').innerText = `Postęp: ${currentWizardIndex + 1} / ${incompleteContacts.length}`;
        document.getElementById('wizard-phone').value = contact.phone || '';
        document.getElementById('wizard-email').value = contact.email || '';
        document.getElementById('wizard-nip').value = contact.nip || '';
        document.getElementById('wizard-city').value = contact.city || '';
    }

    if (openWizardBtn) {
        openWizardBtn.addEventListener('click', function() {
            showSpinner();
            fetch('/filter')
                .then(res => res.json())
                .then(contacts => {
                    hideSpinner();
                    incompleteContacts = contacts.filter(c => !c.phone || !c.email || !c.nip || !c.city);
                    if (incompleteContacts.length === 0) {
                        showToast('Świetnie! Wszyscy klienci posiadają kompletne dane.', 'success');
                        return;
                    }
                    currentWizardIndex = 0;
                    wizardModal.classList.remove('hidden');
                    loadWizardContact();
                })
                .catch(() => {
                    hideSpinner();
                    showToast('Błąd pobierania listy kontaktów.', 'danger');
                });
        });
    }

    if (wizardSkipBtn) {
        wizardSkipBtn.addEventListener('click', function() {
            currentWizardIndex++;
            loadWizardContact();
        });
    }

    if (wizardForm) {
        wizardForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const contactId = document.getElementById('wizard-contact-id').value;
            const contact = incompleteContacts[currentWizardIndex];

            const updatedData = {
                name: contact.name,
                street: contact.street || '',
                city: document.getElementById('wizard-city').value.trim(),
                voivodeship: contact.voivodeship || '',
                phone: document.getElementById('wizard-phone').value.trim(),
                email: document.getElementById('wizard-email').value.trim(),
                nip: document.getElementById('wizard-nip').value.trim(),
                www: contact.www || '',
                notes: contact.notes || ''
            };

            showSpinner();
            fetch(`/contact/${contactId}/update`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(updatedData)
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast('Zaktualizowano dane kontaktu!', 'success');
                    currentWizardIndex++;
                    loadWizardContact();
                } else {
                    showToast(data.message || 'Błąd aktualizacji.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd komunikacji z serwerem.', 'danger');
            });
        });
    }

    // --- Obsługa modala powodu utraty ---
    const lostReasonModal = document.getElementById('lost-reason-modal');
    const closeLostReasonBtn = document.getElementById('close-lost-reason-modal');
    const lostReasonForm = document.getElementById('lost-reason-form');
    const cancelLostReasonBtn = document.getElementById('btn-cancel-lost-reason');
    const skipLostReasonBtn = document.getElementById('btn-skip-lost-reason');

    if (closeLostReasonBtn && lostReasonModal) {
        closeLostReasonBtn.addEventListener('click', () => lostReasonModal.classList.add('hidden'));
        lostReasonModal.addEventListener('click', (e) => {
            if (e.target === lostReasonModal) lostReasonModal.classList.add('hidden');
        });
    }

    if (cancelLostReasonBtn) {
        cancelLostReasonBtn.addEventListener('click', () => {
            if (lostReasonModal) lostReasonModal.classList.add('hidden');
        });
    }

    if (skipLostReasonBtn) {
        skipLostReasonBtn.addEventListener('click', () => {
            const contactId = document.getElementById('lost-reason-contact-id').value;
            if (!contactId) return;

            showSpinner();
            fetch(`/contact/${contactId}/update_status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ status: 'utracony', lost_reason: '' })
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast('Zmieniono status na Utracony', 'info');
                    lostReasonModal.classList.add('hidden');
                    fetchFilteredContacts();
                    refreshStats();
                } else {
                    showToast(data.message || 'Błąd zmiany statusu.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd komunikacji z serwerem.', 'danger');
            });
        });
    }

    if (lostReasonForm) {
        lostReasonForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const contactId = document.getElementById('lost-reason-contact-id').value;
            const reason = document.getElementById('lost_reason_select').value;

            showSpinner();
            fetch(`/contact/${contactId}/update_status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ status: 'utracony', lost_reason: reason })
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast('Zmieniono status na Utracony z powodem: ' + reason, 'success');
                    lostReasonModal.classList.add('hidden');
                    fetchFilteredContacts();
                    refreshStats();
                } else {
                    showToast(data.message || 'Błąd zmiany statusu.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd komunikacji z serwerem.', 'danger');
            });
        });
    }

    // --- Obsługa modala szybkiej notatki ---
    const quickNoteModal = document.getElementById('quick-note-modal');
    const closeQuickNoteBtn = document.getElementById('close-quick-note-modal');
    const quickNoteForm = document.getElementById('quick-note-form');

    if (closeQuickNoteBtn && quickNoteModal) {
        closeQuickNoteBtn.addEventListener('click', () => quickNoteModal.classList.add('hidden'));
        quickNoteModal.addEventListener('click', (e) => {
            if (e.target === quickNoteModal) quickNoteModal.classList.add('hidden');
        });
    }

    const quickNoteTextarea = document.getElementById('quick-note-text');
    if (quickNoteTextarea && quickNoteForm) {
        quickNoteTextarea.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                quickNoteForm.requestSubmit();
            }
        });
    }

    if (quickNoteForm) {
        quickNoteForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const contactId = document.getElementById('quick-note-contact-id').value;
            const noteText = document.getElementById('quick-note-text').value.trim();
            if (!noteText) return;

            showSpinner();
            fetch(`/contact/${contactId}/add_note`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ note_text: noteText })
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast(data.message, 'success');
                    quickNoteModal.classList.add('hidden');
                    document.getElementById('quick-note-text').value = '';
                    fetchFilteredContacts();
                    refreshStats();
                } else {
                    showToast(data.message || 'Błąd zapisywania notatki.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd komunikacji z serwerem.', 'danger');
            });
        });
    }

    // --- Obsługa AJAX formularza dodawania kontaktu ---
    const addContactForm = document.querySelector('#add-modal form.form-grid');
    if (addContactForm) {
        addContactForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(addContactForm);
            const dataObj = {};
            formData.forEach((value, key) => { dataObj[key] = value; });

            showSpinner();
            fetch(addContactForm.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify(dataObj)
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast(data.message, 'success');
                    modal.classList.add('hidden');
                    addContactForm.reset();
                    fetchFilteredContacts();
                    refreshStats();
                } else {
                    showToast(data.message || 'Wystąpił błąd formularza.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd serwera podczas dodawania kontaktu.', 'danger');
            });
        });
    }

    // --- Obsługa AJAX importu CSV ---
    const importCsvForm = document.querySelector('#add-modal form[action*="import_csv"]');
    if (importCsvForm) {
        importCsvForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const formData = new FormData(importCsvForm);

            showSpinner();
            fetch(importCsvForm.action, {
                method: 'POST',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': getCsrfToken()
                },
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast(data.message, 'success');
                    modal.classList.add('hidden');
                    importCsvForm.reset();
                    fetchFilteredContacts();
                    refreshStats();
                } else {
                    showToast(data.message || 'Błąd podczas importu CSV.', 'danger');
                }
            })
            .catch(() => {
                hideSpinner();
                showToast('Błąd wysyłania pliku CSV.', 'danger');
            });
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

    function attachStatusSelectListeners(container) {
        container.querySelectorAll('.status-select').forEach(select => {
            select.addEventListener('click', (e) => e.stopPropagation());
            select.addEventListener('change', function(e) {
                e.stopPropagation();
                const contactId = this.dataset.contactId;
                const newStatus = this.value;
                const tr = this.closest('tr');
                const prevStatus = tr ? tr.dataset.currentStatus : 'nowy';

                if (newStatus === 'utracony') {
                    document.getElementById('lost-reason-contact-id').value = contactId;
                    document.getElementById('lost-reason-modal')?.classList.remove('hidden');
                    this.value = prevStatus;
                    return;
                }

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
                        if (tr) {
                            tr.className = tr.className.replace(/status-\w+/, `status-${newStatus}`);
                            tr.dataset.currentStatus = newStatus;
                        }
                        showToast(`Zmieniono status na: ${statusLabels[newStatus] || newStatus}`, 'success');
                        refreshStats();
                    } else {
                        this.value = prevStatus;
                        showToast(data.message || 'Błąd zmiany statusu.', 'danger');
                    }
                })
                .catch(() => {
                    this.value = prevStatus;
                    showToast('Błąd komunikacji z serwerem.', 'danger');
                });
            });
        });
    }

function renderTable(contacts) {
    const tableBody = document.querySelector('#table-view tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (contacts.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="14">Brak kontaktów pasujących do kryteriów.</td></tr>';
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
        row.dataset.name = contact.name || '';
        row.dataset.phone = contact.phone || '';
        row.dataset.email = contact.email || '';
        row.dataset.nip = contact.nip || '';
        row.dataset.city = contact.city || '';
        row.dataset.notes = contact.notes || '';

        const lastNoteDate = contact.last_note_date ? contact.last_note_date.split(' ')[0] : '';

        row.innerHTML = `
            <td class="col-status">
                <select class="status-select status-select-${contact.status}" data-contact-id="${contact.id}" style="padding: 2px 4px; border-radius: 4px; font-size: 0.82rem; font-weight: 500; cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-main);">
                    <option value="nowy" ${contact.status === 'nowy' ? 'selected' : ''}>⭕ Nowy</option>
                    <option value="aktywny" ${contact.status === 'aktywny' ? 'selected' : ''}>✅ Aktywny</option>
                    <option value="kontakt" ${contact.status === 'kontakt' ? 'selected' : ''}>📞 Kontakt</option>
                    <option value="lojalny" ${contact.status === 'lojalny' ? 'selected' : ''}>⭐ Wizyta</option>
                    <option value="nieaktywny" ${contact.status === 'nieaktywny' ? 'selected' : ''}>🌙 Nieaktywny</option>
                    <option value="utracony" ${contact.status === 'utracony' ? 'selected' : ''}>🚫 Utracony</option>
                </select>
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
            <td class="col-score">
                <span style="font-weight: bold; color: ${contact.lead_score >= 50 ? '#16a34a' : '#d97706'};">
                    ${contact.lead_score || 0} ${contact.lead_score >= 70 ? '🔥' : ''}
                </span>
            </td>
            <td class="col-actions">
                <button type="button" class="btn-quick-note button-secondary" title="Dodaj notatkę" style="padding: 2px 8px; font-size: 0.8rem;">
                    <i class="fas fa-plus"></i>
                </button>
            </td>
        `;

        const quickNoteBtn = row.querySelector('.btn-quick-note');
        if (quickNoteBtn) {
            quickNoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('quick-note-contact-id').value = contact.id;
                document.getElementById('quick-note-contact-name').innerText = contact.name || '';
                document.getElementById('quick-note-text').value = '';
                document.getElementById('quick-note-modal')?.classList.remove('hidden');
                document.getElementById('quick-note-text')?.focus();
            });
        }

        row.addEventListener('click', (e) => {
            if (e.target.tagName !== 'A' && !e.target.closest('a') &&
                e.target.tagName !== 'BUTTON' && !e.target.closest('button') &&
                e.target.tagName !== 'SELECT' && !e.target.closest('select')) {
                if (typeof openDrawerFromRow === 'function') {
                    openDrawerFromRow(row);
                }
            }
        });

        tableBody.appendChild(row);
    });

    attachStatusSelectListeners(tableBody);
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

    // --- Mapa MapLibre GL JS ---
    let maplibreMap = null;
    let mapMarkers = [];

    const maplibreStyle = {
        'version': 8,
        'sources': {
            'osm-tiles': {
                'type': 'raster',
                'tiles': [
                    'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
                ],
                'tileSize': 256,
                'attribution': '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }
        },
        'layers': [
            {
                'id': 'osm-tiles-layer',
                'type': 'raster',
                'source': 'osm-tiles',
                'minzoom': 0,
                'maxzoom': 19
            }
        ]
    };

    function renderMap(contacts) {
        const mapView = document.getElementById('map-view');
        if (!mapView || typeof maplibregl === 'undefined') return;

        if (!maplibreMap) {
            maplibreMap = new maplibregl.Map({
                container: 'maplibre-map',
                style: maplibreStyle,
                center: [19.4803, 52.0693],
                zoom: 5.5
            });
            maplibreMap.addControl(new maplibregl.NavigationControl());
        }

        mapMarkers.forEach(m => m.remove());
        mapMarkers = [];

        const validContacts = contacts.filter(c => c.latitude !== null && c.longitude !== null && !isNaN(c.latitude) && !isNaN(c.longitude));
        const coordCounts = {};
        const bounds = new maplibregl.LngLatBounds();

        validContacts.forEach((c) => {
            const key = `${c.latitude.toFixed(4)},${c.longitude.toFixed(4)}`;
            const count = coordCounts[key] || 0;
            coordCounts[key] = count + 1;

            let finalLat = c.latitude;
            let finalLng = c.longitude;

            if (count > 0) {
                const angle = count * 1.2;
                const distance = 0.002 * Math.sqrt(count);
                finalLat += distance * Math.cos(angle);
                finalLng += distance * Math.sin(angle);
            }

            bounds.extend([finalLng, finalLat]);

            const locationText = `${c.city || ''} ${c.street || ''}`.trim() || 'Brak dokładnego adresu';

            const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`
                <div style="font-family: var(--font-family); font-size: 0.9rem;">
                    <strong><a href="/contact/${c.id}" style="color: var(--primary-color); font-weight: 600;">${c.name}</a></strong><br>
                    <span style="color: #666;"><i class="fas fa-map-marker-alt"></i> ${locationText}</span><br>
                    <span style="display: inline-block; margin-top: 4px; padding: 2px 6px; border-radius: 4px; background: #e0f2fe; color: #0369a1; font-size: 0.75rem;">Status: ${c.status}</span>
                </div>
            `);

            const marker = new maplibregl.Marker({ color: '#2563eb' })
                .setLngLat([finalLng, finalLat])
                .setPopup(popup)
                .addTo(maplibreMap);

            mapMarkers.push(marker);
        });

        if (validContacts.length > 0) {
            maplibreMap.fitBounds(bounds, { padding: 40, maxZoom: 14 });
        }

        setTimeout(() => maplibreMap.resize(), 300);
    }

    // --- Powiadomienia ---
    function checkNotifications() {
        fetch('/api/reminders')
            .then(res => res.json())
            .then(reminders => {
                const badge = document.getElementById('notification-badge');
                const list = document.getElementById('notification-list');
                const today = new Date().toISOString().split('T')[0];

                const activeReminders = reminders.filter(r => r.start <= today);
                if (badge) {
                    if (activeReminders.length > 0) {
                        badge.innerText = activeReminders.length;
                        badge.style.display = 'inline-block';
                    } else {
                        badge.style.display = 'none';
                    }
                }

                if (list) {
                    if (activeReminders.length === 0) {
                        list.innerHTML = 'Brak oczekujących przypomnień.';
                    } else {
                        list.innerHTML = activeReminders.map(r => `
                            <div style="padding: 6px 0; border-bottom: 1px solid var(--border-color);">
                                <a href="${r.url}" style="font-weight: bold; color: var(--primary-color);">${r.title}</a>
                                <div style="font-size: 0.75rem; color: var(--text-muted);">${r.start}</div>
                            </div>
                        `).join('');
                    }
                }

                // Wyświetlaj powiadomienie przeglądarkowe przy każdym odświeżeniu/wejściu na stronę
                if (activeReminders.length > 0) {
                    if (Notification.permission === 'granted') {
                        new Notification('CRM Przypomnienia', {
                            body: `Masz ${activeReminders.length} oczekujących przypomnień na dziś!`,
                            icon: '/favicon.ico'
                        });
                    } else if (Notification.permission !== 'denied') {
                        Notification.requestPermission().then(permission => {
                            if (permission === 'granted') {
                                new Notification('CRM Przypomnienia', {
                                    body: `Masz ${activeReminders.length} oczekujących przypomnień na dziś!`,
                                    icon: '/favicon.ico'
                                });
                            }
                        });
                    }
                }
            });
    }

    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }

    const bell = document.getElementById('notification-bell');
    const dropdown = document.getElementById('notification-dropdown');
    if (bell && dropdown) {
        bell.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', () => dropdown.classList.add('hidden'));
    }

    checkNotifications();

    // --- Logika dynamicznego odświeżania i przełączania widoków ---
    const tableView = document.getElementById('table-view');
    const kanbanView = document.getElementById('kanban-view');
    const calendarView = document.getElementById('calendar-view');
    const mapView = document.getElementById('map-view');
    const delegationsView = document.getElementById('delegations-view');
    const tableBtn = document.getElementById('view-btn-table');
    const kanbanBtn = document.getElementById('view-btn-kanban');
    const calendarBtn = document.getElementById('view-btn-calendar');
    const mapBtn = document.getElementById('view-btn-map');
    const delegationsBtn = document.getElementById('view-btn-delegations');

    function switchView(view) {
        [tableView, kanbanView, calendarView, mapView, delegationsView].forEach(v => v?.classList.add('hidden'));
        [tableBtn, kanbanBtn, calendarBtn, mapBtn, delegationsBtn].forEach(b => b?.classList.remove('active'));
        localStorage.setItem('crm_view', view);
        if (view === 'kanban') {
            kanbanView?.classList.remove('hidden');
            kanbanBtn?.classList.add('active');
            fetchFilteredContacts();
        } else if (view === 'calendar') {
            calendarView?.classList.remove('hidden');
            calendarBtn?.classList.add('active');
            renderCalendar();
        } else if (view === 'map') {
            mapView?.classList.remove('hidden');
            mapBtn?.classList.add('active');
            fetchFilteredContacts();
        } else if (view === 'delegations') {
            delegationsView?.classList.remove('hidden');
            delegationsBtn?.classList.add('active');
            initDelegationsView();
        } else {
            tableView?.classList.remove('hidden');
            tableBtn?.classList.add('active');
            fetchFilteredContacts();
        }
    }

    function updateView(contacts) {
        const currentView = localStorage.getItem('crm_view') || 'table';
        if (currentView === 'kanban') renderKanbanBoard(contacts);
        else if (currentView === 'map') renderMap(contacts);
        else renderTable(contacts);
        restoreScrollPosition();
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
    
    // --- Obsługa menu Hamburgera ---
    const hamburgerBtn = document.getElementById('hamburger-menu-btn');
    const hamburgerDropdown = document.getElementById('hamburger-dropdown');

    if (hamburgerBtn && hamburgerDropdown) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hamburgerDropdown.classList.toggle('hidden');
        });
        hamburgerDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        document.addEventListener('click', () => {
            hamburgerDropdown.classList.add('hidden');
        });
    }

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
            link.addEventListener('click', function() { sessionStorage.setItem('crmScrollPosition', window.scrollY); });
        });
    }

    function restoreScrollPosition() {
        const savedScrollPosition = sessionStorage.getItem('crmScrollPosition');
        if (savedScrollPosition !== null && savedScrollPosition !== undefined) {
            setTimeout(() => {
                window.scrollTo({ top: parseInt(savedScrollPosition, 10), behavior: 'instant' });
            }, 50);
        }
    }

    window.addEventListener('pageshow', function(event) {
        restoreScrollPosition();
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
        if (mapBtn) mapBtn.addEventListener('click', () => switchView('map'));
        if (delegationsBtn) delegationsBtn.addEventListener('click', () => switchView('delegations'));
        switchView(savedView);
    } else {
        fetchFilteredContacts();
    }

    // --- MODUŁ DELEGACJI ---
    let currentDelegationId = null;
    let delegationMap = null;
    let delegationMapMarkers = [];
    let stopsSortable = null;

    function initDelegationsView() {
        loadDelegationsList();
        loadContactsForDelegationSelect();
        initDelegationMap();
    }

    function initDelegationMap() {
        const mapContainer = document.getElementById('delegation-maplibre-map');
        if (!mapContainer || typeof maplibregl === 'undefined') return;

        if (!delegationMap) {
            delegationMap = new maplibregl.Map({
                container: 'delegation-maplibre-map',
                style: maplibreStyle,
                center: [19.4803, 52.0693],
                zoom: 5.5
            });
            delegationMap.addControl(new maplibregl.NavigationControl());
        }
        setTimeout(() => delegationMap.resize(), 300);
    }

    function loadDelegationsList() {
        fetch('/api/delegations')
            .then(res => res.json())
            .then(delegations => {
                const select = document.getElementById('delegation-select');
                if (!select) return;
                select.innerHTML = '<option value="">-- Wybierz lub stwórz nową --</option>';
                delegations.forEach(d => {
                    const opt = document.createElement('option');
                    opt.value = d.id;
                    opt.textContent = `${d.title}${d.date ? ` (${d.date})` : ''}`;
                    if (d.id === currentDelegationId) opt.selected = true;
                    select.appendChild(opt);
                });

                if (currentDelegationId) {
                    loadDelegationDetails(currentDelegationId);
                } else {
                    document.getElementById('add-stop-panel')?.classList.add('hidden');
                    document.getElementById('delegation-summary-bar')?.classList.add('hidden');
                    document.getElementById('no-delegation-msg')?.classList.remove('hidden');
                    renderStopsList([]);
                }
            });
    }

    function loadContactsForDelegationSelect() {
        fetch('/filter')
            .then(res => res.json())
            .then(contacts => {
                const select = document.getElementById('stop-contact-select');
                if (!select) return;
                select.innerHTML = '<option value="">-- Wybierz klienta z bazy --</option>';
                contacts.forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = `${c.name} (${c.city || 'Brak miasta'})`;
                    select.appendChild(opt);
                });
            });
    }

    const delSelect = document.getElementById('delegation-select');
    if (delSelect) {
        delSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                currentDelegationId = parseInt(val, 10);
                loadDelegationDetails(currentDelegationId);
            } else {
                currentDelegationId = null;
                document.getElementById('add-stop-panel')?.classList.add('hidden');
                document.getElementById('delegation-summary-bar')?.classList.add('hidden');
                document.getElementById('no-delegation-msg')?.classList.remove('hidden');
                renderStopsList([]);
                clearDelegationMap();
            }
        });
    }

    const btnCreateDel = document.getElementById('btn-create-delegation');
    if (btnCreateDel) {
        btnCreateDel.addEventListener('click', () => {
            const input = document.getElementById('new-delegation-title');
            const title = input?.value.trim() || 'Nowa Delegacja';
            showSpinner();
            fetch('/api/delegations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ title: title })
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success && data.id) {
                    showToast('Stworzono nową delegację', 'success');
                    if (input) input.value = '';
                    currentDelegationId = data.id;
                    loadDelegationsList();
                } else {
                    showToast(data.message || 'Nie udało się utworzyć delegacji.', 'danger');
                }
            })
            .catch((err) => {
                hideSpinner();
                console.error(err);
                showToast('Błąd komunikacji przy tworzeniu delegacji.', 'danger');
            });
        });
    }

    const btnDeleteDel = document.getElementById('btn-delete-delegation');
    if (btnDeleteDel) {
        btnDeleteDel.addEventListener('click', () => {
            if (!currentDelegationId) {
                showToast('Wybierz delegację do usunięcia.', 'warning');
                return;
            }
            if (!confirm('Czy na pewno chcesz usunąć tę delegację?')) return;
            showSpinner();
            fetch(`/api/delegations/${currentDelegationId}`, {
                method: 'DELETE',
                headers: { 'X-CSRFToken': getCsrfToken() }
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast('Usunięto delegację', 'success');
                    currentDelegationId = null;
                    loadDelegationsList();
                } else {
                    showToast('Nie udało się usunąć delegacji.', 'danger');
                }
            })
            .catch(() => hideSpinner());
        });
    }

    // Toggle widoczności pól formularza wg typu punktu
    const stopTypeSelect = document.getElementById('stop-type-select');
    const stopContactWrapper = document.getElementById('stop-contact-wrapper');
    const stopCustomWrapper = document.getElementById('stop-custom-wrapper');

    if (stopTypeSelect) {
        stopTypeSelect.addEventListener('change', () => {
            const type = stopTypeSelect.value;
            if (type === 'contact') {
                stopContactWrapper?.classList.remove('hidden');
                stopCustomWrapper?.classList.add('hidden');
            } else {
                stopContactWrapper?.classList.add('hidden');
                stopCustomWrapper?.classList.remove('hidden');
            }
        });
        stopTypeSelect.dispatchEvent(new Event('change'));
    }

    const btnAddStop = document.getElementById('btn-add-stop');
    if (btnAddStop) {
        btnAddStop.addEventListener('click', () => {
            if (!currentDelegationId) return;
            const stopType = stopTypeSelect.value;
            const contactId = document.getElementById('stop-contact-select').value;
            const name = document.getElementById('stop-name-input').value.trim();
            const address = document.getElementById('stop-address-input').value.trim();
            const duration = parseInt(document.getElementById('stop-duration-input').value, 10) || 0;

            if (stopType === 'contact' && !contactId) {
                showToast('Wybierz klienta z listy', 'warning');
                return;
            }
            if (stopType !== 'contact' && !name && !address) {
                showToast('Podaj nazwę lub adres punktu', 'warning');
                return;
            }

            showSpinner();
            fetch(`/api/delegations/${currentDelegationId}/stops`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({
                    stop_type: stopType,
                    contact_id: contactId ? parseInt(contactId, 10) : null,
                    name: name,
                    address: address,
                    visit_duration_minutes: duration
                })
            })
            .then(res => res.json())
            .then(data => {
                hideSpinner();
                if (data.success) {
                    showToast('Dodano punkt do delegacji', 'success');
                    document.getElementById('stop-name-input').value = '';
                    document.getElementById('stop-address-input').value = '';
                    loadDelegationDetails(currentDelegationId);
                }
            })
            .catch(() => hideSpinner());
        });
    }

    function loadDelegationDetails(delegationId) {
        document.getElementById('add-stop-panel')?.classList.remove('hidden');
        document.getElementById('delegation-summary-bar')?.classList.remove('hidden');
        document.getElementById('no-delegation-msg')?.classList.add('hidden');

        fetch(`/api/delegations/${delegationId}`)
            .then(res => res.json())
            .then(data => {
                if (!data.success) return;
                updateSummaryBar(data.summary);
                renderStopsList(data.stops);
                renderDelegationMapRoute(data.stops, data.route);
            });
    }

    function formatMinutes(min) {
        if (!min) return '0 min';
        const hrs = Math.floor(min / 60);
        const remMin = Math.round(min % 60);
        if (hrs === 0) return `${remMin} min`;
        return `${hrs}h ${remMin}m`;
    }

    function updateSummaryBar(summary) {
        if (!summary) return;
        document.getElementById('summary-distance').innerText = `${summary.total_distance_km || 0} km`;
        document.getElementById('summary-drive-time').innerText = formatMinutes(summary.total_drive_duration_min);
        document.getElementById('summary-visit-time').innerText = formatMinutes(summary.total_visit_duration_min);
        document.getElementById('summary-total-time').innerText = formatMinutes(summary.total_trip_duration_min);
    }

    function renderStopsList(stops) {
        const container = document.getElementById('stops-list');
        if (!container) return;
        container.innerHTML = '';

        if (!stops || stops.length === 0) {
            container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-muted); text-align: center; margin-top: 20px;">Brak punktów w delegacji.</p>';
            return;
        }

        const typeIcons = {
            start: '<i class="fas fa-play-circle" style="color: #16a34a;"></i>',
            end: '<i class="fas fa-flag-checkered" style="color: #dc2626;"></i>',
            hotel: '<i class="fas fa-hotel" style="color: #0284c7;"></i>',
            contact: '<i class="fas fa-building" style="color: #2563eb;"></i>',
            custom: '<i class="fas fa-map-marker-alt" style="color: #d97706;"></i>'
        };

        stops.forEach((stop, index) => {
            const item = document.createElement('div');
            item.className = 'card stop-item';
            item.dataset.stopId = stop.id;
            item.style.cssText = 'padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-card); display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: grab;';

            item.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                    <span style="font-weight: bold; color: var(--text-muted); font-size: 0.85rem;">#${index + 1}</span>
                    <span style="font-size: 1rem;">${typeIcons[stop.stop_type] || typeIcons.custom}</span>
                    <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <strong style="font-size: 0.85rem; color: var(--text-main); font-weight: 600;">${stop.name}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden;">${stop.address || 'Brak adresu'}</div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                    <input type="number" value="${stop.visit_duration_minutes || 0}" min="0" step="5" class="stop-duration-edit" title="Czas wizyty (min)" style="width: 55px; padding: 2px 4px; font-size: 0.8rem; text-align: center; margin: 0; border: 1px solid var(--border-color); border-radius: 4px;">
                    <button type="button" class="btn-delete-stop button-secondary" style="padding: 3px 6px; font-size: 0.75rem; color: #ef4444;" title="Usuń punkt"><i class="fas fa-times"></i></button>
                </div>
            `;

            const durInput = item.querySelector('.stop-duration-edit');
            if (durInput) {
                durInput.addEventListener('change', (e) => {
                    const newDur = parseInt(e.target.value, 10) || 0;
                    fetch(`/api/delegations/stops/${stop.id}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCsrfToken()
                        },
                        body: JSON.stringify({ visit_duration_minutes: newDur })
                    }).then(() => loadDelegationDetails(currentDelegationId));
                });
            }

            const delBtn = item.querySelector('.btn-delete-stop');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    fetch(`/api/delegations/stops/${stop.id}`, {
                        method: 'DELETE',
                        headers: { 'X-CSRFToken': getCsrfToken() }
                    }).then(() => loadDelegationDetails(currentDelegationId));
                });
            }

            container.appendChild(item);
        });

        if (stopsSortable) stopsSortable.destroy();
        stopsSortable = new Sortable(container, {
            animation: 150,
            ghostClass: 'kanban-card-ghost',
            onEnd: function () {
                const newOrderIds = Array.from(container.querySelectorAll('.stop-item')).map(el => parseInt(el.dataset.stopId, 10));
                fetch(`/api/delegations/${currentDelegationId}/stops/reorder`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ stop_ids: newOrderIds })
                }).then(() => loadDelegationDetails(currentDelegationId));
            }
        });
    }

    function clearDelegationMap() {
        delegationMapMarkers.forEach(m => m.remove());
        delegationMapMarkers = [];
        if (delegationMap && delegationMap.getSource('route-source')) {
            delegationMap.removeLayer('route-layer');
            delegationMap.removeSource('route-source');
        }
    }

    function renderDelegationMapRoute(stops, routeInfo) {
        if (!delegationMap) return;
        clearDelegationMap();

        const bounds = new maplibregl.LngLatBounds();
        let hasCoords = false;

        stops.forEach((stop, idx) => {
            if (stop.latitude !== null && stop.longitude !== null) {
                hasCoords = true;
                bounds.extend([stop.longitude, stop.latitude]);

                const el = document.createElement('div');
                el.className = 'custom-marker';
                el.style.cssText = `
                    background-color: #2563eb;
                    color: white;
                    border-radius: 50%;
                    width: 26px;
                    height: 26px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: bold;
                    font-size: 0.8rem;
                    border: 2px solid white;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                `;
                el.innerText = idx + 1;

                const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`
                    <div style="font-family: var(--font-family); font-size: 0.85rem;">
                        <strong>#${idx + 1} ${stop.name}</strong><br>
                        <span style="color: #666;">${stop.address || ''}</span><br>
                        <span>Czas postoju: ${stop.visit_duration_minutes || 0} min</span>
                    </div>
                `);

                const marker = new maplibregl.Marker({ element: el })
                    .setLngLat([stop.longitude, stop.latitude])
                    .setPopup(popup)
                    .addTo(delegationMap);

                delegationMapMarkers.push(marker);
            }
        });

        if (routeInfo && routeInfo.geometry) {
            const geojson = {
                'type': 'Feature',
                'properties': {},
                'geometry': routeInfo.geometry
            };

            if (delegationMap.getSource('route-source')) {
                delegationMap.getSource('route-source').setData(geojson);
            } else {
                delegationMap.addSource('route-source', {
                    'type': 'geojson',
                    'data': geojson
                });

                delegationMap.addLayer({
                    'id': 'route-layer',
                    'type': 'line',
                    'source': 'route-source',
                    'layout': {
                        'line-join': 'round',
                        'line-cap': 'round'
                    },
                    'paint': {
                        'line-color': '#2563eb',
                        'line-width': 5,
                        'line-opacity': 0.8
                    }
                });
            }
        }

        if (hasCoords) {
            delegationMap.fitBounds(bounds, { padding: 50, maxZoom: 14 });
        }
        setTimeout(() => delegationMap.resize(), 300);
    }
    
    updateSortIcons();
    updateColumnVisibility();
    loadColumnWidths();
});