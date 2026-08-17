import csv
from io import TextIOWrapper
from datetime import datetime, timezone, timedelta
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify

from db import get_db_conn, get_filtered_contacts_from_db, validate_contact_form

contacts_bp = Blueprint('contacts', __name__)

@contacts_bp.route('/add_contact', methods=['POST'])
def add_contact():
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    data = request.json if request.is_json else request.form
    errors = validate_contact_form(data)
    if errors:
        if is_json_req:
            return jsonify({'success': False, 'errors': errors, 'message': errors[0]}), 400
        for error in errors:
            flash(error, 'danger')
        return redirect(url_for('main.index'))

    form_keys = ['name', 'street', 'city', 'voivodeship', 'phone', 'email', 'nip', 'www', 'notes']
    form_values = {k: data.get(k, '').strip() if data.get(k) is not None else '' for k in form_keys}
    today_date = datetime.now(timezone.utc).date()
    
    with get_db_conn() as conn:
        cursor = conn.cursor()
        # Automatyczne ustawienie przypomnienia na +7 dni od utworzenia
        reminder_7d = today_date + timedelta(days=7)
        cursor.execute(
            '''INSERT INTO contacts (name, street, city, voivodeship, phone, email, nip, www, notes, last_contact_date, status, reminder_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (*form_values.values(), today_date, 'nowy', reminder_7d)
        )
        contact_id = cursor.lastrowid
        cursor.execute('INSERT INTO contact_history (contact_id, change_description) VALUES (?, ?)', (contact_id, 'Kontakt utworzony. Automatycznie ustawiono przypomnienie na +7 dni.'))
        conn.commit()
        
    msg = f'Pomyślnie dodano kontakt: {form_values["name"]}'
    if is_json_req:
        return jsonify({'success': True, 'message': msg, 'contact_id': contact_id})

    flash(msg, 'success')
    return redirect(url_for('main.index'))


@contacts_bp.route('/import_csv', methods=['POST'])
def import_csv():
    is_json_req = request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    file = request.files.get('csv_file')
    if not file or not file.filename.endswith('.csv'):
        msg = 'Proszę wgrać prawidłowy plik .csv'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('main.index'))
        
    try:
        csv_file = TextIOWrapper(file, encoding='utf-8')
        csv_reader = csv.reader(csv_file, delimiter=';')
        next(csv_reader, None)
    except Exception: 
        msg = 'Błąd podczas odczytu pliku CSV lub plik jest pusty.'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('main.index'))
        
    count = 0
    today_date = datetime.now(timezone.utc).date()
    
    with get_db_conn() as conn:
        cursor = conn.cursor()
        for row in csv_reader:
            try:
                if len(row) < 9: 
                    continue
                data = [val.strip() for val in row]
                if not data[0]:
                    continue
                    
                cursor.execute(
                    '''INSERT INTO contacts (name, street, city, voivodeship, phone, email, nip, www, notes, last_contact_date, status) 
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                    (*data[:9], today_date, 'nowy')
                )
                contact_id = cursor.lastrowid
                
                if len(row) > 9 and row[9].strip():
                    cursor.execute('INSERT INTO contact_history (contact_id, change_description) VALUES (?, ?)', (contact_id, row[9].strip()))
                count += 1
            except (ValueError, IndexError): 
                continue
        conn.commit()
        
    if count > 0: 
        msg = f'Pomyślnie zaimportowano {count} kontaktów.'
        if is_json_req:
            return jsonify({'success': True, 'message': msg, 'count': count})
        flash(msg, 'success')
    else: 
        msg = 'Nie zaimportowano żadnych kontaktów. Sprawdź format pliku.'
        if is_json_req:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
    return redirect(url_for('main.index'))


@contacts_bp.route('/contact/<int:contact_id>/update_status', methods=['POST'])
def update_status(contact_id):
    data = request.json if request.is_json else request.form
    new_status = data.get('status')
    lost_reason = data.get('lost_reason', '').strip() if data else ''
    allowed_statuses = ['nowy', 'aktywny', 'kontakt', 'utracony', 'lojalny', 'nieaktywny']
    
    if not new_status or new_status not in allowed_statuses:
        return jsonify({'success': False, 'message': 'Niepoprawny status'}), 400
    
    try:
        with get_db_conn() as conn:
            cursor = conn.cursor()
            if new_status == 'utracony' and lost_reason:
                cursor.execute('UPDATE contacts SET status = ?, lost_reason = ? WHERE id = ?', (new_status, lost_reason, contact_id))
            else:
                cursor.execute('UPDATE contacts SET status = ? WHERE id = ?', (new_status, contact_id))
            if cursor.rowcount == 0:
                return jsonify({'success': False, 'message': 'Kontakt nie istnieje'}), 404
            
        return jsonify({'success': True, 'new_status': new_status})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@contacts_bp.route('/filter')
def filter_contacts():
    search_query = request.args.get('q', '').strip()
    filter_city = request.args.get('filter_city', '').strip()
    filter_status = request.args.get('filter_status', '')
    sort_by = request.args.get('sort_by', 'name')
    sort_order = request.args.get('order', 'asc')

    sorted_contacts = get_filtered_contacts_from_db(
        search_query, filter_city, filter_status, sort_by, sort_order
    )
    return jsonify([dict(contact) for contact in sorted_contacts])


@contacts_bp.route('/contact/<int:contact_id>/update', methods=['POST'])
def update_contact(contact_id):
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    data = request.json if request.is_json else request.form
    errors = validate_contact_form(data)
    if errors:
        if is_json_req:
            return jsonify({'success': False, 'errors': errors, 'message': errors[0]}), 400
        for error in errors:
            flash(error, 'danger')
        return redirect(url_for('contacts.edit_contact', contact_id=contact_id))

    form_keys = ['name', 'street', 'city', 'voivodeship', 'phone', 'email', 'nip', 'www', 'notes']
    form_values = [data.get(k, '').strip() if data.get(k) is not None else '' for k in form_keys]
    
    with get_db_conn() as conn:
        conn.execute(
            '''UPDATE contacts 
               SET name = ?, street = ?, city = ?, voivodeship = ?, phone = ?, email = ?, nip = ?, www = ?, notes = ? 
               WHERE id = ?''',
            (*form_values, contact_id)
        )
        conn.commit()

    msg = 'Dane kontaktu zostały zaktualizowane.'
    if is_json_req:
        return jsonify({'success': True, 'message': msg})

    flash(msg, 'success')
    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))


@contacts_bp.route('/contact/<int:contact_id>')
def contact_detail(contact_id):
    with get_db_conn() as conn:
        contact = conn.execute('SELECT * FROM contacts WHERE id = ?', (contact_id,)).fetchone()
        history = conn.execute('SELECT * FROM contact_history WHERE contact_id = ? ORDER BY change_date DESC', (contact_id,)).fetchall()
        sales = conn.execute('SELECT * FROM sales_history WHERE contact_id = ? ORDER BY sale_date DESC', (contact_id,)).fetchall()
    
    if contact is None: 
        flash('Kontakt nie istnieje.', 'warning')
        return redirect(url_for('main.index'))
    return render_template('contact_detail.html', contact=contact, history=history, sales=sales)


@contacts_bp.route('/contact/<int:contact_id>/edit')
def edit_contact(contact_id):
    with get_db_conn() as conn:
        contact = conn.execute('SELECT * FROM contacts WHERE id = ?', (contact_id,)).fetchone()
    if contact is None: 
        flash('Kontakt nie istnieje.', 'warning')
        return redirect(url_for('main.index'))
    return render_template('edit_contact.html', contact=contact)


@contacts_bp.route('/contact/<int:contact_id>/delete', methods=['POST'])
def delete_contact(contact_id):
    is_json_req = request.is_json or request.headers.get('X-Requested-With') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', '')
    with get_db_conn() as conn:
        conn.execute('DELETE FROM contacts WHERE id = ?', (contact_id,))
        conn.commit()

    msg = 'Kontakt został trwale usunięty.'
    if is_json_req:
        return jsonify({'success': True, 'message': msg})

    flash(msg, 'success')
    return redirect(url_for('main.index'))


@contacts_bp.route('/contact/<int:contact_id>/set_reminder', methods=['POST'])
def set_reminder(contact_id):
    is_json = request.is_json
    data = request.json if is_json else request.form
    reminder_date_str = data.get('reminder_date', '').strip()
    
    with get_db_conn() as conn:
        if reminder_date_str:
            try:
                reminder_date = datetime.strptime(reminder_date_str, '%Y-%m-%d').date()
                conn.execute('UPDATE contacts SET reminder_date = ? WHERE id = ?', (reminder_date, contact_id))
                msg = f'Ustawiono przypomnienie na {reminder_date_str}.'
                conn.commit()
                if is_json:
                    return jsonify({'success': True, 'message': msg, 'reminder_date': reminder_date_str})
                flash(msg, 'success')
            except ValueError:
                if is_json:
                    return jsonify({'success': False, 'message': 'Niepoprawny format daty.'}), 400
                flash('Niepoprawny format daty.', 'danger')
        else:
            conn.execute('UPDATE contacts SET reminder_date = NULL WHERE id = ?', (contact_id,))
            msg = 'Przypomnienie zostało usunięte.'
            conn.commit()
            if is_json:
                return jsonify({'success': True, 'message': msg, 'reminder_date': None})
            flash(msg, 'success')

    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))


@contacts_bp.route('/contact/<int:contact_id>/set_reminder_days', methods=['POST'])
def set_reminder_days(contact_id):
    is_json = request.is_json
    data = request.json if is_json else request.form
    days_val = data.get('reminder_days')
    days_str = str(days_val).strip() if days_val is not None else ''
    
    if not days_str or not days_str.isdigit():
        msg = 'Proszę podać prawidłową liczbę dni.'
        if is_json:
            return jsonify({'success': False, 'message': msg}), 400
        flash(msg, 'warning')
        return redirect(url_for('contacts.contact_detail', contact_id=contact_id))
        
    days = int(days_str)
    today_date = datetime.now(timezone.utc).date()
    new_reminder_date = today_date + timedelta(days=days)
    new_reminder_str = new_reminder_date.strftime("%Y-%m-%d")
    
    with get_db_conn() as conn:
        conn.execute('UPDATE contacts SET reminder_date = ? WHERE id = ?', (new_reminder_date, contact_id))
        conn.commit()
        msg = f'Ustawiono przypomnienie na {new_reminder_str}.'
        if is_json:
            return jsonify({'success': True, 'message': msg, 'reminder_date': new_reminder_str})
        flash(msg, 'success')
            
    return redirect(url_for('contacts.contact_detail', contact_id=contact_id))