from datetime import datetime, timezone
from flask import Blueprint, request, redirect, url_for, flash, jsonify
from db import get_db_conn

history_bp = Blueprint('history', __name__)

@history_bp.route('/contact/<int:contact_id>/add_note', methods=['POST'])
def add_note(contact_id):
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    data = request.json if request.is_json else request.form
    note_text = data.get('note_text', '').strip() if data else ''

    if not note_text: 
        msg = 'Wpis historii nie może być pusty.'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('contacts.contact_detail', contact_id=contact_id))
        
    today_date = datetime.now(timezone.utc).date()
    with get_db_conn() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO contact_history (contact_id, change_description) VALUES (?, ?)', (contact_id, note_text))
        note_id = cursor.lastrowid
        cursor.execute('UPDATE contacts SET last_contact_date = ? WHERE id = ?', (today_date, contact_id))
        note = cursor.execute('SELECT * FROM contact_history WHERE id = ?', (note_id,)).fetchone()
        conn.commit()

    msg = 'Dodano nowy wpis do historii kontaktu.'
    if is_json_req:
        return jsonify({
            'success': True,
            'message': msg,
            'note': {
                'id': note['id'],
                'change_date': str(note['change_date']),
                'change_description': note['change_description'],
                'date_short': str(note['change_date']).split(' ')[0]
            }
        })

    flash(msg, 'success')
    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))


@history_bp.route('/history/<int:history_id>/delete', methods=['POST'])
def delete_history_note(history_id):
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    with get_db_conn() as conn:
        note = conn.execute('SELECT contact_id FROM contact_history WHERE id = ?', (history_id,)).fetchone()
        if note:
            contact_id = note['contact_id']
            conn.execute('DELETE FROM contact_history WHERE id = ?', (history_id,))
            conn.commit()
            msg = 'Notatka z historii została usunięta.'
            if is_json_req:
                return jsonify({'success': True, 'message': msg, 'history_id': history_id, 'contact_id': contact_id})
            flash(msg, 'success')
            return redirect(url_for('contacts.contact_detail', contact_id=contact_id))

    if is_json_req:
        return jsonify({'success': False, 'message': 'Notatka nie istnieje.'}), 404
    return redirect(url_for('main.index'))