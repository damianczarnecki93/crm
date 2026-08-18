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

    if (closeLostReasonBtn && lostReasonModal) {
        closeLostReasonBtn.addEventListener('click', () => lostReasonModal.classList.add('hidden'));
        lostReasonModal.addEventListener('click', (e) => {
            if (e.target === lostReasonModal) lostReasonModal.classList.add('hidden');
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

    function addEventListenersToRows(rows) {
        rows.forEach(row => {
            row.addEventListener('click', function(event) {
                if (event.target.tagName === 'A' || event.target.closest('a') || event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
                const contactId = this.dataset.contactId;
                let currentStatus = this.dataset.currentStatus;
                const currentIndex = statuses.indexOf(currentStatus);
                const nextIndex = (currentIndex + 1) % statuses.length;
                const newStatus = statuses[nextIndex];

                if (newStatus === 'utracony') {
                    document.getElementById('lost-reason-contact-id').value = contactId;
                    document.getElementById('lost-reason-modal')?.classList.remove('hidden');
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
                        this.className = this.className.replace(/status-\w+/, `status-${newStatus}`);
                        this.dataset.currentStatus = newStatus;
                        const iconSpan = this.querySelector('.status-icon');
                        if (iconSpan) {
                            iconSpan.innerHTML = getStatusIconHTML(newStatus);
                            iconSpan.title = `Status: ${newStatus}`;
                        }
                        refreshStats();
                    }
                });
            });
        });
    }

function renderTable(contacts) {
    const tableBody = document.querySelector('#table-view tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    if (contacts.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="13">Brak kontaktów pasujących do kryteriów.</td></tr>';
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

    // --- Mapa Leaflet i Geolokalizacja ---
    let leafletMap = null;
    let mapMarkers = [];

    const cityCoords = {
        'warszawa': [52.2297, 21.0122], 'kraków': [50.0647, 19.9450], 'krakow': [50.0647, 19.9450],
        'wrocław': [51.1100, 17.0333], 'wroclaw': [51.1100, 17.0333], 'poznań': [52.4064, 16.9252],
        'poznan': [52.4064, 16.9252], 'gdańsk': [54.3520, 18.6466], 'gdansk': [54.3520, 18.6466],
        'szczecin': [53.4285, 14.5528], 'bydgoszcz': [53.1235, 18.0084], 'lublin': [51.2465, 22.5684],
        'katowice': [50.2649, 19.0238], 'białystok': [53.1325, 23.1688], 'bialystok': [53.1325, 23.1688],
        'gdynia': [54.5189, 18.5305], 'częstochowa': [50.8118, 19.1203], 'czestochowa': [50.8118, 19.1203],
        'radom': [51.4027, 21.1471], 'sosnowiec': [50.2863, 19.1041], 'toruń': [53.0138, 18.5981],
        'torun': [53.0138, 18.5981], 'kielce': [50.8703, 20.6275], 'rzeszów': [50.0412, 21.9991],
        'rzeszow': [50.0412, 21.9991], 'gliwice': [50.2945, 18.6714], 'olsztyn': [53.7784, 20.4801],
        'bielsko-biała': [49.8225, 19.0444], 'zielona góra': [51.9356, 15.5062], 'opole': [50.6721, 17.9253]
    };

    function renderMap(contacts) {
        const mapView = document.getElementById('map-view');
        if (!mapView || typeof L === 'undefined') return;

        if (!leafletMap) {
            leafletMap = L.map('leaflet-map').setView([52.0693, 19.4803], 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(leafletMap);
        }

        mapMarkers.forEach(m => leafletMap.removeLayer(m));
        mapMarkers = [];

        contacts.forEach((c) => {
            const cityKey = (c.city || '').toLowerCase().trim();
            const coords = cityCoords[cityKey];

            // Jeśli miasto jest znane w Słowniku, użyj dokładnych współrzędnych miasta (z minimalnym mikro-odstępem na unikalne ID dla nakładających się punktów)
            let lat, lng;
            if (coords) {
                lat = coords[0] + (c.id % 5) * 0.003 - 0.006;
                lng = coords[1] + ((c.id * 3) % 5) * 0.003 - 0.006;
            } else {
                // Gdy miasto nie jest wpisane lub nieznane w słowniku, wylicz powtarzalną pozycję na bazie ID w obrębie centralnej Polski
                lat = 52.0 + ((c.id * 17) % 180) / 100.0 - 0.9;
                lng = 19.0 + ((c.id * 31) % 250) / 100.0 - 1.25;
            }

            const marker = L.marker([lat, lng]).addTo(leafletMap);
            const locationText = c.city ? `${c.city} ${c.street || ''}` : 'Brak podanego miasta';
            marker.bindPopup(`<b><a href="/contact/${c.id}">${c.name}</a></b><br>${locationText}<br>Status: ${c.status}`);
            mapMarkers.push(marker);
        });

        setTimeout(() => leafletMap.invalidateSize(), 300);
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

                // Powiadomienia przeglądarkowe
                if (activeReminders.length > 0 && Notification.permission === 'granted') {
                    new Notification('CRM Przypomnienia', {
                        body: `Masz ${activeReminders.length} oczekujących przypomnień na dziś!`,
                        icon: '/favicon.ico'
                    });
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
    const tableBtn = document.getElementById('view-btn-table');
    const kanbanBtn = document.getElementById('view-btn-kanban');
    const calendarBtn = document.getElementById('view-btn-calendar');
    const mapBtn = document.getElementById('view-btn-map');

    function switchView(view) {
        [tableView, kanbanView, calendarView, mapView].forEach(v => v?.classList.add('hidden'));
        [tableBtn, kanbanBtn, calendarBtn, mapBtn].forEach(b => b?.classList.remove('active'));
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
        switchView(savedView);
    } else {
        fetchFilteredContacts();
    }
    
    updateSortIcons();
    updateColumnVisibility();
    loadColumnWidths();
});