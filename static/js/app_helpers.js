// Toast function
function showToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas fa-info-circle"></i> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// Spinner functions
function showSpinner() {
    let overlay = document.querySelector('.spinner-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'spinner-overlay';
        overlay.innerHTML = '<div class="spinner"></div>';
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
}

function hideSpinner() {
    const overlay = document.querySelector('.spinner-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// Helper to get CSRF token from meta or hidden input
function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta) return meta.getAttribute('content');
    const input = document.querySelector('input[name="csrf_token"]');
    if (input) return input.value;
    return '';
}

// Async GUS fetch
async function fetchGusData(source = 'edit') {
    const isModal = source === 'modal';
    const nipInput = isModal ? document.getElementById('nip-modal') : document.getElementById('nip');
    if (!nipInput) return;

    const nip = nipInput.value.replace(/[^0-9]/g, '');
    if (nip.length !== 10) {
        showToast('Wprowadź poprawny, 10-cyfrowy numer NIP.', 'warning');
        return;
    }

    showSpinner();
    try {
        const response = await fetch(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${new Date().toISOString().split('T')[0]}`);
        const data = await response.json();

        if (data.result && data.result.subject) {
            const subject = data.result.subject;
            
            if (isModal) {
                const nameModalEl = document.getElementById('name-modal');
                if (nameModalEl) nameModalEl.value = subject.name || '';
                
                if (subject.workingAddress) {
                    const streetModalEl = document.getElementById('street-modal');
                    if (streetModalEl) streetModalEl.value = subject.workingAddress;
                }
            } else {
                const nameEl = document.getElementById('name');
                if (nameEl) nameEl.value = subject.name || '';
                
                if (subject.workingAddress) {
                    const streetEl = document.getElementById('street');
                    if (streetEl) streetEl.value = subject.workingAddress;
                }
            }
            
            showToast('Dane zostały pomyślnie pobrane z GUS!', 'success');
        } else {
            showToast('Nie znaleziono firmy o podanym numerze NIP.', 'danger');
        }
    } catch (err) {
        showToast('Błąd podczas pobierania danych z API GUS.', 'danger');
    } finally {
        hideSpinner();
    }
}

// Async reminder setters
async function setQuickDaysAsync(contactId, days) {
    showSpinner();
    try {
        const response = await fetch(`/contact/${contactId}/set_reminder_days`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ reminder_days: days })
        });
        const data = await response.json();
        if (data.success) {
            showToast(data.message, 'success');
            const reminderDisplay = document.querySelector('.reminder-set strong');
            if (reminderDisplay) {
                reminderDisplay.innerText = data.reminder_date;
            } else {
                setTimeout(() => window.location.reload(), 1000);
            }
        } else {
            showToast(data.message || 'Wystąpił błąd.', 'danger');
        }
    } catch (e) {
        showToast('Błąd komunikacji z serwerem.', 'danger');
    } finally {
        hideSpinner();
    }
}