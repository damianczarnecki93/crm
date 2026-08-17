from datetime import datetime, timezone
from flask import Blueprint, request, redirect, url_for, flash
from db import get_db_conn

history_bp = Blueprint('history', __name__)

@history_bp.route('/contact/<int:contact_id>/add_note', methods=['POST'])
def add_note(contact_id):
    note_text = request.form.get('note_text', '').strip()
    if not note_text: 
        flash('Wpis historii nie może być pusty.', 'warning')
        return redirect(url_for('contacts.contact_detail', contact_id=contact_id))
        
    today_date = datetime.now(timezone.utc).date()
    with get_db_conn() as conn:
        conn.execute('INSERT INTO contact_history (contact_id, change_description) VALUES (?, ?)', (contact_id, note_text))
        conn.execute('UPDATE contacts SET last_contact_date = ? WHERE id = ?', (today_date, contact_id))
        conn.commit()
    flash('Dodano nowy wpis do historii kontaktu.', 'success')
    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))


@history_bp.route('/history/<int:history_id>/delete', methods=['POST'])
def delete_history_note(history_id):
    with get_db_conn() as conn:
        note = conn.execute('SELECT contact_id FROM contact_history WHERE id = ?', (history_id,)).fetchone()
        if note:
            contact_id = note['contact_id']
            conn.execute('DELETE FROM contact_history WHERE id = ?', (history_id,))
            conn.commit()
            flash('Notatka z historii została usunięta.', 'success')
            return redirect(url_for('contacts.contact_detail', contact_id=contact_id))
    return redirect(url_for('main.index'))